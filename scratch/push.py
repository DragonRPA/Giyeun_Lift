import subprocess

print("1. Git Add...")
subprocess.run(["git", "add", "-A"], check=True)

msg = "[v1.10.0.Build.10] 2026-09-07 15:20 PC 헤더 테넌트 회사명 상단 강조 및 하단 e-Bro ERP System 2열 스택 개편 & ebro.run 도메인 연동"
print(f"2. Git Commit: {msg}")
subprocess.run(["git", "commit", "-m", msg], check=True)

print("3. Git Push...")
subprocess.run(["git", "push", "origin", "main"], check=True)
print("4. Push Finished!")
