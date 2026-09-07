import subprocess

print("1. Git Add...")
subprocess.run(["git", "add", "-A"], check=True)

msg = "[v1.10.0.Build.13] 2026-09-07 16:25 통화 녹음 파일 실시간 업로드 큐 가시화 & 파이프라인 이벤트 로그 모니터 및 즉시 초안 변환 탑재"
print(f"2. Git Commit: {msg}")
subprocess.run(["git", "commit", "-m", msg], check=True)

print("3. Git Push...")
subprocess.run(["git", "push", "origin", "main"], check=True)
print("4. Push Finished!")
