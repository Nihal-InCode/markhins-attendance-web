import sqlite3
from datetime import datetime

conn = sqlite3.connect('attendance.db')
c = conn.cursor()

# Get a few dates from period_attendance and check their weekdays
c.execute("SELECT date FROM period_attendance ORDER BY id DESC LIMIT 5")
dates = [r[0] for r in c.fetchall()]

for date_str in dates:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    print(f"Date: {date_str}, Weekday: {dt.weekday()} ({dt.strftime('%A')})")

conn.close()
