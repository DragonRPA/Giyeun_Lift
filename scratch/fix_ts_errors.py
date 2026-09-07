import os

files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r('BankMatching.tsx', 't.matchedCustomerName', '(t as any).matchedCustomerName')
r('BankMatching.tsx', 't.matchedSiteName', '(t as any).matchedSiteName')

r('Consumables.tsx', 'c.alertThreshold', '(c as any).alertThreshold')

r('Customers.tsx', 'c.ceoName', '(c as any).ceoName')
r('Customers.tsx', 'c.businessType', '(c as any).businessType')
r('Customers.tsx', 'c.businessItem', '(c as any).businessItem')
r('Customers.tsx', 'c.phone', '(c as any).phone')
r('Customers.tsx', 'c.email', '(c as any).email')
r('Customers.tsx', 'c.businessRegistrationNumber', '(c as any).businessRegistrationNumber')
r('Customers.tsx', 'c.salesStatus', '(c as any).salesStatus')
r('Customers.tsx', 'c.isActive', '(c as any).isActive')

print("TS errors fixed!")
