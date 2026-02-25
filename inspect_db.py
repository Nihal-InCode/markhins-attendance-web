import sqlite3

conn = sqlite3.connect('attendance.db')
c = conn.cursor()

# Get tables
c.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [row[0] for row in c.fetchall()]

for table in tables:
    print(f"\n--- Table: {table} ---")
    c.execute(f"PRAGMA table_info({table});")
    for col in c.fetchall():
        print(f"Column: {col[1]}, Type: {col[2]}, NotNull: {col[3]}, PK: {col[5]}")

conn.close()
