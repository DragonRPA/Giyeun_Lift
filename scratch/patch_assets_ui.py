import os
filepath = r"d:\01.AntiGravity\Giyuen_Lift\src\pages\Assets.tsx"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_str = "<td style={{ padding: '7px 6px', fontSize: '12px', textAlign: 'center' }}>{a.depreciationMonths ? `${a.depreciationMonths}M` : '-'}</td>\n                    <td style={{ padding: '7px 6px', fontSize: '12px', textAlign: 'center' }}>{a.residualValueRate != null ? `${a.residualValueRate}%` : '-'}</td>"
new_str = "<td style={{ padding: '7px 6px', fontSize: '12px', textAlign: 'center' }}>{a.depreciationMonths ? `${a.depreciationMonths}M` : '-'}</td>\n                    <td style={{ padding: '7px 6px', fontSize: '12px', textAlign: 'right', color: 'var(--text-secondary)' }}>{calculateAssetDepreciation(a).accumDepreciation ? calculateAssetDepreciation(a).accumDepreciation.toLocaleString() : '-'}</td>\n                    <td style={{ padding: '7px 6px', fontSize: '12px', textAlign: 'center' }}>{a.residualValueRate != null ? `${a.residualValueRate}%` : '-'}</td>"

if old_str in content:
    content = content.replace(old_str, new_str)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Success")
else:
    print("Not found")
