import subprocess

print("1. Git Add...")
subprocess.run(["git", "add", "-A"], check=True)

msg = "[v1.10.0.Build.8] 2026-09-07 14:00 모바일 웹앱 및 배차 파이프라인 테넌트(Tenant) 정보 기반 100% 동적화 개편"
print(f"2. Git Commit: {msg}")
subprocess.run(["git", "commit", "-m", msg], check=True)

print("3. Git Push...")
subprocess.run(["git", "push", "origin", "main"], check=True)
print("4. Push Finished!")
