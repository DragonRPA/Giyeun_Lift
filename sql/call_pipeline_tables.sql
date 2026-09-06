-- ============================================================
-- call_pipeline_tables.sql
-- 통화 업로드 파이프라인 DB 스키마
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================================

-- ① call_uploads: APK에서 업로드한 통화 파일 이력
CREATE TABLE IF NOT EXISTS call_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  uploader_phone    TEXT,
  caller_phone      TEXT,
  call_direction    TEXT CHECK (call_direction IN ('OUTGOING', 'INCOMING')),
  call_ended_at     TIMESTAMPTZ,
  duration_seconds  INTEGER,
  storage_path      TEXT,
  file_name         TEXT,
  call_context      TEXT[]  DEFAULT '{}',
  summary_text      TEXT,
  status            TEXT    DEFAULT 'UPLOADED'
                    CHECK (status IN ('UPLOADED','PROCESSING','PROCESSED','FAILED')),
  retry_count       INTEGER DEFAULT 0,
  error_message     TEXT,
  draft_id          UUID,
  customer_id       UUID,
  created_at        TIMESTAMPTZ DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  auto_delete_at    TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
);

-- ② draft_dispatch_orders: STT + LLM 처리 결과 초안
CREATE TABLE IF NOT EXISTS draft_dispatch_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_call_ids       UUID[]   DEFAULT '{}',
  context               TEXT[]   DEFAULT '{}',

  customer_name         TEXT,
  customer_name_conf    TEXT     DEFAULT 'MISSING'
                        CHECK (customer_name_conf IN ('HIGH','MEDIUM','LOW','MISSING')),
  customer_name_src     TEXT
                        CHECK (customer_name_src IN ('DB','STT','PARSED','MANUAL','SUMMARY') OR customer_name_src IS NULL),
  customer_id           UUID,

  site_name             TEXT,
  site_name_conf        TEXT     DEFAULT 'MISSING'
                        CHECK (site_name_conf IN ('HIGH','MEDIUM','LOW','MISSING')),
  site_id               UUID,

  equipment_json        JSONB    DEFAULT '[]',

  loading_date          DATE,
  loading_date_conf     TEXT     DEFAULT 'MISSING'
                        CHECK (loading_date_conf IN ('HIGH','MEDIUM','LOW','MISSING')),
  loading_time          TIME,
  loading_time_conf     TEXT     DEFAULT 'MISSING'
                        CHECK (loading_time_conf IN ('HIGH','MEDIUM','LOW','MISSING')),

  contact_person        TEXT,
  contact_person_conf   TEXT     DEFAULT 'MISSING',
  contact_phone         TEXT,
  note                  TEXT,

  is_new_customer       BOOLEAN  DEFAULT false,
  customer_registered   BOOLEAN  DEFAULT false,

  status                TEXT     DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','REVIEWING','SUBMITTED','DISCARDED')),
  urgency               TEXT     DEFAULT 'LOW'
                        CHECK (urgency IN ('HIGH','MEDIUM','LOW')),

  merged_from           UUID[]   DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now(),
  submitted_at          TIMESTAMPTZ,
  submitted_by_id       UUID
);

-- ============================================================
-- RLS 정책
-- ============================================================

ALTER TABLE call_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_dispatch_orders ENABLE ROW LEVEL SECURITY;

-- call_uploads: 본인 것만 읽기/쓰기/삭제
DROP POLICY IF EXISTS "call_uploads_owner_select" ON call_uploads;
DROP POLICY IF EXISTS "call_uploads_owner_insert" ON call_uploads;
DROP POLICY IF EXISTS "call_uploads_owner_update" ON call_uploads;
DROP POLICY IF EXISTS "call_uploads_owner_delete" ON call_uploads;

CREATE POLICY "call_uploads_owner_select" ON call_uploads
  FOR SELECT USING (uploader_id = auth.uid());

CREATE POLICY "call_uploads_owner_insert" ON call_uploads
  FOR INSERT WITH CHECK (uploader_id = auth.uid());

CREATE POLICY "call_uploads_owner_update" ON call_uploads
  FOR UPDATE USING (uploader_id = auth.uid());

CREATE POLICY "call_uploads_owner_delete" ON call_uploads
  FOR DELETE USING (uploader_id = auth.uid());

-- draft_dispatch_orders: 본인 것만 읽기/쓰기 (제출은 본인만)
DROP POLICY IF EXISTS "drafts_owner_select" ON draft_dispatch_orders;
DROP POLICY IF EXISTS "drafts_owner_insert" ON draft_dispatch_orders;
DROP POLICY IF EXISTS "drafts_owner_update" ON draft_dispatch_orders;
DROP POLICY IF EXISTS "drafts_owner_delete" ON draft_dispatch_orders;

CREATE POLICY "drafts_owner_select" ON draft_dispatch_orders
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "drafts_owner_insert" ON draft_dispatch_orders
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "drafts_owner_update" ON draft_dispatch_orders
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "drafts_owner_delete" ON draft_dispatch_orders
  FOR DELETE USING (owner_id = auth.uid());

-- Edge Function 서비스 롤 (service_role)이 모든 레코드 접근 가능
-- (Edge Function은 service_role key로 호출되므로 RLS 우회 가능)

-- ============================================================
-- Realtime 활성화 (웹앱 실시간 큐 업데이트)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE draft_dispatch_orders;

-- ============================================================
-- 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_call_uploads_uploader ON call_uploads(uploader_id);
CREATE INDEX IF NOT EXISTS idx_call_uploads_status ON call_uploads(status);
CREATE INDEX IF NOT EXISTS idx_call_uploads_auto_delete ON call_uploads(auto_delete_at);
CREATE INDEX IF NOT EXISTS idx_drafts_owner ON draft_dispatch_orders(owner_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON draft_dispatch_orders(status);
CREATE INDEX IF NOT EXISTS idx_drafts_urgency ON draft_dispatch_orders(urgency);
CREATE INDEX IF NOT EXISTS idx_drafts_created ON draft_dispatch_orders(created_at DESC);
