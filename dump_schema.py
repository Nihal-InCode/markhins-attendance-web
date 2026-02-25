import sqlite3
import json

def get_schema():
    conn = sqlite3.connect('attendance.db')
    c = conn.cursor()
    
    # Get tables
    c.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in c.fetchall()]
    
    schema = {}
    for table in tables:
        c.execute(f"PRAGMA table_info({table});")
        schema[table] = [
            {"id": col[0], "name": col[1], "type": col[2], "notnull": col[3], "pk": col[5]}
            for col in c.fetchall()
        ]
        
        # Also grab a few rows to see data format
        try:
            c.execute(f"SELECT * FROM {table} LIMIT 2;")
            schema[f"{table}_data"] = [list(row) for row in c.fetchall()]
        except:
            pass
            
    print(json.dumps(schema, indent=2))
    conn.close()

if __name__ == "__main__":
    get_schema()
