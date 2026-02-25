import sqlite3
conn = sqlite3.connect('attendance.db')
c = conn.cursor()
c.execute("SELECT DISTINCT weekday FROM timetable ORDER BY weekday")
print(f"Weekdays in timetable: {[r[0] for r in c.fetchall()]}")
conn.close()
