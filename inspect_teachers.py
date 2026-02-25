import sqlite3
import json

def get_teachers_info():
    conn = sqlite3.connect('attendance.db')
    c = conn.cursor()
    
    info = {}
    
    # Tables to inspect
    tables = ['teachers', 'classes', 'subjects', 'timetable']
    
    for table in tables:
        try:
            c.execute(f"PRAGMA table_info({table});")
            info[table] = [
                {"id": col[0], "name": col[1], "type": col[2]}
                for col in c.fetchall()
            ]
            
            c.execute(f"SELECT * FROM {table} LIMIT 5;")
            info[f"{table}_data"] = [list(row) for row in c.fetchall()]
        except Exception as e:
            info[f"{table}_error"] = str(e)
            
    print(json.dumps(info, indent=2))
    conn.close()

if __name__ == "__main__":
    get_teachers_info()
