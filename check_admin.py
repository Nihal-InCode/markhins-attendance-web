import sqlite3
conn = sqlite3.connect('attendance.db')
c = conn.cursor()
c.execute("SELECT * FROM teachers WHERE username='admin'")
print(c.fetchone())
conn.close()
