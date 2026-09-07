import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'd:\01.AntiGravity\Giyuen_Lift\schema.sql', 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

for i in range(430, min(500, len(lines))):
    print(f"{i+1}: {lines[i]}", end="")
