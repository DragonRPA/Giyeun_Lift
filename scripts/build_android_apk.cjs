// scripts/build_android_apk.cjs
// ============================================================
// 기연 통화캡처 모바일 정규 안드로이드 APK 빌더
// aapt2 + javac + d8 + zipalign + apksigner 원스톱 빌드 파이프라인
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('============================================================');
console.log('📱 [KiyeunCallCapture] 정규 안드로이드 APK 빌드 시작');
console.log('============================================================\n');

// 1. 도구 경로 탐색 (ASCII 경로 D:\\AndroidSdk 사용)
const androidSdk = 'D:\\AndroidSdk';
const buildToolsDir = path.join(androidSdk, 'build-tools', '34.0.0');
const platformsDir = path.join(androidSdk, 'platforms', 'android-34');
const androidJar = path.join(platformsDir, 'android.jar');

const aapt2 = path.join(buildToolsDir, 'aapt2.exe');
const d8Jar = path.join(buildToolsDir, 'lib', 'd8.jar');
const zipalign = path.join(buildToolsDir, 'zipalign.exe');
const apksignerJar = path.join(buildToolsDir, 'lib', 'apksigner.jar');
const keytool = 'C:\\Program Files\\Java\\jdk-25.0.2\\bin\\keytool.exe';

console.log('🔍 [1/8] 빌드 도구 검증:');
console.log('  - Android SDK:   ', androidSdk);
console.log('  - android.jar:   ', fs.existsSync(androidJar) ? '✅ 존재' : '❌ 없음');
console.log('  - aapt2.exe:     ', fs.existsSync(aapt2) ? '✅ 존재' : '❌ 없음');
console.log('  - d8.jar:        ', fs.existsSync(d8Jar) ? '✅ 존재' : '❌ 없음');
console.log('  - zipalign:      ', fs.existsSync(zipalign) ? '✅ 존재' : '❌ 없음');
console.log('  - apksigner.jar: ', fs.existsSync(apksignerJar) ? '✅ 존재' : '❌ 없음');
console.log('  - keytool:       ', fs.existsSync(keytool) ? '✅ 존재' : '❌ 없음');

if (!fs.existsSync(androidJar) || !fs.existsSync(aapt2) || !fs.existsSync(d8Jar)) {
  console.error('❌ 필수 빌드 도구가 누락되었습니다.');
  process.exit(1);
}

// 2. 작업 디렉토리 설정
const rootDir = path.resolve(__dirname, '..');
const appDir = path.resolve(rootDir, '..', 'KiyeunCallCapture', 'android', 'app', 'src', 'main');
const buildDir = path.resolve(rootDir, '..', 'KiyeunCallCapture', 'android', 'build_output');

if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

const resDir = path.join(appDir, 'res');
const valuesDir = path.join(resDir, 'values');
const drawableDir = path.join(resDir, 'drawable');
const layoutDir = path.join(resDir, 'layout');
const javaDir = path.join(appDir, 'java', 'com', 'kiyeun', 'callcapture');

fs.mkdirSync(valuesDir, { recursive: true });
fs.mkdirSync(drawableDir, { recursive: true });
fs.mkdirSync(layoutDir, { recursive: true });
fs.mkdirSync(javaDir, { recursive: true });

// 3. 리소스 및 소스 파일 생성/보강
console.log('\n📝 [2/8] 안드로이드 리소스 및 매니페스트 구축:');

// strings.xml
fs.writeFileSync(path.join(valuesDir, 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">기연 통화캡처</string>
    <string name="notification_channel_name">기연 통화감지 서비스</string>
    <string name="notification_channel_desc">통화 감지 및 출퇴근 상태 상시 실행</string>
</resources>
`, 'utf8');

// colors.xml
fs.writeFileSync(path.join(valuesDir, 'colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">#2563eb</color>
    <color name="primary_dark">#1d4ed8</color>
    <color name="accent">#10b981</color>
    <color name="background">#0f172a</color>
</resources>
`, 'utf8');

// styles.xml
fs.writeFileSync(path.join(valuesDir, 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:colorPrimary">@color/primary</item>
        <item name="android:colorPrimaryDark">@color/primary_dark</item>
        <item name="android:colorAccent">@color/accent</item>
        <item name="android:windowBackground">@color/background</item>
    </style>
</resources>
`, 'utf8');

// 아이콘 복사 (icon-192.png)
const srcIcon = path.join(rootDir, 'public', 'icon-192.png');
const destIcon = path.join(drawableDir, 'ic_launcher.png');
if (fs.existsSync(srcIcon)) {
  fs.copyFileSync(srcIcon, destIcon);
  console.log('  - 앱 아이콘 복사 완료:', destIcon);
}

// activity_main.xml
fs.writeFileSync(path.join(layoutDir, 'activity_main.xml'), `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background">

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <ProgressBar
        android:id="@+id/progressBar"
        style="?android:attr/progressBarStyleHorizontal"
        android:layout_width="match_parent"
        android:layout_height="4dp"
        android:layout_alignParentTop="true"
        android:indeterminate="false"
        android:max="100"
        android:visibility="gone" />

</RelativeLayout>
`, 'utf8');

// AndroidManifest.xml
const manifestPath = path.join(appDir, 'AndroidManifest.xml');
fs.writeFileSync(manifestPath, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.kiyeun.callcapture"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

    <!-- 통화 상태 감지 -->
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.READ_CALL_LOG" />

    <!-- 저장소 및 오디오 권한 -->
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />

    <!-- 포그라운드 서비스 및 알림 (Android 14 dataSync 표준) -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- 부팅 후 자동 시작 -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

    <!-- 네트워크 -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:allowBackup="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:label="@string/app_name"
            android:icon="@drawable/ic_launcher"
            android:configChanges="keyboard|keyboardHidden|orientation|screenSize|uiMode"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".CallDetectionService"
            android:foregroundServiceType="dataSync"
            android:exported="false" />

        <receiver
            android:name=".BootReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".PhoneStateReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.PHONE_STATE" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
`, 'utf8');

// Java 소스코드 작성
// 1. NativeBridge.java
fs.writeFileSync(path.join(javaDir, 'NativeBridge.java'), `package com.kiyeun.callcapture;

import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

public class NativeBridge {
    private final MainActivity activity;

    public NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isInstalled() {
        return true;
    }

    @JavascriptInterface
    public String getAppVersion() {
        return "v1.0.0";
    }

    @JavascriptInterface
    public void clockIn(String userId) {
        Intent intent = new Intent(activity, CallDetectionService.class);
        intent.putExtra("action", "CLOCK_IN");
        intent.putExtra("userId", userId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent);
        } else {
            activity.startService(intent);
        }
    }

    @JavascriptInterface
    public void clockOut(String userId) {
        Intent intent = new Intent(activity, CallDetectionService.class);
        intent.putExtra("action", "CLOCK_OUT");
        intent.putExtra("userId", userId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent);
        } else {
            activity.startService(intent);
        }
    }
}
`, 'utf8');

// 2. AppWebViewClient.java
fs.writeFileSync(path.join(javaDir, 'AppWebViewClient.java'), `package com.kiyeun.callcapture;

import android.graphics.Bitmap;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;

public class AppWebViewClient extends WebViewClient {
    private final ProgressBar progressBar;

    public AppWebViewClient(ProgressBar progressBar) {
        this.progressBar = progressBar;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        if (progressBar != null) {
            progressBar.setVisibility(View.VISIBLE);
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        if (progressBar != null) {
            progressBar.setVisibility(View.GONE);
        }
        view.evaluateJavascript(
            "window.__KIYEUN_NATIVE_APK_ACTIVE__ = true; window.dispatchEvent(new CustomEvent('native-apk-ready', { detail: { active: true } }));",
            null
        );
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        view.loadUrl(url);
        return true;
    }
}
`, 'utf8');

// 3. AppWebChromeClient.java
fs.writeFileSync(path.join(javaDir, 'AppWebChromeClient.java'), `package com.kiyeun.callcapture;

import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.ProgressBar;

public class AppWebChromeClient extends WebChromeClient {
    private final ProgressBar progressBar;

    public AppWebChromeClient(ProgressBar progressBar) {
        this.progressBar = progressBar;
    }

    @Override
    public void onProgressChanged(WebView view, int newProgress) {
        if (progressBar != null) {
            progressBar.setProgress(newProgress);
        }
    }
}
`, 'utf8');

// 4. MainActivity.java
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package com.kiyeun.callcapture;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
    private WebView webView;
    private ProgressBar progressBar;
    private static final int PERMISSION_REQ_CODE = 101;
    private static final String APP_URL = "https://kiyuen-lift.vercel.app";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);

        setupWebView();
        checkPermissions();

        Intent serviceIntent = new Intent(this, CallDetectionService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent != null && intent.getBooleanExtra("CALL_ENDED", false)) {
            long endedAt = intent.getLongExtra("CALL_ENDED_AT", System.currentTimeMillis());
            if (webView != null) {
                webView.evaluateJavascript(
                    "if(window.onNativeCallEnded) { window.onNativeCallEnded(" + endedAt + "); }",
                    null
                );
            }
        }
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(this), "KiyeunNative");
        webView.setWebViewClient(new AppWebViewClient(progressBar));
        webView.setWebChromeClient(new AppWebChromeClient(progressBar));
        webView.loadUrl(APP_URL);
    }

    private void checkPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms = new String[]{
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.POST_NOTIFICATIONS,
                    Manifest.permission.READ_MEDIA_AUDIO,
                    Manifest.permission.RECORD_AUDIO
                };
            } else {
                perms = new String[]{
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.RECORD_AUDIO
                };
            }

            boolean needRequest = false;
            for (String p : perms) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    needRequest = true;
                    break;
                }
            }

            if (needRequest) {
                requestPermissions(perms, PERMISSION_REQ_CODE);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`, 'utf8');

// 5. CallDetectionService.java
fs.writeFileSync(path.join(javaDir, 'CallDetectionService.java'), `package com.kiyeun.callcapture;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.IBinder;
import android.telephony.TelephonyManager;

public class CallDetectionService extends Service {
    private static final String CHANNEL_ID = "kiyeun_call_capture_channel";
    private static final int NOTIF_ID = 1001;
    private PhoneStateReceiver phoneReceiver;
    private boolean isWorking = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification("대기 중", false), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, buildNotification("대기 중", false));
        }
        registerPhoneReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getStringExtra("action");
            if ("CLOCK_IN".equals(action)) {
                isWorking = true;
                updateNotification("출근 중 — 통화 감지 활성", true);
            } else if ("CLOCK_OUT".equals(action)) {
                isWorking = false;
                updateNotification("대기 중", false);
            }
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (phoneReceiver != null) {
            try {
                unregisterReceiver(phoneReceiver);
            } catch (Exception ignored) {}
        }
    }

    private void registerPhoneReceiver() {
        phoneReceiver = new PhoneStateReceiver();
        IntentFilter filter = new IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(phoneReceiver, filter, RECEIVER_EXPORTED);
        } else {
            registerReceiver(phoneReceiver, filter);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "기연 통화감지 서비스",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("통화 감지 및 출퇴근 상태 상시 실행 알림");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void updateNotification(String status, boolean working) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification(status, working));
        }
    }

    private Notification buildNotification(String status, boolean working) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("기연 통화캡처")
            .setContentText((working ? "🟢 " : "⚫ ") + status)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true);

        return builder.build();
    }
}
`, 'utf8');

// 6. PhoneStateReceiver.java
fs.writeFileSync(path.join(javaDir, 'PhoneStateReceiver.java'), `package com.kiyeun.callcapture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

public class PhoneStateReceiver extends BroadcastReceiver {
    private static String lastState = TelephonyManager.EXTRA_STATE_IDLE;
    private static boolean wasConnected = false;

    @Override
    public void onReceive(Context context, Intent intent) {
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null || state.equals(lastState)) return;

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            wasConnected = false;
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            wasConnected = true;
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            if (wasConnected) {
                Intent mainIntent = new Intent(context, MainActivity.class);
                mainIntent.setFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                );
                mainIntent.putExtra("CALL_ENDED", true);
                mainIntent.putExtra("CALL_ENDED_AT", System.currentTimeMillis());
                context.startActivity(mainIntent);
            }
            wasConnected = false;
        }
        lastState = state;
    }
}
`, 'utf8');

// 7. BootReceiver.java
fs.writeFileSync(path.join(javaDir, 'BootReceiver.java'), `package com.kiyeun.callcapture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Intent serviceIntent = new Intent(context, CallDetectionService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        }
    }
}
`, 'utf8');

console.log('  - 자바 소스코드 7종 생성 완료');

// 4. aapt2 compile
console.log('\n⚙️ [3/8] aapt2 리소스 컴파일:');
const compiledResZip = path.join(buildDir, 'compiled_res.zip');
const compileCmd = `"${aapt2}" compile --dir "${resDir}" -o "${compiledResZip}"`;
console.log('  >', compileCmd);
execSync(compileCmd, { stdio: 'inherit' });

// 5. aapt2 link
console.log('\n🔗 [4/8] aapt2 패키징 링크 및 R.java 생성:');
const genDir = path.join(buildDir, 'gen');
fs.mkdirSync(genDir, { recursive: true });
const baseApk = path.join(buildDir, 'base.apk');
const linkCmd = `"${aapt2}" link -I "${androidJar}" "${compiledResZip}" --manifest "${manifestPath}" -o "${baseApk}" --java "${genDir}" --auto-add-overlay`;
console.log('  >', linkCmd);
execSync(linkCmd, { stdio: 'inherit' });

// 6. javac compile (--release 8 -g:none)
console.log('\n☕ [5/8] 자바 소스코드 컴파일 (javac --release 8 -g:none):');
const classesDir = path.join(buildDir, 'classes');
fs.mkdirSync(classesDir, { recursive: true });

const rJava = path.join(genDir, 'com', 'kiyeun', 'callcapture', 'R.java');
const javaFiles = [
  rJava,
  path.join(javaDir, 'MainActivity.java'),
  path.join(javaDir, 'AppWebViewClient.java'),
  path.join(javaDir, 'AppWebChromeClient.java'),
  path.join(javaDir, 'NativeBridge.java'),
  path.join(javaDir, 'CallDetectionService.java'),
  path.join(javaDir, 'PhoneStateReceiver.java'),
  path.join(javaDir, 'BootReceiver.java')
].map(f => `"${f}"`).join(' ');

const javacCmd = `javac --release 8 -g:none -encoding UTF-8 -cp "${androidJar};${genDir}" -d "${classesDir}" ${javaFiles}`;
console.log('  >', javacCmd);
execSync(javacCmd, { stdio: 'inherit' });

// 7. d8 DEX 변환 (Direct Java invocation)
console.log('\n📦 [6/8] Dalvik Executable 바이트코드 변환 (d8):');
const d8OutputDir = path.join(buildDir, 'dex');
fs.mkdirSync(d8OutputDir, { recursive: true });

const jarPath = path.join(buildDir, 'app.jar');
const pyMakeJar = `python -c "import zipfile, os; z = zipfile.ZipFile(r'${jarPath}', 'w'); [z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), r'${classesDir}')) for r, d, fs in os.walk(r'${classesDir}') for f in fs if f.endswith('.class')]; z.close()"`;
execSync(pyMakeJar, { stdio: 'inherit' });

const d8Cmd = `java -Xmx1024M -cp "${d8Jar}" com.android.tools.r8.D8 --min-api 24 --output "${d8OutputDir}" "${jarPath}"`;
console.log('  >', d8Cmd);
execSync(d8Cmd, { stdio: 'inherit' });

// 8. classes.dex를 base.apk에 삽입
console.log('\n📥 classes.dex를 APK에 패키징:');
const unalignedApk = path.join(buildDir, 'unaligned.apk');
fs.copyFileSync(baseApk, unalignedApk);

const classesDexPath = path.join(d8OutputDir, 'classes.dex');
const pyAddDex = `python -c "import zipfile; z = zipfile.ZipFile(r'${unalignedApk}', 'a'); z.write(r'${classesDexPath}', 'classes.dex'); z.close()"`;
execSync(pyAddDex, { stdio: 'inherit' });

// 9. zipalign (4-byte alignment)
console.log('\n📐 [7/8] 4바이트 경계 정렬 (zipalign):');
const alignedApk = path.join(buildDir, 'aligned.apk');
const zipalignCmd = `"${zipalign}" -f -p 4 "${unalignedApk}" "${alignedApk}"`;
console.log('  >', zipalignCmd);
execSync(zipalignCmd, { stdio: 'inherit' });

// 10. 키스토어 생성 및 디지털 서명 (apksigner via Java)
console.log('\n✍️ [8/8] 디지털 서명 (apksigner v1+v2+v3):');
const keystorePath = path.join(rootDir, 'scripts', 'kiyeun-release.keystore');
if (!fs.existsSync(keystorePath)) {
  console.log('  - 자체 서명 키스토어 생성 중...');
  const keygenCmd = `"${keytool}" -genkeypair -v -keystore "${keystorePath}" -alias kiyeun -keyalg RSA -keysize 2048 -validity 10000 -storepass kiyeun1234 -keypass kiyeun1234 -dname "CN=Kiyeun Lift, OU=IT, O=Kiyeun, L=Seoul, ST=Seoul, C=KR"`;
  execSync(keygenCmd, { stdio: 'inherit' });
}

const finalApk = path.join(buildDir, 'KiyeunCallCapture.apk');
const signCmd = `java -jar "${apksignerJar}" sign --ks "${keystorePath}" --ks-pass pass:kiyeun1234 --key-pass pass:kiyeun1234 --min-sdk-version 24 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out "${finalApk}" "${alignedApk}"`;
console.log('  >', signCmd);
execSync(signCmd, { stdio: 'inherit' });

// 11. 서명 및 AXML 검증
console.log('\n🛡️ APK 무결성 정밀 검증:');
const verifyCmd = `java -jar "${apksignerJar}" verify --min-sdk-version 24 --verbose "${finalApk}"`;
console.log('  >', verifyCmd);
const verifyOutput = execSync(verifyCmd).toString();
console.log(verifyOutput);

const badgingCmd = `"${aapt2}" dump badging "${finalApk}"`;
const badgingOutput = execSync(badgingCmd).toString();
const badgeLines = badgingOutput.split('\n').slice(0, 10).join('\n');
console.log('📦 패키지 정보:');
console.log(badgeLines);

// 12. 웹앱 배포 폴더로 복사
const publicApk = path.join(rootDir, 'public', 'downloads', 'KiyeunCallCapture.apk');
const distApk = path.join(rootDir, 'dist', 'downloads', 'KiyeunCallCapture.apk');

fs.copyFileSync(finalApk, publicApk);
console.log('\n🚀 [완료] public/downloads 복사 완료:', publicApk, `(${fs.statSync(publicApk).size.toLocaleString()} bytes)`);

if (fs.existsSync(path.dirname(distApk))) {
  fs.copyFileSync(finalApk, distApk);
  console.log('🚀 [완료] dist/downloads 복사 완료:', distApk);
}

console.log('\n🎉 정규 안드로이드 APK 빌드가 100% 성공하였습니다!');
