import sqlite3

conn = sqlite3.connect('attendance.db')
c = conn.cursor()

print("\n--- Table: attendance ---")
c.execute("PRAGMA table_info(attendance);")
for col in c.fetchall():
    print(f"Column: {col[1]}, Type: {col[2]}")

print("\n--- Attendance Sample ---")
c.execute("SELECT * FROM attendance ORDER BY id DESC LIMIT 2")
for row in c.fetchall():
    print(row)

print("\n--- Period Attendance Sample ---")
c.execute("SELECT * FROM period_attendance ORDER BY id DESC LIMIT 2")
for row in c.fetchall():
    print(row)

conn.close()
