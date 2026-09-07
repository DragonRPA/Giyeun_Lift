import sys
sys.stdout.reconfigure(encoding='utf-8')

def read_schema():
    with open(r'd:\01.AntiGravity\Giyuen_Lift\schema.sql', 'r', encoding='utf-8', errors='replace') as f:
        content = f.readlines()
    
    for i in range(360, min(430, len(content))):
        print(f"{i+1}: {content[i]}", end="")

if __name__ == '__main__':
    read_schema()
