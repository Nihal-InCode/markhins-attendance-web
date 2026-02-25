import sqlite3

conn = sqlite3.connect('attendance.db')
c = conn.cursor()

relevant_tables = ['students', 'teachers', 'attendance', 'period_attendance', 'timetable']

for table in relevant_tables:
    print(f"\n--- Table: {table} ---")
    c.execute(f"PRAGMA table_info({table});")
    for col in c.fetchall():
        print(f"Column: {col[1]}, Type: {col[2]}")

print("\n--- Timetable Samples ---")
c.execute("SELECT * FROM timetable LIMIT 5")
for row in c.fetchall():
    print(row)

conn.close()
