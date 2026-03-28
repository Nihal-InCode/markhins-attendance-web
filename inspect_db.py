import sqlite3
import os

DB_PATH = "attendance.db"

def inspect():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Check system_settings
    print("--- SYSTEM SETTINGS ---")
    c.execute("SELECT * FROM system_settings")
    for row in c.fetchall():
        print(row)
    
    # Check teacher MASHOODNURANI
    print("\n--- TEACHER MASHOODNURANI ---")
    c.execute("SELECT id, name, phone, username FROM teachers WHERE LOWER(username)='mashoodnurani'")
    for row in c.fetchall():
        print(row)
        
    conn.close()

if __name__ == "__main__":
    inspect()
