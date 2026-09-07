import subprocess

print("1. Git Add...")
subprocess.run(["git", "add", "-A"], check=True)

msg = "[v1.10.0.Build.6] 2026-09-07 13:36 eBroAgent C:\\eBroAgent 이전 및 테넌트 기반 회사정보 동적화 & e-Bro ERP 브랜드 단일화"
print(f"2. Git Commit: {msg}")
subprocess.run(["git", "commit", "-m", msg], check=True)

print("3. Git Push...")
subprocess.run(["git", "push", "origin", "main"], check=True)
print("4. Push Finished!")
