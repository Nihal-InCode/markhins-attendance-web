import sqlite3

conn = sqlite3.connect('attendance.db')
c = conn.cursor()

c.execute("""
    UPDATE teachers 
    SET phone = SUBSTR(phone, 3) 
    WHERE phone IS NOT NULL 
      AND LENGTH(phone) = 12 
      AND phone LIKE '91%'
""")

print(f"Updated {c.rowcount} teacher phone numbers — '91' prefix removed.")
conn.commit()

# Verify
c.execute("SELECT id, name, phone FROM teachers WHERE phone IS NOT NULL ORDER BY id")
for r in c.fetchall():
    print(f"  ID {r[0]} | {r[1]}: {r[2]}")

conn.close()
print("Done.")
