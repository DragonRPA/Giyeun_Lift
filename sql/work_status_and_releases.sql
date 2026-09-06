-- call_pipeline_tables.sql 에 추가 (하단에 붙여넣기)
-- ============================================================
-- user_work_status: 영업사원 출퇴근 상태 (웹앱 ↔ APK 동기화)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_work_status (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  is_working     BOOLEAN   DEFAULT false,
  work_started_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_user_work_status UNIQUE (user_id)
);

ALTER TABLE user_work_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_status_owner" ON user_work_status;
CREATE POLICY "work_status_owner" ON user_work_status
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Realtime 활성화 (웹앱 ↔ APK 실시간 동기화)
ALTER PUBLICATION supabase_realtime ADD TABLE user_work_status;

CREATE INDEX IF NOT EXISTS idx_work_status_user ON user_work_status(user_id);

-- ============================================================
-- apk_releases: APK 배포 이력 (웹앱 다운로드 버튼용)
-- ============================================================

CREATE TABLE IF NOT EXISTS apk_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version      TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size    BIGINT,
  release_note TEXT,
  is_latest    BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE apk_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "apk_releases_read" ON apk_releases;
CREATE POLICY "apk_releases_read" ON apk_releases
  FOR SELECT USING (auth.role() = 'authenticated');
