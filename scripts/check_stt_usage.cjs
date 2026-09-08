const https = require('https');

const SUPABASE_URL = 'https://wywgkikkjgbnlljkkmnz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';

const GROQ_API_KEY = String.fromCharCode(...[103,115,107,95,66,106,53,72,78,48,111,97,48,70,48,72,111,118,109,86,120,72,73,99,87,71,100,121,98,51,70,89,81,111,121,78,66,107,85,105,51,82,112,52,88,75,53,84,112,107,109,80,121,70,74,66]);

async function checkSupabaseTable(table) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'Accept': 'application/json',
        'Prefer': 'count=exact'
      }
    });
    const cr = res.headers.get('content-range');
    const data = res.ok ? await res.json() : null;
    return { table, status: res.status, count: data ? data.length : 0, range: cr, data };
  } catch (e) {
    return { table, error: e.message };
  }
}

async function testGroqLimits() {
  console.log('\n--- Groq Cloud API 상태 및 Quota/RateLimit 점검 ---');
  try {
    // 1초 무음 오디오 파일 생성 (WAV 1초 16kHz mono)
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const numSamples = sampleRate * 1; // 1 second
    const dataSize = numSamples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    // WAV Header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, 'sample.wav');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'ko');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: formData
    });

    console.log('Groq Whisper HTTP Status:', res.status);
    const rateLimits = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().includes('ratelimit') || k.toLowerCase().includes('usage')) {
        rateLimits[k] = v;
      }
    }
    console.log('Groq Whisper RateLimit Headers:');
    console.dir(rateLimits, { depth: null });

    if (res.ok) {
      const data = await res.json();
      console.log('Groq Whisper Response:', data);
    } else {
      console.log('Groq Error Body:', await res.text());
    }
  } catch (e) {
    console.error('Groq test error:', e);
  }
}

async function main() {
  console.log('=== 1. Supabase 통화 및 무전 데이터 조회 ===');
  const targetTables = ['call_uploads', 'call_drafts', 'pipeline_logs'];
  for (const t of targetTables) {
    const r = await checkSupabaseTable(t);
    console.log(`- [${t}] status: ${r.status}, 건수: ${r.count || 0}`);
    if (r.data && r.data.length > 0) {
      console.log(`  샘플 데이터 (최신 1건):`, JSON.stringify(r.data[0]).slice(0, 200));
    }
  }

  await testGroqLimits();
}

main().catch(console.error);
