# attendance.py
import sqlite3
from datetime import datetime as dt
import datetime
import sys, json, os, re, shutil
import io
import html

def get_ist_now():
    """Returns the current datetime in IST (UTC + 5:30) regardless of server timezone."""
    # Use UTC then add 5:30 for India
    return dt.utcnow() + datetime.timedelta(hours=5, minutes=30)

def escape_html(text):
    if not isinstance(text, str):
        return str(text)
    return html.escape(text, quote=True)


def get_teacher_image_url(teacher_id):
    """Return the public URL for a teacher photo if a matching file exists."""
    teacher_id = str(teacher_id or "").strip()
    if not teacher_id:
        return None

    app_root = os.path.dirname(os.path.abspath(__file__))
    teachers_dir = os.path.join(app_root, "frontend", "public", "teachers")
    for extension in ("jpg", "jpeg", "png", "webp"):
        filename = f"{teacher_id}.{extension}"
        file_path = os.path.join(teachers_dir, filename)
        if os.path.exists(file_path):
            version = int(os.path.getmtime(file_path))
            return f"/teachers/{filename}?v={version}"

    return None

# === Force UTF-8 output to handle emojis on Windows ===
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# === Database Path Configuration ===
def resolve_db_path():
    configured = (os.environ.get("ATTENDANCE_DB_PATH") or "").strip()
    if configured:
        candidates = [
            configured,
            os.path.join(os.getcwd(), "attendance.db"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "attendance.db"),
            "/data/web_attendance.db",
        ]
    else:
        candidates = [
            os.path.join(os.getcwd(), "attendance.db"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "attendance.db"),
            "/data/web_attendance.db",
        ]

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate

    return configured or os.path.join(os.path.dirname(os.path.abspath(__file__)), "attendance.db")


DB_NAME = resolve_db_path()

# Ensure the directory for the database exists
db_dir = os.path.dirname(DB_NAME)
if db_dir and not os.path.exists(db_dir):
    try:
        os.makedirs(db_dir, exist_ok=True)
    except Exception as e:
        print(f"Warning: Could not create database directory {db_dir}: {e}")

# Silence startup prints for cleaner Node.js bridge communication
if "--verbose" in sys.argv:
    print("==============================")
    print("Using DB file:", DB_NAME)
    print("DB exists:", os.path.exists(DB_NAME))
    print("Current working dir:", os.getcwd())

    if os.path.exists(DB_NAME):
        try:
            conn = sqlite3.connect(DB_NAME)
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='students'")
            if c.fetchone():
                c.execute("SELECT COUNT(*) FROM students")
                print("Total students in DB:", c.fetchone()[0])
            conn.close()
        except:
            pass
    print("==============================")



# ================================
# 🔧 Database Migration - Safe Schema Updates
# ================================
def run_migrations():
    """
    Ensures database schema is up-to-date.
    Creates all necessary tables if they don't exist.
    Runs safe migrations that can be executed multiple times.
    """
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        
        # 1. CORE TABLES (from db_setup.py)
        c.execute("""
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roll_no TEXT UNIQUE,
                name TEXT,
                class TEXT,
                parent_name TEXT,
                parent_phone TEXT,
                class_teacher INTEGER DEFAULT 0
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                username TEXT UNIQUE,
                telegram_username TEXT UNIQUE,
                telegram_chat_id TEXT,
                class_teacher_of TEXT,
                subject TEXT DEFAULT 'General'
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                class TEXT,
                period TEXT,
                student_id INTEGER,
                status TEXT,
                marked_by INTEGER,
                subject TEXT,
                created_at TEXT,
                FOREIGN KEY (student_id) REFERENCES students (id),
                FOREIGN KEY (marked_by) REFERENCES teachers (id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS period_attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                class TEXT NOT NULL,
                period TEXT NOT NULL,
                student_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                teacher_id INTEGER NOT NULL,
                FOREIGN KEY (student_id) REFERENCES students (id),
                FOREIGN KEY (teacher_id) REFERENCES teachers (id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS timetable (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class TEXT NOT NULL,
                weekday INTEGER NOT NULL,
                period_label TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                subject TEXT,
                teacher_id INTEGER,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (teacher_id) REFERENCES teachers(id),
                UNIQUE(class, weekday, period_label)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS teacher_subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                class TEXT,
                subject TEXT,
                period TEXT,
                FOREIGN KEY (teacher_id) REFERENCES teachers (id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS extra_classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                class TEXT NOT NULL,
                subject TEXT NOT NULL,
                teacher TEXT NOT NULL,
                time TEXT,
                absent_rolls TEXT,
                period TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS substitute_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                class TEXT NOT NULL,
                period TEXT NOT NULL,
                subject TEXT NOT NULL,
                actual_teacher TEXT NOT NULL,
                substitute_teacher TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                name TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        # 2. MIGRATIONS & SCHEMA UPDATES
        
        # Ensure 'absent_rolls' and 'period' exist in extra_classes
        try:
            c.execute("ALTER TABLE extra_classes ADD COLUMN absent_rolls TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE extra_classes ADD COLUMN period TEXT")
        except sqlite3.OperationalError:
            pass

        # Check and add other missing columns in substitute_log
        try:
            c.execute("PRAGMA table_info(substitute_log)")
            columns = [col[1] for col in c.fetchall()]
            
            if 'period' not in columns:
                c.execute("ALTER TABLE substitute_log ADD COLUMN period TEXT")
            if 'subject' not in columns:
                c.execute("ALTER TABLE substitute_log ADD COLUMN subject TEXT")
            if 'actual_teacher' not in columns:
                c.execute("ALTER TABLE substitute_log ADD COLUMN actual_teacher TEXT")
            if 'substitute_teacher' not in columns:
                c.execute("ALTER TABLE substitute_log ADD COLUMN substitute_teacher TEXT")
        except Exception as e:
            print(f"[MIGRATION] substitute_log column update note: {e}")

        # Ensure 'created_at' exists in attendance
        try:
            c.execute("ALTER TABLE attendance ADD COLUMN created_at TEXT")
        except sqlite3.OperationalError:
            pass

        # === SESSION SYSTEM MIGRATION ===
        try:
            c.execute("ALTER TABLE teachers ADD COLUMN active_session_token TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE teachers ADD COLUMN last_login TEXT")
        except sqlite3.OperationalError:
            pass

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[MIGRATION] Error during database migration: {e}")

# Run migrations on startup
run_migrations()


# ================================
# 📊 Helper Functions
# ================================

def generate_daily_aggregate_report(c, date):
    """Generates a summary of which classes/periods have attendance taken."""
    # Legend
    report = [f"📊 <b>Daily Attendance Status — {date}</b>\n"]
    report.append("Legend:")
    report.append("✅ Taken")
    report.append("❌ Not Taken")
    report.append("🆓 Free\n")
    
    # Get all unique classes from students table
    c.execute("SELECT DISTINCT class FROM students ORDER BY class")
    classes = [row[0] for row in c.fetchall()]
    
    # Weekday for timetable check (0=Mon, ..., 6=Sun)
    current_date_obj = dt.strptime(date, "%Y-%m-%d")
    weekday = current_date_obj.weekday()
    
    for cls in classes:
        report.append(f"<b>{cls}</b>")
        line_parts = []
        # Check P1 to P7
        for p in ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]:
            # 1. Fetch Appointed Teacher from Timetable
            c.execute("""
                SELECT t.id, t.name 
                FROM timetable tt 
                JOIN teachers t ON tt.teacher_id = t.id 
                WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
            """, (cls, weekday, p))
            tt_row = c.fetchone()
            appointed_tid, appointed_name = tt_row if tt_row else (None, None)
            
            # 2. Fetch Actual Marking Teacher
            c.execute("""
                SELECT t.id, t.name 
                FROM period_attendance pa
                JOIN teachers t ON pa.teacher_id = t.id 
                WHERE pa.date=? AND pa.class=? AND pa.period=? LIMIT 1
            """, (date, cls, p))
            pa_row = c.fetchone()
            actual_tid, actual_name = pa_row if pa_row else (None, None)
            
            # 3. Apply Display Logic
            if not appointed_name and not actual_name:
                # Case 1: No class scheduled
                line_parts.append(f"{p} — 🆓 Free")
            elif actual_name:
                if str(actual_tid) == str(appointed_tid):
                    # Case 2: Taken by Appointed Teacher
                    line_parts.append(f"{p} — ✅ {escape_html(appointed_name)}")
                else:
                    # Case 4: Taken by Substitute
                    app_ref = escape_html(appointed_name) if appointed_name else "Unknown Teacher"
                    line_parts.append(f"{p} — ❌ {app_ref} {{Appointed}}\n     (SUB — {escape_html(actual_name)} ✅)")
            else:
                # Case 3: Appointed exists but attendance NOT taken
                line_parts.append(f"{p} — ❌ {escape_html(appointed_name)}")
                
        report.append("\n".join(line_parts))
        report.append("") # Spacer between classes
    return "\n".join(report)

def get_student_current_status(c, sid):
    """
    Returns the current active status ('S', 'L') or None.
    Uses the new simple state-based logic: latest record (ORDER BY date DESC, id DESC).
    """
    c.execute("""
        SELECT status FROM attendance 
        WHERE student_id = ?
        ORDER BY date DESC, id DESC LIMIT 1
    """, (sid,))
    latest = c.fetchone()
    if latest:
        stat = latest[0]
        if stat in ('S', 'L'):
            return stat
    return None

def get_active_sl_emoji(c, sid, date):
    """
    Returns ' 💊', ' 🛖' or '' for active health status.
    Uses the new simple state-based logic.
    """
    stat = get_student_current_status(c, sid)
    if stat == 'S': return " 💊"
    if stat == 'L': return " 🛖"
    return ""

def get_attendance_list(c, class_, period, date):
    """
    Get list of students for a period/class, showing their status.
    Checks for Absences in the specific period.
    Checks for ANY active Sick (S) or Leave (L) status (ongoing until Cured/Returned).
    """
    # Get all students in the class
    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_,))
    all_students = c.fetchall()

    # Get absentee records for this specific period/class/date
    c.execute("""SELECT student_id FROM period_attendance 
                 WHERE date=? AND class=? AND period=? AND status='A'""",
              (date, class_, period))
    absent_student_ids = {row[0] for row in c.fetchall()}

    # --- Determine if each student has an ACTIVE S/L status ---
    active_sl_status = {}
    for student_id, _, _ in all_students:
        c.execute("""
            SELECT status FROM attendance 
            WHERE student_id = ?
            ORDER BY date DESC, id DESC LIMIT 1
        """, (student_id,))
        latest_record = c.fetchone()
        if latest_record:
            ls_status = latest_record[0]
            if ls_status in ('S', 'L'):
                active_sl_status[student_id] = ls_status

    lines = []
    for i, (student_id, roll_no, name) in enumerate(all_students, 1):
        # Priority: Check for ACTIVE S/L status first (honors start period on same day)
        if student_id in active_sl_status:
            status_code = active_sl_status[student_id]
            if status_code == "S":
                mark = "🛌🏼"  # Sick
            elif status_code == "L":
                mark = "🏠"   # Leave
            else:
                mark = "❓"   # Should not happen
        # If not actively S/L, check for period absence
        elif student_id in absent_student_ids:
            mark = "❌"  # Absent
        else:
            # Check if attendance was explicitly recorded as present for this period
            c.execute("""SELECT status FROM period_attendance 
                         WHERE date=? AND class=? AND period=? AND student_id=?""",
                      (date, class_, period, student_id))
            attendance_record = c.fetchone()
            if attendance_record:
                if attendance_record[0] == 'P':
                    mark = "✅"  # Explicitly marked present
                elif attendance_record[0] == 'A':
                    mark = "❌"  # Marked absent (shouldn't reach here, but safety)
                else:
                    mark = "✅"  # Other status (consider as present)
            else:
                mark = "✅"  # Not recorded (considered present by default)
        lines.append(f"{i}. {escape_html(name)} {mark}")
    return "\n".join(lines)

# ===================================================
# 🧾 Get Individual Student Attendance History
# ===================================================
def get_student_stats(c, student_id, student_name, student_class, roll_no):
    """
    Calculates attendance statistics for a student.
    Returns: (total_classes, attended, percent, log)
    """
    # 1. Compute total_classes strictly using class-level attendance marks
    c.execute("SELECT COUNT(DISTINCT date || '-' || period) FROM period_attendance WHERE class = ?", (student_class,))
    count_period = c.fetchone()[0] or 0
    
    c.execute("SELECT COUNT(*) FROM extra_classes WHERE class = ?", (student_class,))
    count_extra = c.fetchone()[0] or 0
    
    total_classes = count_period + count_extra
    
    attended = 0
    log = []

    # 2. Period Attendance (Student-level for 'P' count and logs)
    c.execute("SELECT date, period, status FROM period_attendance WHERE student_id=?", (student_id,))
    for d, p, s in c.fetchall():
        if s == "P":
            attended += 1
        log.append((d, p, s))

    # 3. Sick / Leave records from attendance table (Logs only, treated as absent)
    c.execute("SELECT date, period, status FROM attendance WHERE student_id=? AND status IN ('S','L')", (student_id,))
    for d, p, s in c.fetchall():
        log.append((d, p, s))

    # 4. Extra Classes
    c.execute("SELECT date, absent_rolls, period FROM extra_classes WHERE class=?", (student_class,))
    for d, absent_str, p in c.fetchall():
        absent_list = [x.strip() for x in absent_str.split(",")] if absent_str else []
        if str(roll_no) in absent_list:
            status = "A"
        else:
            status = "P"
            attended += 1
        log.append((d, f"{p} (Extra)", status))

    percent = round((attended / total_classes) * 100, 2) if total_classes else 0
    return total_classes, attended, percent, log

def get_student_history(c, roll_no):
    # Fetch student
    c.execute("SELECT id, name, class FROM students WHERE roll_no=?", (roll_no,))
    student = c.fetchone()
    if not student:
        return f"⚠️ No student found with Roll No: {roll_no}"

    sid, sname, sclass = student
    total, attended, percent, log = get_student_stats(c, sid, sname, sclass, roll_no)

    lines = [
        f"👩🎓 <b>STUDENT REPORT</b>",
        f"Name: {sname}",
        f"Class: {sclass}",
        f"Roll No: {roll_no}",
        f"Total Classes (Inc. Extra): {total}",
        f"Attended: {attended}",
        f"Not Attended: {total - attended}",
        f"Attendance %: {percent}%",
        "",
        "📘 Attendance Log:"
    ]

    for d, p, s in sorted(log):
        lines.append(f"• {d} — {s} ({p})")

    return "\n".join(lines)


def get_period_status_summary(c, class_, period, date, teacher_name):
    """Generates a detailed status report for all students in a class for a specific period."""
    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_,))
    students = c.fetchall()
    if not students:
        return f"⚠️ No students found in class {class_}."

    # Get absentee records for this specific period/class/date
    c.execute("""SELECT student_id FROM period_attendance 
                 WHERE date=? AND class=? AND period=? AND status='A'""",
              (date, class_, period))
    absent_student_ids = {row[0] for row in c.fetchall()}

    # --- Determine if each student has an ACTIVE S/L status ---
    active_sl_status = {}
    for student_id, _, _ in students:
        c.execute("""
            SELECT status FROM attendance 
            WHERE student_id = ?
            ORDER BY date DESC, id DESC LIMIT 1
        """, (student_id,))
        latest_record = c.fetchone()
        if latest_record:
            ls_status = latest_record[0]
            if ls_status in ('S', 'L'):
                active_sl_status[student_id] = ls_status

    # Get present records for this specific period  
    c.execute("""SELECT student_id FROM period_attendance 
                 WHERE date=? AND class=? AND period=? AND status='P'""",
              (date, class_, period))
    present_student_ids = {row[0] for row in c.fetchall()}

    # Group students by status
    absent_names = []
    sick_names = []
    leave_names = []
    present_names = []

    for student_id, roll_no, name in students:
        if student_id in active_sl_status:
            status_code = active_sl_status[student_id]
            if status_code == "S":
                sick_names.append(f"{name} ({roll_no})")
            elif status_code == "L":
                leave_names.append(f"{name} ({roll_no})")
        elif student_id in absent_student_ids:
            absent_names.append(f"{name} ({roll_no})")
        else:
            present_names.append(f"{name} ({roll_no})")

    # Build Response
    lines = [f"📝 <b>Attendance Review</b>"]
    lines.append(f"📅 Date: {date}")
    lines.append(f"👤 Marked by: {teacher_name}")
    
    if absent_names:
        lines.append(f"\n❌ <b>Absent</b> ({len(absent_names)}):")
        lines.append("\n".join([f"• _{n}_" for n in absent_names]))
        
    if sick_names:
        lines.append(f"\n🛌🏼 <b>Sick</b> ({len(sick_names)}):")
        lines.append("\n".join([f"• _{n}_" for n in sick_names]))
        
    if leave_names:
        lines.append(f"\n🏠 <b>On Leave</b> ({len(leave_names)}):")
        lines.append("\n".join([f"• _{n}_" for n in leave_names]))

    if present_names:
         lines.append(f"\n✅ <b>Present</b> ({len(present_names)}):")
         if len(present_names) > 50:
             truncated = present_names[:50]
             lines.append("\n".join([f"• _{n}_" for n in truncated]))
             lines.append(f"• ...and {len(present_names)-50} more")
         else:
             lines.append("\n".join([f"• _{n}_" for n in present_names]))
    
    return "\n".join(lines)


# ================================
# 📌 Handle Teacher Messages
# ================================

def handle_message(telegram_username, chat_id, text, send_whatsapp_message):
    sender = str(chat_id)
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()

    # Schema is ensured at startup by run_migrations()

    # Special exception for .get_all_students command (system startup)
    parts = text.strip().split()
    if parts and parts[0] == ".get_all_students" and (telegram_username == "system" or chat_id == 0):
        # Allow system calls for database loading
        pass
    else:
        # Check if message is from an authorized user
        if not telegram_username:
            conn.close()
            return None  # No response for unauthorized users
        
        # Lookup teacher by Telegram username OR Chat ID
        telegram_username = telegram_username.lstrip('@').lower() if telegram_username else ""
        c.execute("""
            SELECT id, name, class_teacher_of, subject 
            FROM teachers 
            WHERE (telegram_username IS NOT NULL AND LOWER(telegram_username) = ?) 
               OR (telegram_chat_id IS NOT NULL AND telegram_chat_id = ?)
        """, (telegram_username, str(chat_id)))
        
        teacher = c.fetchone()

        if not teacher:
            conn.close()
            print(f"⚠️ Unauthorized access attempt from @{telegram_username}")
            return f"❌ Access Denied\n\nUser @{telegram_username} is not registered in the system.\n\nPlease contact the administrator to register your Telegram username."

        teacher_id, teacher_name, class_teacher_of, subject_from_db = teacher

        # Update telegram_chat_id if provided
        if chat_id:
            try:
                c.execute("UPDATE teachers SET telegram_chat_id = ? WHERE id = ?", (str(chat_id), teacher_id))
                conn.commit()
            except Exception as e:
                print(f"Error updating chat_id: {e}")

    # Helper for Time in proper format
    utc_now = dt.utcnow()
    ist_now = utc_now + datetime.timedelta(hours=5, minutes=30)
    
    today = ist_now.strftime("%Y-%m-%d")  # Keep DB format for queries
    today_display = ist_now.strftime("%d.%m.%Y")  # Display format
    now_ts = ist_now.strftime("%Y-%m-%d %H:%M:%S")  # For created_at
    current_time_str = ist_now.strftime("%I:%M %p")

    # Hardcoded Admin Usernames
    ADMIN_USERNAMES = {"library_number", "markhins_official"}
    
    # Centralized Admin Check Function
    def is_admin(username):
        if not username: return False
        return username.lower() in ADMIN_USERNAMES

    # Handle Admin Bootstrap / Claim Admin
    if text.strip() == "/claim_admin":
        if telegram_username and telegram_username.lower() in ADMIN_USERNAMES:
            conn.close()
            return f"✅ Welcome Admin {telegram_username}! You have full access to all admin features."
        else:
            conn.close()
            return "❌ Access Denied: You are not an authorized admin. Contact developer or markhins_official for access."

    # Map teacher notifications (sender is the one marking)
    # attendance.created_at is handled in run_migrations()
    parts = text.strip().split()
    if not parts:
        conn.close()
        return "❓ Empty message."

    # ========== SESSION INTEGRATION - START ==========
    # Import session integration modules
    try:
        from attendance_session_integration import (
            process_attendance_with_sessions,
            handle_extra_class_commands
        )
        
        # Route session-based commands
        if text.startswith('/request_extra') or text.startswith('/start_session') or \
           text.startswith('/list_sessions') or text.startswith('/my_sessions'):
            
            reply = handle_extra_class_commands(
                telegram_username, chat_id, text, c, conn
            )
            notifications = reply[1] if isinstance(reply, tuple) else []
            # Send any notifications
            if notifications and send_whatsapp_message:
                for notif in notifications:
                    if 'telegram_chat_id' in notif and 'message' in notif:
                        send_whatsapp_message(notif['telegram_chat_id'], notif['message'])
            conn.close()
            return reply[0] if isinstance(reply, tuple) else reply
        
        # Check for time-based attendance (format: "HS1 14:30 1,2,3,A4")
        if len(parts) >= 3 and ':' in parts[1]:
            reply = process_attendance_with_sessions(
                telegram_username, chat_id, text, c, conn
            )
            notifications = reply[1] if isinstance(reply, tuple) else []
            # Send any notifications
            if notifications and send_whatsapp_message:
                for notif in notifications:
                    if 'telegram_chat_id' in notif and 'message' in notif:
                        send_whatsapp_message(notif['telegram_chat_id'], notif['message'])
            conn.close()
            return reply[0] if isinstance(reply, tuple) else reply
    except ImportError:
        # Session integration not available, continue with regular flow
        pass
    # ========== SESSION INTEGRATION - END ==========

    # Handle .edit prefix
    if parts[0].lower() == '.edit':
        parts = parts[1:]
        if not parts:
            conn.close()
            return "❌ No command provided after .edit"

    cmd = parts[0].lower()
    response = ""
    error_messages = []  # Separate error messages from main response

    # ================================
    # EXTRA CLASS MARKING (e.g., extra BS1 Mathematics)
    # ================================
    if cmd == "extra" or cmd == ".extra":
        if len(parts) < 3:
            conn.close()
            return "❌ Invalid format. Use: extra CLASS SUBJECT\nExample: extra BS1 Mathematics"
        
        class_name = parts[1].upper()
        subject_name = " ".join(parts[2:])  # Join remaining parts as subject name
        
        try:
            # Try to update existing manual entry if exists
            c.execute("""
                SELECT id FROM extra_classes 
                WHERE date=? AND class=? AND subject=? AND teacher=?
                ORDER BY created_at DESC LIMIT 1
            """, (today, class_name, subject_name, teacher_name))
            existing_extra = c.fetchone()
            
            if existing_extra:
                c.execute("""
                    UPDATE extra_classes 
                    SET time=?, absent_rolls=''
                    WHERE id=?
                """, (current_time_str, existing_extra[0]))
            else:
                c.execute("""
                    INSERT INTO extra_classes (date, class, subject, teacher, time, absent_rolls)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (today, class_name, subject_name, teacher_name, current_time_str, ""))
            conn.commit()
            
            response = (
                f"✅ <b>Present</b>\n\n"
                f"📅 Date: {today}\n"
                f"🏫 Class: {class_name}\n"
                f"📘 Subject: {subject_name}\n"
                f"👨‍🏫 Teacher: {teacher_name}\n"
                f"⏰ Time: {current_time_str}"
            )
            conn.close()
            return response
        except Exception as e:
            conn.close()
            return f"❌ Error recording extra class: {str(e)}"

    # ================================
    # EXTRA CLASS WITH ATTENDANCE
    # Usage: extra_att <CLASS> <SUBJECT> <ABSENT_ROLLS...>
    # ================================
    elif cmd == "extra_att" or cmd == ".extra_att":
        if len(parts) < 3:
            conn.close()
            return "❌ Invalid format."
            
        class_name = parts[1].upper()
        # Parse subject, period and rolls
        all_args = parts[2:]
        subject_parts = []
        rolls = []
        period_val = "Extra" # Default
        
        for arg in all_args:
            if arg.isdigit():
                rolls.append(arg)
            elif re.match(r"^[pP]\d+$", arg):
                period_val = arg.upper()
            else:
                subject_parts.append(arg)
        
        subject_name = " ".join(subject_parts)
        if not subject_name: 
            subject_name = "Unknown Subject"
            
        absent_rolls_str = ",".join(rolls)
        
        try:
            # Get all students in the class
            c.execute("SELECT id, roll_no, name FROM students WHERE class=?", (class_name,))
            all_students = c.fetchall()
            total_students = len(all_students)
            
            active_sick_rolls = set()
            active_leave_rolls = set()
            active_sick_details = []
            active_leave_details = []

            # Identify Sick/Leave students
            for student_id, roll_no, name in all_students:
                # 1. Find the MOST RECENT S or L record for this student
                c.execute("""
                    SELECT id, status, date, period FROM attendance 
                    WHERE student_id = ? AND status IN ('S', 'L') 
                    ORDER BY date DESC, id DESC LIMIT 1
                """, (student_id,))
                latest_sl = c.fetchone()
                
                is_active = False
                status_type = None
                
                if latest_sl:
                    sl_id, sl_status, sl_date, sl_period = latest_sl
                    # Check if cured/returned after
                    c.execute("""
                        SELECT 1 FROM attendance 
                        WHERE student_id = ? AND status IN ('C', 'R') 
                        AND (date > ? OR (date = ? AND id > ?))
                        LIMIT 1
                    """, (student_id, sl_date, sl_date, sl_id))
                    has_returned = c.fetchone()
                    
                    if not has_returned:
                        # Simple day-based check for Extra Class (assumes S/L applies to whole day/remaining day)
                        if sl_date == today:
                             is_active = True
                             status_type = sl_status
                        elif sl_date < today:
                             is_active = True
                             status_type = sl_status
                
                if is_active:
                    detail = f"{escape_html(roll_no)} {escape_html(name)} ({escape_html(class_name)})"
                    if status_type == 'S':
                        active_sick_rolls.add(str(roll_no))
                        active_sick_details.append(detail)
                    elif status_type == 'L':
                        active_leave_rolls.add(str(roll_no))
                        active_leave_details.append(detail)

            # Calculate stats
            absent_rolls_set = set(rolls)
            
            # Combine all non-present
            all_non_present = absent_rolls_set | active_sick_rolls | active_leave_rolls
            present_count = total_students - len(all_non_present)
            
            # Get absentee details for summary
            absent_details = []
            if rolls:
                placeholders = ','.join(['?'] * len(rolls))
                c.execute(f"SELECT roll_no, name FROM students WHERE class=? AND roll_no IN ({placeholders})", tuple([class_name] + rolls))
                absent_details = [f"{escape_html(r[0])} {escape_html(r[1])} ({escape_html(class_name)})" for r in c.fetchall()]

            # Try to update existing record instead of creating duplicate if within same session
            c.execute("""
                SELECT id FROM extra_classes 
                WHERE date=? AND class=? AND subject=? AND teacher=? AND period=?
                ORDER BY created_at DESC LIMIT 1
            """, (today, class_name, subject_name, teacher_name, period_val))
            existing_extra = c.fetchone()

            if existing_extra:
                c.execute("""
                    UPDATE extra_classes 
                    SET absent_rolls=?, time=?
                    WHERE id=?
                """, (absent_rolls_str, current_time_str, existing_extra[0]))
            else:
                c.execute("""
                    INSERT INTO extra_classes (date, class, subject, teacher, time, absent_rolls, period)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (today, class_name, subject_name, teacher_name, current_time_str, absent_rolls_str, period_val))
            conn.commit()
            
            # Build Summary
            summary_parts = []
            
            if rolls:
                summary_parts.append(f"❌ Absent: {len(rolls)}")
            if active_sick_rolls:
                summary_parts.append(f"🛌 Sick: {len(active_sick_rolls)}")
            if active_leave_rolls:
                summary_parts.append(f"🏠 Leave: {len(active_leave_rolls)}")
            
            if not summary_parts:
                summary_text = "Attendance: All students present"
            else:
                summary_text = " | ".join(summary_parts)
                if rolls:
                     summary_text += f"\n\n❌ Absentees ({len(rolls)}):\n" + "\n".join([f"• {x}" for x in absent_details])
                
                if active_sick_details:
                     summary_text += f"\n\n🩺 Sick Students ({len(active_sick_details)}):\n" + "\n".join([f"• {x}" for x in sorted(active_sick_details)])

                if active_leave_details:
                     summary_text += f"\n\n🏠 On Leave ({len(active_leave_details)}):\n" + "\n".join([f"• {x}" for x in sorted(active_leave_details)])

            response_reply = (
                f"✅ <b>Extra class & Attendance recorded</b>\n\n"
                f"📅 Date: {escape_html(today)}\n"
                f"🏫 Class: {escape_html(class_name)}\n"
                f"📘 Subject: {escape_html(subject_name)}\n"
                f"⏰ Period: {escape_html(period_val)}\n"
                f"⏰ Time: {escape_html(current_time_str)}\n\n"
                f"📊 <b>Attendance Summary:</b>\n"
                f"Total Students: {total_students}\n"
                f"✅ Present: {present_count}\n"
                f"❌ Absent: {len(rolls)}\n"
                f"🛌 Sick: {len(active_sick_rolls)}\n"
                f"🏠 Leave: {len(active_leave_rolls)}\n\n"
                f"{summary_text}"
            )

            # Notifications logic
            notifications = []
            
            # Message template for Class Teacher
            notif_msg_teacher = (
                f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                f"📘 <b>Extra Class Attendance</b>\n\n"
                f"📅 Date: {escape_html(today)}\n"
                f"🏫 Class: {escape_html(class_name)}\n"
                f"📘 Subject: {escape_html(subject_name)}\n"
                f"👨‍🏫 Teacher: {escape_html(teacher_name)}\n\n"
                f"📊 {escape_html(summary_text)}"
            )

            # Message template for Principal
            notif_msg_principal = (
                f"🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>\n\n"
                f"📘 <b>Extra Class Attendance</b>\n\n"
                f"📅 Date: {escape_html(today)}\n"
                f"🏫 Class: {escape_html(class_name)}\n"
                f"📘 Subject: {escape_html(subject_name)}\n"
                f"👨‍🏫 Teacher: {escape_html(teacher_name)}\n\n"
                f"📊 {escape_html(summary_text)}"
            )

            # 1. Notify Class Teacher
            c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (class_name,))
            ct_row = c.fetchone()
            if ct_row and ct_row[0]:
                notifications.append({"chat_id": str(ct_row[0]), "message": notif_msg_teacher, "role": "Class Teacher"})

            # 2. Notify Principal
            c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = 'PRINCIPAL' OR UPPER(name) = 'PRINCIPAL'")
            p_row = c.fetchone()
            if p_row and p_row[0]:
                notifications.append({"chat_id": str(p_row[0]), "message": notif_msg_principal, "role": "Principal"})

            conn.close()
            # Return data for Node.js via the regular handle_message return
            # notifications is already a list of dicts that handle_message uses
            for n in notifications:
                send_whatsapp_message(n.get("chat_id"), n.get("message"))
            
            return response_reply
        except Exception as e:
            conn.close()
            return f"❌ Error recording extra class: {str(e)}"


    # ================================
    # Period Attendance Marking (e.g., p1 A 1201 1202)
    # Also handles Substitute Marking (e.g., sp1 10A A 1201)
    # ================================
    is_substitute = False
    if cmd.startswith("sp"):
        is_substitute = True
        cmd = cmd[1:] # Remove 's' prefix to treat as normal period command
        parts[0] = parts[0][1:] # Update parts[0] too

    if cmd.startswith("p") or cmd.startswith("P"):
        period_input = parts[0].upper()
        if not re.match(r"^P\d+$", period_input):
            conn.close()
            return "❌ Invalid period format. Use 'P' followed by a number (e.g., P1, P2)."
        period = period_input
        
        # The command should be like "p1 A 1201 1202" where 'A' is the only explicit status
        # The system will then determine S/L/P for other students.
        explicit_absent_rolls_in_command = set(re.findall(r"\d+", " ".join(parts[2:])))
        
        # Get the class from the command itself, rolls, or assume class_teacher_of
        target_class = None
        
        # 1. Check if class is provided in command (Bot sends e.g. "P1 12A A")
        if len(parts) > 1:
            potential_class = parts[1].upper()
            if potential_class not in ['A', 'S', 'L', 'P', 'R', 'C']:
                target_class = potential_class

        # 2. Prefer class from roll numbers if provided (overrides bot class if rolls belong elsewhere)
        if explicit_absent_rolls_in_command:
            first_roll = next(iter(explicit_absent_rolls_in_command))
            c.execute("SELECT class FROM students WHERE roll_no=?", (first_roll,))
            row = c.fetchone()
            if row:
                target_class = row[0]
        
        # 3. Fallback to teacher's assigned class
        if not target_class:
            if class_teacher_of and class_teacher_of != "PRINCIPAL":
                target_class = class_teacher_of
            else:
                conn.close()
                return "❌ Could not determine class. Please specify at least one student roll number or ensure you are a class teacher."

        # Check if attendance is already marked for this class + period + date
        # If it's an edit (starts with .edit), we bypass this guard to allow updates
        if not text.startswith('.edit'):
            c.execute("SELECT 1 FROM period_attendance WHERE class=? AND date=? AND period=? LIMIT 1", (target_class, today, period))
            if c.fetchone():
                conn.close()
                return f"❌ Attendance for {target_class} - {period} has already been marked for today ({today})."
        
        # ========== SUBSTITUTE DETECTION - START ==========
        notifications_to_send = [] # Initialize here to capture substitute notifications
        principal_notifications = [] # Initialize here too

        # Detect if this teacher is substituting for another teacher's period
        # Step 1: Detect Substitute
        current_date_obj = dt.strptime(today, "%Y-%m-%d")
        current_weekday = current_date_obj.weekday()
        
        c.execute("""
            SELECT t.id, t.name, tt.subject
            FROM timetable tt
            JOIN teachers t ON tt.teacher_id = t.id
            WHERE tt.class = ? AND tt.weekday = ? AND tt.period_label = ?
        """, (target_class, current_weekday, period))
        
        timetable_entry = c.fetchone()
        
        # Explicit substitute variable as requested
        substitute_detected = False 
        
        if timetable_entry:
            scheduled_teacher_id, scheduled_teacher_name, scheduled_subject = timetable_entry
            
            # START USER RULES: markedTeacher !== timetableTeacher
            
            if str(scheduled_teacher_id) != str(teacher_id):
                substitute_detected = True # This maps to isSubstitute
                marked_teacher_name = teacher_name
                actual_teacher_name = scheduled_teacher_name
                subject_name = scheduled_subject if scheduled_subject else "General"
                
                # Step 3: Log Substitute in Database
                # Insert both IDs (for NOT NULL constraints) and names (for readability)
                
                c.execute("""
                    INSERT INTO substitute_log
                    (date, class, period, subject, 
                     scheduled_teacher_id, substitute_teacher_id,
                     actual_teacher, substitute_teacher)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (today, target_class, period, subject_name, 
                      scheduled_teacher_id, teacher_id,
                      actual_teacher_name, marked_teacher_name))
                conn.commit()
                
                # Step 2: Send Notifications
                
                # A) Message to Actual (Assigned) Teacher
                c.execute("SELECT telegram_chat_id FROM teachers WHERE id = ?", (scheduled_teacher_id,))
                actual_teacher_row = c.fetchone()
                if actual_teacher_row and actual_teacher_row[0]:
                    actual_teacher_chat_id = actual_teacher_row[0]
                    msg_actual = (
                        f"ℹ️ Substitute Class Update\n\n"
                        f"Your scheduled class was taken by a substitute today.\n\n"
                        f"📅 Date: {escape_html(today)}\n"
                        f"🏫 Class: {escape_html(target_class)}\n"
                        f"⏰ Period: {escape_html(period)}\n"
                        f"📘 Subject: {escape_html(subject_name)}\n"
                        f"👨‍🏫 Taken by: {escape_html(marked_teacher_name)}"
                    )
                    notifications_to_send.append({"chat_id": str(actual_teacher_chat_id), "message": msg_actual})
                
                # B) Message to Class Group (via Class Teacher)
                c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (target_class,))
                class_teacher_row = c.fetchone()
                if class_teacher_row and class_teacher_row[0]:
                    class_group_chat_id = class_teacher_row[0]
                    msg_class = (
                        f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                        f"📢 Class Update\n\n"
                        f"📅 Date: {escape_html(today)}\n"
                        f"🏫 Class: {escape_html(target_class)}\n"
                        f"⏰ Period: {escape_html(period)}\n"
                        f"📘 Subject: {escape_html(subject_name)}\n\n"
                        f"Assigned Teacher: {escape_html(actual_teacher_name)}\n"
                        f"Substitute Teacher: {escape_html(marked_teacher_name)}"
                    )
                    # Check if actual teacher is same as class teacher to avoid dupe, though text is different so sending both might be okay. 
                    # But traditionally one person doesn't need 2 msgs.
                    if not actual_teacher_row or (actual_teacher_row and actual_teacher_row[0] != class_group_chat_id):
                        notifications_to_send.append({"chat_id": str(class_group_chat_id), "message": msg_class})

                # Fetch substitute teacher's normally assigned subject for this class
                c.execute("SELECT DISTINCT subject FROM timetable WHERE teacher_id = ? AND UPPER(class) = UPPER(?) LIMIT 1", (teacher_id, target_class))
                sub_subject_row = c.fetchone()
                sub_teacher_subject = sub_subject_row[0] if sub_subject_row and sub_subject_row[0] else "Not assigned for this class"

                # C) Message to Principal / Admin
                c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of)='PRINCIPAL' OR UPPER(name)='PRINCIPAL' LIMIT 1")
                principal_row = c.fetchone()
                if principal_row and principal_row[0]:
                    principal_chat_id = principal_row[0]
                    msg_principal = (
                        f"🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>\n\n"
                        f"📄 Substitute Class Report\n\n"
                        f"Date: {escape_html(today)}\n"
                        f"Class: {escape_html(target_class)}\n"
                        f"Period: {escape_html(period)}\n"
                        f"Subject: {escape_html(subject_name)}\n\n"
                        f"Assigned Teacher: {escape_html(actual_teacher_name)}\n"
                        f"Substitute Teacher: {escape_html(marked_teacher_name)}\n"
                        f"Substitute’s Subject: {escape_html(sub_teacher_subject)}"
                    )
                    notifications_to_send.append({"chat_id": str(principal_chat_id), "message": msg_principal})

        # ========== SUBSTITUTE DETECTION - END ==========

        # Get all students in the target class
        c.execute("SELECT id, roll_no, name, parent_phone FROM students WHERE class=? ORDER BY roll_no", (target_class,))
        all_students_in_class = c.fetchall()

        if not all_students_in_class:
            conn.close()
            return f"❌ No students found in class {target_class}."

        # --- Determine active S/L status for all students in the class ---
        active_sl_status = {} # {student_id: 'S' or 'L'}
        for student_id, _, _, _ in all_students_in_class:
            c.execute("""
                SELECT status FROM attendance 
                WHERE student_id = ?
                ORDER BY date DESC, id DESC LIMIT 1
            """, (student_id,))
            latest_record = c.fetchone()
            if latest_record:
                ls_status = latest_record[0]
                if ls_status in ('S', 'L'):
                    active_sl_status[student_id] = ls_status


        absent_names = []
        sick_names = []
        leave_names = []
        present_names = []
        # notifications_to_send is already initialized in substitute block
        # principal_notifications is already initialized in substitute block
        
        students_processed_in_this_command = set() # To track rolls from the command

        for student_id, roll_no, student_name, parent_phone in all_students_in_class:
            final_status = 'P' # Default to Present

            # Priority 1: Explicitly marked Absent in the command
            if str(roll_no) in explicit_absent_rolls_in_command:
                final_status = 'A'
                absent_names.append(f"{student_name} ({roll_no})")
                explicit_absent_rolls_in_command.discard(str(roll_no)) # Remove to avoid re-processing

            # Priority 2: Active Sick/Leave status
            elif student_id in active_sl_status:
                final_status = active_sl_status[student_id]
                if final_status == 'S':
                    sick_names.append(f"{student_name} ({roll_no})")
                elif final_status == 'L':
                    leave_names.append(f"{student_name} ({roll_no})")
            
            # Priority 3: Otherwise, Present (default)
            else:
                present_names.append(f"{student_name} ({roll_no})")

            # Insert or Update period_attendance
            c.execute("""SELECT id FROM period_attendance 
                         WHERE student_id=? AND date=? AND period=? AND class=?""",
                      (student_id, today, period, target_class))
            existing_record = c.fetchone()

            if existing_record:
                c.execute("UPDATE period_attendance SET status=?, teacher_id=? WHERE id=?",
                          (final_status, teacher_id, existing_record[0]))
            else:
                c.execute("INSERT INTO period_attendance (date, class, period, student_id, status, teacher_id) VALUES (?, ?, ?, ?, ?, ?)",
                          (today, target_class, period, student_id, final_status, teacher_id))

            # Prepare notifications based on final_status
            if final_status == 'A' and parent_phone:
                notification_msg = (f"📚 Greetings! Your ward, <b>{escape_html(student_name)}</b> "
                                    f"(Roll: {escape_html(roll_no)}), was marked <b>absent</b> for <b>Period {escape_html(period)}</b> in <b>{escape_html(target_class)}</b> "
                                    f"today ({escape_html(today)}). Warm regards, MARKHINS Administration 🌟")
                notifications_to_send.append({"chat_id": str(parent_phone), "message": notification_msg})
                principal_notifications.append({
                    "student_name": student_name, "roll": roll_no, "student_class": target_class,
                    "status": "Absent", "period": period
                })
            elif final_status == 'S' and parent_phone:
                notification_msg = (f"🩺 Update: Your ward, <b>{escape_html(student_name)}</b> "
                                    f"(Roll: {escape_html(roll_no)}), has an active <b>Sick</b> for <b>Period {escape_html(period)}</b> today ({escape_html(today)}).")
                notifications_to_send.append({"chat_id": str(parent_phone), "message": notification_msg})
                principal_notifications.append({
                    "student_name": student_name, "roll": roll_no, "student_class": target_class,
                    "status": "Sick", "period": period
                })
            elif final_status == 'L' and parent_phone:
                notification_msg = (f"🏠 Update: Your ward, <b>{escape_html(student_name)}</b> "
                                    f"(Roll: {escape_html(roll_no)}), has an active <b>Leave</b> for <b>Period {escape_html(period)}</b> today ({escape_html(today)}).")
                notifications_to_send.append({"chat_id": str(parent_phone), "message": notification_msg})
                principal_notifications.append({
                    "student_name": student_name, "roll": roll_no, "student_class": target_class,
                    "status": "Leave", "period": period
                })

        # Handle any rolls in the command that were not found in the class
        for roll in explicit_absent_rolls_in_command:
            response += f"⚠️ Student with roll {roll} not found in class {target_class}. 😊\n"

        # Send consolidated Principal notification
        if principal_notifications:
            principal_phone = None
            c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of)='PRINCIPAL' OR UPPER(name)='PRINCIPAL' LIMIT 1")
            principal_record = c.fetchone()
            if principal_record:
                principal_phone = principal_record[0]
            if principal_phone and principal_phone != str(chat_id):
                principal_msg_lines = [f"📋 ATTENDANCE REPORT - MARKHINS BOT"]
                principal_msg_lines.append(f"Date: {escape_html(today)}")
                principal_msg_lines.append(f"Period: {escape_html(period)}")
                principal_msg_lines.append(f"Class: {escape_html(target_class)}")
                principal_msg_lines.append(f"Submitted by: {escape_html(teacher_name)}")
                principal_msg_lines.append(f"")
                
                if absent_names:
                    principal_msg_lines.append(f"ABSENT STUDENTS:")
                    for name in absent_names:
                        principal_msg_lines.append(f"• {escape_html(name)}")
                if sick_names:
                    principal_msg_lines.append(f"SICK STUDENTS:")
                    for name in sick_names:
                        principal_msg_lines.append(f"• {escape_html(name)}")
                if leave_names:
                    principal_msg_lines.append(f"ON LEAVE STUDENTS:")
                    for name in leave_names:
                        principal_msg_lines.append(f"• {escape_html(name)}")
                
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"Total Absentees (A+S+L): {len(absent_names) + len(sick_names) + len(leave_names)}")
                principal_msg_lines.append(f"Total Present: {len(present_names)}")
                principal_msg_lines.append(f"━━━━━━━━━━━━━━━━━━━━━")
                principal_msg_lines.append(f"MARKHINS Attendance System")
                send_whatsapp_message(principal_phone, "\n".join(principal_msg_lines))

        # Notify Class Teacher if different from sender
        c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (target_class,))
        ct_record = c.fetchone()
        if ct_record and ct_record[0] and ct_record[0] != str(chat_id):
            ct_chat_id = ct_record[0]
            ct_msg_lines = [f"📋 SUBSTITUTE ATTENDANCE REPORT" if is_substitute else f"📋 ATTENDANCE REPORT"]
            ct_msg_lines.append(f"Date: {escape_html(today)}")
            ct_msg_lines.append(f"Period: {escape_html(period)}")
            ct_msg_lines.append(f"Class: {escape_html(target_class)}")
            ct_msg_lines.append(f"Submitted by: {escape_html(teacher_name)}")
            ct_msg_lines.append(f"")
            
            if absent_names:
                ct_msg_lines.append(f"ABSENT STUDENTS:")
                for name in absent_names:
                    ct_msg_lines.append(f"• {escape_html(name)}")
            if sick_names:
                ct_msg_lines.append(f"SICK STUDENTS:")
                for name in sick_names:
                    ct_msg_lines.append(f"• {escape_html(name)}")
            if leave_names:
                ct_msg_lines.append(f"ON LEAVE STUDENTS:")
                for name in leave_names:
                    ct_msg_lines.append(f"• {escape_html(name)}")
            
            ct_msg_lines.append(f"")
            ct_msg_lines.append(f"Total Absentees: {len(absent_names) + len(sick_names) + len(leave_names)}")
            ct_msg_lines.append(f"Total Present: {len(present_names)}")
            ct_msg_lines.append(f"━━━━━━━━━━━━━━━━━━━━━")
            send_whatsapp_message(ct_chat_id, "\n".join(ct_msg_lines))

        # Send other notifications
        for notification in notifications_to_send:
            send_whatsapp_message(notification.get("chat_id") or notification.get("to"), notification.get("message") or notification.get("text"))

        conn.commit()
        
        response_parts = []
        response_parts.append(f"📝 <b>Period {escape_html(period)} Attendance</b> for <b>{escape_html(target_class)}</b> marked by {escape_html(teacher_name)}:")
        
        if absent_names:
            response_parts.append(f"\n❌ <b>Absent</b> ({len(absent_names)}):")
            response_parts.append("\n".join([f"• _{escape_html(n)}_" for n in absent_names]))
            
        if sick_names:
            response_parts.append(f"\n🛌🏼 <b>Sick</b> ({len(sick_names)}):")
            response_parts.append("\n".join([f"• _{escape_html(n)}_" for n in sick_names]))
            
        if leave_names:
            response_parts.append(f"\n🏠 <b>On Leave</b> ({len(leave_names)}):")
            response_parts.append("\n".join([f"• _{escape_html(n)}_" for n in leave_names]))

        if present_names:
             response_parts.append(f"\n✅ <b>Present</b> ({len(present_names)}):")
             if len(present_names) > 50:
                  truncated = present_names[:50]
                  response_parts.append("\n".join([f"• _{escape_html(n)}_" for n in truncated]))
                  response_parts.append(f"• ...and {len(present_names)-50} more")
             else:
                  response_parts.append("\n".join([f"• _{escape_html(n)}_" for n in present_names]))
        
        response = "\n".join(response_parts)
        
        # Add substitute notification to response
        if substitute_detected:
            response += "\n\n━━━━━━━━━━━━━━━━━━━━━"
            response += "\n🔄 <b>SUBSTITUTE CLASS</b>"
            response += "\n━━━━━━━━━━━━━━━━━━━━━"
            response += "\nThis period is not assigned to you in the timetable."
            response += "\nNotifications sent to:"
            response += "\n• Scheduled teacher"
            response += "\n• Principal"
            response += "\n• Class teacher"
       

    # ================================
    # ALL PRESENT COMMAND
    # Usage: "all present P1 BS3"
    # ================================
    elif cmd == "all" and len(parts) >= 3 and parts[1].lower() == "present":
        period_input = parts[2].upper()
        if not re.match(r"^P\d+$", period_input):
            conn.close()
            return "❌ Invalid format. Use: all present P1 BS3"

        period = period_input
        class_ = parts[3].upper() if len(parts) > 3 else None
        if not class_:
            conn.close()
            return "❌ Missing class name. Use: all present P1 BS3"
        
        # Rename class_ to target_class for consistency with regular marking flow
        target_class = class_
        
        # Check if attendance is already marked for this class + period + date
        c.execute("SELECT 1 FROM period_attendance WHERE class=? AND date=? AND period=? LIMIT 1", (target_class, today, period))
        if c.fetchone():
            conn.close()
            return f"❌ Attendance for {target_class} - {period} has already been marked for today ({today})."

        # ========== SUBSTITUTE DETECTION - START ==========
        # (Same logic as regular attendance marking)
        notifications_to_send = [] # Initialize here to capture substitute notifications
        principal_notifications = [] # Initialize here too

        # Detect if this teacher is substituting for another teacher's period
        current_date_obj = dt.strptime(today, "%Y-%m-%d")
        current_weekday = current_date_obj.weekday()
        
        c.execute("""
            SELECT t.id, t.name, tt.subject
            FROM timetable tt
            JOIN teachers t ON tt.teacher_id = t.id
            WHERE tt.class = ? AND tt.weekday = ? AND tt.period_label = ?
        """, (target_class, current_weekday, period))
        
        timetable_entry = c.fetchone()
        
        # Explicit substitute variable
        substitute_detected = False 
        
        if timetable_entry:
            scheduled_teacher_id, scheduled_teacher_name, scheduled_subject = timetable_entry
            
            # Check if marked teacher is different from scheduled teacher
            if str(scheduled_teacher_id) != str(teacher_id):
                substitute_detected = True
                marked_teacher_name = teacher_name
                actual_teacher_name = scheduled_teacher_name
                subject_name = scheduled_subject if scheduled_subject else "General"
                
                # Log Substitute in Database
                c.execute("""
                    INSERT INTO substitute_log
                    (date, class, period, subject, 
                     scheduled_teacher_id, substitute_teacher_id,
                     actual_teacher, substitute_teacher)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (today, target_class, period, subject_name, 
                      scheduled_teacher_id, teacher_id,
                      actual_teacher_name, marked_teacher_name))
                conn.commit()
                
                # Send Substitute Notifications
                # A) Message to Actual (Assigned) Teacher
                c.execute("SELECT telegram_chat_id FROM teachers WHERE id = ?", (scheduled_teacher_id,))
                actual_teacher_row = c.fetchone()
                if actual_teacher_row and actual_teacher_row[0]:
                    actual_teacher_chat_id = actual_teacher_row[0]
                    msg_actual = (
                        f"ℹ️ Substitute Class Update\n\n"
                        f"Your scheduled class was taken by a substitute today.\n\n"
                        f"📅 Date: {escape_html(today)}\n"
                        f"🏫 Class: {escape_html(target_class)}\n"
                        f"⏰ Period: {escape_html(period)}\n"
                        f"📘 Subject: {escape_html(subject_name)}\n"
                        f"👨‍🏫 Taken by: {escape_html(marked_teacher_name)}"
                    )
                    notifications_to_send.append({"chat_id": str(actual_teacher_chat_id), "message": msg_actual})
                
                # B) Message to Class Group (via Class Teacher)
                c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (target_class,))
                class_teacher_row = c.fetchone()
                if class_teacher_row and class_teacher_row[0]:
                    class_group_chat_id = class_teacher_row[0]
                    msg_class = (
                        f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                        f"📢 Class Update\n\n"
                        f"📅 Date: {escape_html(today)}\n"
                        f"🏫 Class: {escape_html(target_class)}\n"
                        f"⏰ Period: {escape_html(period)}\n"
                        f"📘 Subject: {escape_html(subject_name)}\n\n"
                        f"Assigned Teacher: {escape_html(actual_teacher_name)}\n"
                        f"Substitute Teacher: {escape_html(marked_teacher_name)}"
                    )
                    # Check if actual teacher is same as class teacher to avoid dupe
                    if not actual_teacher_row or (actual_teacher_row and actual_teacher_row[0] != class_group_chat_id):
                        notifications_to_send.append({"chat_id": str(class_group_chat_id), "message": msg_class})

                # Fetch substitute teacher's normally assigned subject for this class
                c.execute("SELECT DISTINCT subject FROM timetable WHERE teacher_id = ? AND UPPER(class) = UPPER(?) LIMIT 1", (teacher_id, target_class))
                sub_subject_row = c.fetchone()
                sub_teacher_subject = sub_subject_row[0] if sub_subject_row and sub_subject_row[0] else "Not assigned for this class"

                # C) Message to Principal / Admin
                c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of)='PRINCIPAL' OR UPPER(name)='PRINCIPAL' LIMIT 1")
                principal_row = c.fetchone()
                if principal_row and principal_row[0]:
                    principal_chat_id = principal_row[0]
                    msg_principal = (
                        f"🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>\n\n"
                        f"📄 Substitute Class Report\n\n"
                        f"Date: {escape_html(today)}\n"
                        f"Class: {escape_html(target_class)}\n"
                        f"Period: {escape_html(period)}\n"
                        f"Subject: {escape_html(subject_name)}\n\n"
                        f"Assigned Teacher: {escape_html(actual_teacher_name)}\n"
                        f"Substitute Teacher: {escape_html(marked_teacher_name)}\n"
                        f"Substitute’s Subject: {escape_html(sub_teacher_subject)}"
                    )
                    notifications_to_send.append({"chat_id": str(principal_chat_id), "message": msg_principal})

        # ========== SUBSTITUTE DETECTION - END ==========

        # ---------------------------------
        # Fetch all students of the class
        # ---------------------------------
        c.execute("SELECT id, roll_no, name, parent_phone FROM students WHERE class=? ORDER BY roll_no", (target_class,))
        all_students = c.fetchall()
        if not all_students:
            conn.close()
            return f"❌ No students found in class {target_class}."

        # ---------------------------------
        # Identify currently Sick or On Leave students
        # ---------------------------------
        active_excluded_ids = set()
        for student_id, _, _, _ in all_students:
            status = get_student_current_status(c, student_id)
            if status in ('S', 'L'):
                active_excluded_ids.add(student_id)

        # ---------------------------------
        # Mark all others as Present
        # ---------------------------------
        present_names, skipped_names, updated_names = [], [], []
        parent_notifications = []

        for student_id, roll_no, student_name, parent_phone in all_students:
            if student_id in active_excluded_ids:
                skipped_names.append(f"{student_name} ({roll_no})")
                continue

            c.execute("""
                SELECT id, status FROM period_attendance
                WHERE student_id=? AND date=? AND period=? AND class=?
            """, (student_id, today, period, target_class))
            existing = c.fetchone()

            if existing:
                rec_id, status = existing
                if status != "P":
                    c.execute("UPDATE period_attendance SET status='P', teacher_id=? WHERE id=?", (teacher_id, rec_id))
                    updated_names.append(f"{student_name} ({roll_no})")
            else:
                c.execute("""
                    INSERT INTO period_attendance (date, class, period, student_id, status, teacher_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (today, target_class, period, student_id, "P", teacher_id))
                present_names.append(f"{student_name} ({roll_no})")

            # Notify parents
            if parent_phone:
                msg = (f"📚 {student_name} (Roll {roll_no}) was marked <b>Present</b> "
                       f"for {period} today ({today}) in {target_class}.")
                parent_notifications.append({"to": parent_phone, "text": msg})

        conn.commit()

        # ---------------------------------
        # Build Response Summary
        # ---------------------------------
        lines = [f"✅ <b>ALL PRESENT</b> marked for <b>{escape_html(period)}</b> in <b>{escape_html(target_class)}</b>"]

        if skipped_names:
            lines.append(f"\n🏥 <b>Skipped (Sick/Leave)</b> ({len(skipped_names)}):")
            lines.append("\n".join([f"• _{escape_html(n)}_" for n in skipped_names]))

        total_marked_present = len(present_names) + len(updated_names)
        if total_marked_present > 0:
             lines.append(f"\n✅ <b>Marked Present</b> ({total_marked_present}):")
             all_marked = present_names + updated_names
             if len(all_marked) > 50:
                  truncated = all_marked[:50]
                  lines.append("\n".join([f"• _{escape_html(n)}_" for n in truncated]))
                  lines.append(f"• ...and {len(all_marked)-50} more")
             else:
                  lines.append("\n".join([f"• _{escape_html(n)}_" for n in all_marked]))
        else:
             lines.append("\n⚠️ No new students were marked present (everyone was already present?).")

        response = "\n".join(lines)
        
        # Add substitute notification to response
        if substitute_detected:
            response += "\n\n━━━━━━━━━━━━━━━━━━━━━"
            response += "\n🔄 <b>SUBSTITUTE CLASS</b>"
            response += "\n━━━━━━━━━━━━━━━━━━━━━"
            response += "\nThis period is not assigned to you in the timetable."
            response += "\nNotifications sent to:"
            response += "\n• Scheduled teacher"
            response += "\n• Principal"
            response += "\n• Class teacher"

        # ---------------------------------
        # Notify Class Teacher
        # ---------------------------------
        c.execute("SELECT telegram_chat_id, name FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (target_class,))
        class_teacher = c.fetchone()
        if class_teacher and class_teacher[0] and class_teacher[0] != str(chat_id):
            ct_phone, ct_name = class_teacher
            msg_ct = [
                "👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>",
                "🧾 <b>CLASS ATTENDANCE UPDATE - MARKHINS BOT</b>",
                f"Class: {escape_html(target_class)}",
                f"Period: {escape_html(period)}",
                f"Date: {escape_html(today)}",
                f"Updated by: {escape_html(teacher_name)}",
                "",
                f"✅ {len(present_names) + len(updated_names)} Students Marked Present",
                f"🏥 {len(skipped_names)} Skipped (Sick/Leave)",
                "",
                "━━━━━━━━━━━━━━━━━━━━━",
                "MARKHINS Attendance System"
            ]
            send_whatsapp_message(ct_phone, "\n".join(msg_ct))

        # ---------------------------------
        # Notify Principal
        # ---------------------------------
        c.execute("""
            SELECT telegram_chat_id FROM teachers
            WHERE UPPER(class_teacher_of)='PRINCIPAL'
               OR UPPER(name)='PRINCIPAL'
            LIMIT 1
        """)
        principal_record = c.fetchone()
        if principal_record:
            principal_phone = principal_record[0]
            msg_principal = [
                "🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>",
                "📊 <b>ALL PRESENT SUMMARY - MARKHINS BOT</b>",
                f"Class: {escape_html(target_class)}",
                f"Period: {escape_html(period)}",
                f"Date: {escape_html(today)}",
                f"Updated by: {escape_html(teacher_name)}",
                "",
                f"✅ Present: {len(present_names) + len(updated_names)}",
                f"🏥 Sick/Leave: {len(skipped_names)}",
                "",
                "━━━━━━━━━━━━━━━━━━━━━",
                "MARKHINS Attendance System"
            ]
            send_whatsapp_message(principal_phone, "\n".join(msg_principal))

        # ---------------------------------
        # Send Substitute Notifications
        # ---------------------------------
        for notification in notifications_to_send:
            send_whatsapp_message(notification.get("chat_id") or notification.get("to"), notification.get("message") or notification.get("text"))
        
        # ---------------------------------
        # Send Parent Notifications
        # ---------------------------------
        for note in parent_notifications:
            send_whatsapp_message(note.get("chat_id") or note.get("to"), note.get("message") or note.get("text"))


    # ================================
    # Sick Marking (Enhanced)
    # ================================
    elif cmd == "s":
        rolls = re.findall(r"\d+", " ".join(parts[1:]))
        sick_names = []
        notifications_to_send = []
        principal_notifications = []
        unauthorized_students = []
        principal_phone = None

        for roll in rolls:
            c.execute("SELECT id, name, class, parent_phone FROM students WHERE roll_no=?", (roll,))
            student = c.fetchone()
            if not student:
                response += f"⚠️ Student with roll {roll} not found.\n"
                continue

            student_id, student_name, student_class, parent_phone = student

            if class_teacher_of != student_class and class_teacher_of != "PRINCIPAL":
                unauthorized_students.append(f"{student_name} ({roll}) from {student_class}")
                continue

            # FETCH LATEST STATUS RECORD
            c.execute("""
                SELECT a.status, t.name, a.date
                FROM attendance a
                LEFT JOIN teachers t ON a.marked_by = t.id
                WHERE a.student_id = ?
                ORDER BY a.date DESC, a.id DESC
                LIMIT 1
            """, (student_id,))
            latest_record = c.fetchone()
            
            if latest_record:
                latest_status, latest_marked_by, latest_date = latest_record
                if not latest_marked_by: latest_marked_by = "Admin"
                try:
                    dt_obj = dt.strptime(latest_date, "%Y-%m-%d")
                    latest_date_display = dt_obj.strftime("%d.%m.%Y")
                except:
                    latest_date_display = latest_date
            else:
                latest_status, latest_marked_by, latest_date_display = "Normal", "System", "N/A"

            # Case A Validation Logic
            status_map = {'S': 'SICK', 'L': 'ON LEAVE', 'C': 'RECOVERED', 'R': 'RETURNED', 'Normal': 'NORMAL'}
            current_desc = status_map.get(latest_status, latest_status)

            if latest_status == 'S':
                response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                            f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                            f"👤 Marked by: {latest_marked_by}\n"
                            f"📅 Date: {latest_date_display}\n\n"
                            f"🛑 You cannot mark Sick while the student is already Sick.\n\n")
                continue

            if latest_status == 'L':
                response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                            f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                            f"👤 Marked by: {latest_marked_by}\n"
                            f"📅 Date: {latest_date_display}\n\n"
                            f"🛑 You cannot mark Sick while the student is On Leave.\n\n"
                            f"➡️ Please mark \"Return\" first before marking Sick.\n\n")
                continue

            # If Normal or C or R: Allow Sick insertion
            c.execute("INSERT INTO attendance (date, class, period, student_id, status, marked_by) VALUES (?, ?, ?, ?, ?, ?)",
                      (today, student_class, "-", student_id, "S", teacher_id))
            sick_names.append(f"{student_name} ({student_class})")

            # Notify parent
            if parent_phone:
                msg = (f"🩺 {escape_html(student_name)} (Roll: {escape_html(roll)}) marked Sick today ({escape_html(today)}) by {escape_html(teacher_name)}.")
                notifications_to_send.append({"to": parent_phone, "text": msg})

            # Notify class teacher if different
            c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (student_class,))
            class_teacher = c.fetchone()
            if class_teacher and class_teacher[0] and class_teacher[0] != sender:
                notifications_to_send.append({
                    "to": class_teacher[0],
                    "text": f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n🩺 {escape_html(teacher_name)} marked {escape_html(student_name)} (Roll {escape_html(roll)}) Sick in {escape_html(student_class)}."
                })

            principal_notifications.append({
                "student_name": student_name,
                "roll": roll,
                "student_class": student_class,
                "status": "Sick"
            })

        # Unauthorized feedback
        if unauthorized_students:
            if class_teacher_of:
                response += f"❌ You are class teacher of {class_teacher_of}. Cannot mark sick for: {', '.join(unauthorized_students)}\n"
            else:
                response += f"❌ You are not assigned as class teacher. Cannot mark sick for: {', '.join(unauthorized_students)}\n"

        # Notify principal (same format)
        if principal_notifications:
            c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of)='PRINCIPAL' OR UPPER(name)='PRINCIPAL'")
            principal = c.fetchone()
            if principal:
                principal_phone = principal[0]
            if principal_phone and str(principal_phone) != str(chat_id):
                msg_lines = [
                    "🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>",
                    "🩺 HEALTH UPDATE - MARKHINS BOT",
                    f"Date: {escape_html(today)}",
                    f"Submitted by: {escape_html(teacher_name)}",
                    "",
                    "STUDENTS MARKED SICK:"
                ]
                for s in principal_notifications:
                    msg_lines.append(f"• {escape_html(s['student_name'])} ({escape_html(s['roll'])}) - Class {escape_html(s['student_class'])}")
                msg_lines.append("")
                msg_lines.append(f"Total Sick: {len(principal_notifications)}")
                msg_lines.append("━━━━━━━━━━━━━━━━━━━━━")
                msg_lines.append("MARKHINS Attendance System")
                send_whatsapp_message(principal_phone, "\n".join(msg_lines))

        # Send parent/class teacher notifications
        for n in notifications_to_send:
            send_whatsapp_message(n.get("chat_id") or n.get("to"), n.get("message") or n.get("text"))

        conn.commit()
        if sick_names:
            success_msg = f"✅ <b>Health Status Updated!</b>\n\n📋 Students Marked Sick: {', '.join(sick_names)}."
            if response.strip():
                response = success_msg + "\n\n" + "<b>Notifications/Warnings:</b>\n" + response
            else:
                response = success_msg
        elif not unauthorized_students and not response.strip():
            response = "⚠️ No valid students found to mark as sick."


    # ================================
    # Cure Marking
    # ================================
    elif cmd == "c":
        rolls = re.findall(r"\d+", " ".join(parts[1:]))
        cured_names = []
        notifications_to_send = []
        principal_notifications = []
        principal_phone = None
        unauthorized_students = []

        for roll in rolls:
            c.execute("SELECT id, name, class, parent_phone FROM students WHERE roll_no=?", (roll,))
            student = c.fetchone()
            if student:
                student_id, student_name, student_class, parent_phone = student

                if class_teacher_of != student_class and class_teacher_of != "PRINCIPAL":
                    unauthorized_students.append(f"{student_name} ({roll}) from {student_class}")
                    continue

                # FETCH LATEST STATUS RECORD
                c.execute("""
                    SELECT a.status, t.name, a.date
                    FROM attendance a
                    LEFT JOIN teachers t ON a.marked_by = t.id
                    WHERE a.student_id = ?
                    ORDER BY a.date DESC, a.id DESC
                    LIMIT 1
                """, (student_id,))
                latest_record = c.fetchone()
                
                if latest_record:
                    latest_status, latest_marked_by, latest_date = latest_record
                    if not latest_marked_by: latest_marked_by = "Admin"
                    try:
                        dt_obj = dt.strptime(latest_date, "%Y-%m-%d")
                        latest_date_display = dt_obj.strftime("%d.%m.%Y")
                    except:
                        latest_date_display = latest_date
                else:
                    latest_status, latest_marked_by, latest_date_display = "Normal", "System", "N/A"

                # Case C & E Logic
                status_map = {'S': 'SICK', 'L': 'ON LEAVE', 'C': 'RECOVERED', 'R': 'RETURNED', 'Normal': 'NORMAL'}
                current_desc = status_map.get(latest_status, latest_status)

                if latest_status == 'C':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Cure while the student is already marked as Recovered.\n\n")
                    continue

                if latest_status == 'L':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Cure while the student is On Leave.\n\n"
                                f"➡️ Please mark \"Return\" first.\n\n")
                    continue

                if latest_status != 'S':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Cure. Student is not currently Sick.\n\n")
                    continue
                    
                # If latest_status == 'S', Allow insertion of 'C'.
                c.execute("INSERT INTO attendance (date, class, period, student_id, status, marked_by) VALUES (?, ?, ?, ?, ?, ?)",
                          (today, student_class, "-", student_id, "C", teacher_id))
                cured_names.append(f"{student_name} ({student_class})")

                # Notify Parent
                if parent_phone:
                    notification_msg = (f" Wonderful news! <b>{escape_html(student_name)}</b> "
                                         f"(Roll: {escape_html(roll)}) has been marked as <b>recovered</b> today ({escape_html(today)}) by {escape_html(teacher_name)}. "
                                         f"So glad they are feeling better! 😊")
                    notifications_to_send.append({"chat_id": str(parent_phone), "message": notification_msg})

                # Notify Class Teacher
                c.execute("SELECT telegram_chat_id, name FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (student_class,))
                class_teacher = c.fetchone()
                if class_teacher and class_teacher[0] and class_teacher[0] != sender:
                    ct_phone, ct_name = class_teacher
                    msg_to_ct = (f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                                 f"🧑🏻‍⚕️ {escape_html(teacher_name)} has marked <b>{escape_html(student_name)}</b> "
                                 f"(Roll: {escape_html(roll)}) as <b>cured</b> in class <b>{escape_html(student_class)}</b> today. "
                                 f"Just keeping you in the loop! 👍")
                    notifications_to_send.append({"to": ct_phone, "text": msg_to_ct})

                # For Principal
                principal_notifications.append({
                    "student_name": student_name,
                    "roll": roll,
                    "student_class": student_class,
                    "status": "cured"
                })

            else:
                response += f"⚠️ Student with roll {roll} not found. 😊\n"

        # Unauthorized feedback
        if unauthorized_students:
            if class_teacher_of:
                response += f"❌ You are class teacher of {class_teacher_of} only. You cannot mark cured for: {', '.join(unauthorized_students)}\n"
            else:
                response += f"❌ You are not assigned as a class teacher. You cannot mark cured for: {', '.join(unauthorized_students)}\n"

        # Send Principal summary
        if principal_notifications:
            if not principal_phone:
                c.execute("SELECT telegram_chat_id FROM teachers WHERE UPPER(class_teacher_of)='PRINCIPAL' OR UPPER(name)='PRINCIPAL'")
                principal_record = c.fetchone()
                if principal_record:
                    principal_phone = principal_record[0]
            if principal_phone and str(principal_phone) != str(chat_id):
                principal_msg_lines = [f"🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>"]
                principal_msg_lines.append(f"✅ RECOVERY UPDATE - MARKHINS BOT")
                principal_msg_lines.append(f"Date: {escape_html(today)}")
                principal_msg_lines.append(f"Submitted by: {escape_html(teacher_name)}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"STUDENTS RECOVERED:")
                for item in principal_notifications:
                    principal_msg_lines.append(f"• {escape_html(item['student_name'])} (Roll: {escape_html(item['roll'])}) - Class {escape_html(item['student_class'])}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"Total Students Recovered: {len(principal_notifications)}")
                principal_msg_lines.append(f"Students are now healthy and cleared to attend classes.")
                principal_msg_lines.append(f"━━━━━━━━━━━━━━━━━━━━━")
                principal_msg_lines.append(f"MARKHINS Attendance System")
                send_whatsapp_message(principal_phone, "\n".join(principal_msg_lines))

        # Send other notifications
        for notification in notifications_to_send:
            send_whatsapp_message(notification.get("chat_id") or notification.get("to"), notification.get("message") or notification.get("text"))

        # Commit the cure records to database
        conn.commit()

        if cured_names:
            success_msg = f"✅ <b>Health Status Updated!</b>\n\n📋 Students Marked Recovered: {', '.join(cured_names)}."
            if response.strip():
                response = success_msg + "\n\n" + "<b>Notifications/Warnings:</b>\n" + response
            else:
                response = success_msg
        elif not unauthorized_students and not response.strip():
            response = "⚠️ No valid students found to mark as cured."
    # ===============================
    # LEAVE MARKING
    # ===============================
    elif cmd == "l":
        rolls = re.findall(r"\d+", " ".join(parts[1:]))

        leave_names = []
        unauthorized_students = []
        notifications_to_send = []
        principal_notifications = []
        principal_phone = None

        for roll in rolls:
            c.execute("SELECT id, name, class, parent_phone FROM students WHERE roll_no=?", (roll,))
            student = c.fetchone()
            if student:
                student_id, student_name, student_class, parent_phone = student

                if class_teacher_of != student_class and class_teacher_of != "PRINCIPAL":
                    unauthorized_students.append(f"{student_name} ({roll}) from {student_class}")
                    continue

                # FETCH LATEST STATUS RECORD
                c.execute("""
                    SELECT a.status, t.name, a.date
                    FROM attendance a
                    LEFT JOIN teachers t ON a.marked_by = t.id
                    WHERE a.student_id = ?
                    ORDER BY a.date DESC, a.id DESC
                    LIMIT 1
                """, (student_id,))
                latest_record = c.fetchone()
                
                if latest_record:
                    latest_status, latest_marked_by, latest_date = latest_record
                    if not latest_marked_by: latest_marked_by = "Admin"
                    try:
                        dt_obj = dt.strptime(latest_date, "%Y-%m-%d")
                        latest_date_display = dt_obj.strftime("%d.%m.%Y")
                    except:
                        latest_date_display = latest_date
                else:
                    latest_status, latest_marked_by, latest_date_display = "Normal", "System", "N/A"

                # Case B Logic
                status_map = {'S': 'SICK', 'L': 'ON LEAVE', 'C': 'RECOVERED', 'R': 'RETURNED', 'Normal': 'NORMAL'}
                current_desc = status_map.get(latest_status, latest_status)

                if latest_status == 'L':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Leave while the student is already On Leave.\n\n")
                    continue

                if latest_status == 'S':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Leave while the student is Sick.\n\n"
                                f"➡️ Please mark \"Cure\" first before marking Leave.\n\n")
                    continue

                # If Normal or C or R: Allow Leave insertion
                c.execute("""INSERT INTO attendance (date, class, period, student_id, status, marked_by) 
                             VALUES (?, ?, ?, ?, ?, ?)""",
                          (today, student_class, "-", student_id, "L", teacher_id))
                leave_names.append(f"{student_name} ({student_class})")

                # Parent notification
                if parent_phone:
                    msg = (f"🏠 {escape_html(student_name)} (Roll {escape_html(roll)}) marked <b>On Leave</b> today ({escape_html(today)}) "
                           f"by {escape_html(teacher_name)}. Please confirm return when back to class.")
                    notifications_to_send.append({"to": parent_phone, "text": msg})

                # Notify class teacher
                c.execute("SELECT telegram_chat_id, name FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (student_class,))
                class_teacher = c.fetchone()
                if class_teacher and class_teacher[0] and class_teacher[0] != sender:
                    ct_phone, ct_name = class_teacher
                    msg_to_ct = (f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                                 f"🏠 {escape_html(teacher_name)} marked <b>{escape_html(student_name)}</b> (Roll {escape_html(roll)}) "
                                 f"as <b>On Leave</b> in your class {escape_html(student_class)}.")
                    notifications_to_send.append({"to": ct_phone, "text": msg_to_ct})

                principal_notifications.append(
                    {"student_name": student_name, "roll": roll, "student_class": student_class}
                )

            else:
                response += f"⚠️ Student with roll {roll} not found.\n"

        # Unauthorized feedback
        if unauthorized_students:
            if class_teacher_of:
                response += f"❌ You are class teacher of {class_teacher_of}. Cannot mark leave for: {', '.join(unauthorized_students)}\n"
            else:
                response += f"❌ You are not assigned as a class teacher. Cannot mark leave for: {', '.join(unauthorized_students)}\n"

        # Send Principal summary
        if principal_notifications:
            if not principal_phone:
                # Try multiple possible field names / case variants for principal
                c.execute("""
                    SELECT telegram_chat_id 
                    FROM teachers 
                    WHERE UPPER(class_teacher_of)='PRINCIPAL' 
                    OR UPPER(name)='PRINCIPAL'
                    LIMIT 1
                """)
                principal_record = c.fetchone()
                if principal_record:
                    principal_phone = principal_record[0]

            if principal_phone and str(principal_phone) != str(chat_id):
                principal_msg_lines = [f"�️ <b>PRINCIPAL LEVEL NOTIFICATION</b>"]
                principal_msg_lines.append(f"🏠 LEAVE UPDATE - MARKHINS BOT")
                principal_msg_lines.append(f"Date: {escape_html(today)}")
                principal_msg_lines.append(f"Submitted by: {escape_html(teacher_name)}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"STUDENTS MARKED ON LEAVE:")
                for item in principal_notifications:
                    principal_msg_lines.append(f"• {escape_html(item['student_name'])} (Roll: {escape_html(item['roll'])}) - Class {escape_html(item['student_class'])}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"Total Leave Students: {len(principal_notifications)}")
                principal_msg_lines.append(f"━━━━━━━━━━━━━━━━━━━━━")
                principal_msg_lines.append(f"MARKHINS Attendance System")
                send_whatsapp_message(principal_phone, "\n".join(principal_msg_lines))

        # Send other notifications
        for notification in notifications_to_send:
            send_whatsapp_message(notification.get("chat_id") or notification.get("to"), notification.get("message") or notification.get("text"))

        # Commit leave records to database
        conn.commit()

        if leave_names:
            success_msg = f"✅ <b>Health Status Updated!</b>\n\n📋 Students Marked On Leave: {', '.join(leave_names)}."
            if response.strip():
                response = success_msg + "\n\n" + "<b>Notifications/Warnings:</b>\n" + response
            else:
                response = success_msg
        elif not unauthorized_students and not response.strip():
            response = "⚠️ No valid students found to mark as on leave."

    # ===============================
    # RETURN MARKING (from Leave)
    # ===============================
    elif cmd == "r":
        rolls = re.findall(r"\d+", " ".join(parts[1:]))
        returned_names = []
        notifications_to_send = []
        principal_notifications = []
        principal_phone = None
        unauthorized_students = []
        
        for roll in rolls:
            c.execute("SELECT id, name, class, parent_phone FROM students WHERE roll_no=?", (roll,))
            student = c.fetchone()
            if student:
                student_id, student_name, student_class, parent_phone = student
                
                if class_teacher_of != student_class and class_teacher_of != "PRINCIPAL":
                    unauthorized_students.append(f"{student_name} ({roll}) from {student_class}")
                    continue

                # FETCH LATEST STATUS RECORD
                c.execute("""
                    SELECT a.status, t.name, a.date
                    FROM attendance a
                    LEFT JOIN teachers t ON a.marked_by = t.id
                    WHERE a.student_id = ?
                    ORDER BY a.date DESC, a.id DESC
                    LIMIT 1
                """, (student_id,))
                latest_record = c.fetchone()
                
                if latest_record:
                    latest_status, latest_marked_by, latest_date = latest_record
                    if not latest_marked_by: latest_marked_by = "Admin"
                    try:
                        dt_obj = dt.strptime(latest_date, "%Y-%m-%d")
                        latest_date_display = dt_obj.strftime("%d.%m.%Y")
                    except:
                        latest_date_display = latest_date
                else:
                    latest_status, latest_marked_by, latest_date_display = "Normal", "System", "N/A"

                # Case D & E Logic
                status_map = {'S': 'SICK', 'L': 'ON LEAVE', 'C': 'RECOVERED', 'R': 'RETURNED', 'Normal': 'NORMAL'}
                current_desc = status_map.get(latest_status, latest_status)

                if latest_status == 'R':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Return while the student is already marked as Returned.\n\n")
                    continue

                if latest_status == 'S':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Return while the student is Sick.\n\n"
                                f"➡️ Please mark \"Cure\" first.\n\n")
                    continue

                if latest_status != 'L':
                    response += (f"🚫❌ ACTION BLOCKED ❌🚫\n\n"
                                f"🔴 {student_name} ({roll}) is currently marked as {current_desc}\n"
                                f"👤 Marked by: {latest_marked_by}\n"
                                f"📅 Date: {latest_date_display}\n\n"
                                f"🛑 You cannot mark Return for {student_name} ({roll}). Student is not currently On Leave.\n\n")
                    continue
                    
                # If latest_status == 'L', Allow insertion of 'R'.
                c.execute("""INSERT INTO attendance (date, class, period, student_id, status, marked_by) 
                             VALUES (?, ?, ?, ?, ?, ?)""",
                          (today, student_class, "-", student_id, "R", teacher_id))
                returned_names.append(f"{student_name} ({student_class})")
                
                # Notify Parent
                if parent_phone:
                    notification_msg = (f"🎉 Great news! <b>{escape_html(student_name)}</b> "
                                        f"(Roll: {escape_html(roll)}) has been marked as <b>returned</b> today ({escape_html(today)}) by {escape_html(teacher_name)}. "
                                        f"Welcome back! 😊")
                    notifications_to_send.append({"chat_id": str(parent_phone), "message": notification_msg})

                # Notify Class Teacher
                c.execute("SELECT telegram_chat_id, name FROM teachers WHERE UPPER(class_teacher_of) = UPPER(?)", (student_class,))
                class_teacher = c.fetchone()
                if class_teacher and class_teacher[0] and class_teacher[0] != sender:
                    ct_phone, ct_name = class_teacher
                    msg_to_ct = (f"👨‍🏫 <b>CLASS TEACHER LEVEL NOTIFICATION</b>\n\n"
                                 f"🎉 {escape_html(teacher_name)} has marked <b>{escape_html(student_name)}</b> "
                                 f"(Roll: {escape_html(roll)}) as <b>returned</b> in your class "
                                 f"<b>{escape_html(student_class)}</b> today. "
                                 f"Just keeping you in the loop! 👍")
                    notifications_to_send.append({"to": ct_phone, "text": msg_to_ct})

                # For Principal
                principal_notifications.append({
                    "student_name": student_name,
                    "roll": roll,
                    "student_class": student_class,
                    "status": "returned"
                })
            else:
                response += f"⚠️ Student with roll {roll} not found.\n"

        # Unauthorized feedback
        if unauthorized_students:
            if class_teacher_of:
                response += f"❌ You are class teacher of {class_teacher_of}. Cannot mark returned for: {', '.join(unauthorized_students)}\n"
            else:
                response += f"❌ You are not assigned as a class teacher. Cannot mark returned for: {', '.join(unauthorized_students)}\n"

        # Send Principal summary
        if principal_notifications:
            if not principal_phone:
                c.execute("""
                    SELECT telegram_chat_id 
                    FROM teachers 
                    WHERE UPPER(class_teacher_of)='PRINCIPAL' 
                    OR UPPER(name)='PRINCIPAL'
                    LIMIT 1
                """)
                principal_record = c.fetchone()
                if principal_record:
                    principal_phone = principal_record[0]
            if principal_phone and str(principal_phone) != str(chat_id):
                principal_msg_lines = [f"�️ <b>PRINCIPAL LEVEL NOTIFICATION</b>"]
                principal_msg_lines.append(f"🎉 RETURN UPDATE - MARKHINS BOT")
                principal_msg_lines.append(f"Date: {escape_html(today)}")
                principal_msg_lines.append(f"Submitted by: {escape_html(teacher_name)}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"STUDENTS RETURNED:")
                for item in principal_notifications:
                    principal_msg_lines.append(f"• {escape_html(item['student_name'])} (Roll: {escape_html(item['roll'])}) - Class {escape_html(item['student_class'])}")
                principal_msg_lines.append(f"")
                principal_msg_lines.append(f"Total Students Returned: {len(principal_notifications)}")
                principal_msg_lines.append(f"Students are back and ready to learn!")
                principal_msg_lines.append(f"━━━━━━━━━━━━━━━━━━━━━")
                principal_msg_lines.append(f"MARKHINS Attendance System")
                send_whatsapp_message(principal_phone, "\n".join(principal_msg_lines))

        # Send other notifications
        for notification in notifications_to_send:
            send_whatsapp_message(notification.get("chat_id") or notification.get("to"), notification.get("message") or notification.get("text"))

        # Commit and notify
        conn.commit()

        if returned_names:
            success_msg = f"✅ <b>Health Status Updated!</b>\n\n📋 Students Marked Returned: {', '.join(returned_names)}."
            if response.strip():
                response = success_msg + "\n\n" + "<b>Notifications/Warnings:</b>\n" + response
            else:
                response = success_msg
        elif not unauthorized_students and not response.strip():
            response = "⚠️ No valid students found to mark as returned."

            # === Notify Principal ===
            c.execute("""
                SELECT telegram_chat_id 
                FROM teachers 
                WHERE UPPER(class_teacher_of)='PRINCIPAL' 
                   OR UPPER(name)='PRINCIPAL' 
                LIMIT 1
            """)
            principal_record = c.fetchone()
            if principal_record:
                principal_phone = principal_record[0]
                principal_msg = [
                    "🏫 RETURN UPDATE - MARKHINS BOT",
                    f"Date: {today}",
                    f"Submitted by: {teacher_name}",
                    "",
                    f"STUDENTS MARKED RETURNED:",
                ]
                for name in returned_names:
                    principal_msg.append(f"• {name}")
                principal_msg.append("")
                principal_msg.append(f"Total Returned: {len(returned_names)}")
                principal_msg.append("━━━━━━━━━━━━━━━━━━━━━")
                principal_msg.append("MARKHINS Attendance System")

                send_whatsapp_message(principal_phone, "\n".join(principal_msg))
        elif not response.strip():
            response = "⚠️ No valid students found to mark as returned."

    # ================================
    # Confirm Attendance (Y) - Enhanced
    # ================================
    elif cmd == "y" or cmd == "Y":
        response = "✅ Attendance confirmed."

        # Find last period marked by this teacher (any status - A or P)
        c.execute("""SELECT pa.class, pa.period
                     FROM period_attendance pa
                     WHERE pa.teacher_id=? AND pa.date=?
                     ORDER BY pa.id DESC LIMIT 1""", (teacher_id, today))
        last_marked = c.fetchone()

        if last_marked:
            summary_class, summary_period = last_marked
            summary_msg = get_period_status_summary(c, summary_class, summary_period, today, teacher_name)
            send_whatsapp_message(sender, summary_msg)
        # Else: Just confirm, no period to summarize

    # ================================
    # Cancel Last Marking (B)
    # ================================
    elif cmd == "b" or cmd == "B":
        # Delete period_attendance records for today by this teacher
        c.execute("DELETE FROM period_attendance WHERE teacher_id=? AND date=?", (teacher_id, today))
        # Delete attendance records for S/L/R/C by this teacher
        c.execute("DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE class IN (SELECT class_teacher_of FROM teachers WHERE id=?)) AND date=?",
                  (teacher_id, today))
        # Also delete any direct matches (in case teacher marked outside class_teacher_of)
        c.execute("DELETE FROM attendance WHERE teacher_id=? AND date=?", (teacher_id, today))
        conn.commit()
        response = "⏪ Last marking cancelled."

    # ===============================
    # HELPER COMMANDS FOR DYNAMIC MENUS
    # ===============================
    elif cmd == ".get_dates":
        # Get distinct dates from period_attendance in last 30 days
        c.execute("""
            SELECT DISTINCT date FROM period_attendance 
            WHERE date >= date('now', '-30 days') 
            ORDER BY date DESC
        """)
        dates = [row[0] for row in c.fetchall()]
        response = json.dumps(dates)

    elif cmd == ".get_classes":
        if len(parts) < 2:
            response = "[]"
        else:
            q_date = parts[1]
            c.execute("""
                SELECT DISTINCT class FROM period_attendance 
                WHERE date = ? 
                ORDER BY class
            """, (q_date,))
            classes = [row[0] for row in c.fetchall()]
            response = json.dumps(classes)

    elif cmd == ".get_periods":
        if len(parts) < 3:
            response = "[]"
        else:
            q_date = parts[1]
            q_class = parts[2]
            c.execute("""
                SELECT DISTINCT period FROM period_attendance 
                WHERE date = ? AND class = ?
                ORDER BY period
            """, (q_date, q_class))
            periods = [row[0] for row in c.fetchall()]
            def period_sort_key(p):
                try:
                    return int(p[1:])
                except:
                    return 99
            periods.sort(key=period_sort_key)
            response = json.dumps(periods)

    elif cmd == ".get_subjects":
        if len(parts) < 2:
            response = "[]"
        else:
            q_class = parts[1]
            try:
                # FIXED: Fetch ONLY subjects that THIS teacher teaches from the timetable
                # This removes old test subjects and subjects from other teachers
                
                # Get all subjects this teacher teaches (from timetable, across all classes)
                c.execute("""
                    SELECT DISTINCT subject 
                    FROM timetable 
                    WHERE teacher_id = ? AND subject != '' AND subject IS NOT NULL
                    ORDER BY subject
                """, (teacher_id,))
                subjects = [row[0] for row in c.fetchall()]
                
                # Return the clean list (or empty list if teacher has no subjects in timetable)
                response = json.dumps(subjects)
            except sqlite3.OperationalError:
                # If table doesn't exist yet
                response = "[]"

    # ===============================
    # .PERIOD_REPORT COMMAND
    # Usage: .period_report <DATE> <CLASS> <PERIOD>
    # ===============================
    elif cmd == ".period_report":
        if len(parts) < 4:
            response = "⚠️ Usage: .period_report <DATE> <CLASS> <PERIOD>"
        else:
            report_date = parts[1]
            report_class = parts[2]
            report_period = parts[3]
            
            # Verify date format
            try:
                dt.strptime(report_date, "%Y-%m-%d")
            except ValueError:
                conn.close()
                return "❌ Invalid date format. Use YYYY-MM-DD."

            # Find who marked it
            c.execute("""
                SELECT t.name 
                FROM period_attendance pa
                JOIN teachers t ON pa.teacher_id = t.id
                WHERE pa.date=? AND pa.class=? AND pa.period=?
                LIMIT 1
            """, (report_date, report_class, report_period))
            marker = c.fetchone()
            marker_name = marker[0] if marker else "Unknown/System"
            
            # Use the helper function
            response = get_period_status_summary(c, report_class, report_period, report_date, marker_name)
            
            if "No students found" in response:
                 response = f"⚠️ No data found for {report_class} - {report_period} on {report_date}."

    # ================================
    # Query Commands
    # ================================
    # ================================
    # Query Commands - Enhanced Period Status (Features 1 & 2)
    # ================================
    elif cmd == ".list":
        if len(parts) < 3:
            conn.close()
            return "⚠️ Format: .list p1 BS2"
        period = parts[1].upper()
        target_class = parts[2].upper()
        
        # 1. Check if record exists
        c.execute("""
            SELECT t.name
            FROM period_attendance pa
            JOIN teachers t ON pa.teacher_id = t.id
            WHERE pa.date=? AND pa.class=? AND pa.period=?
            LIMIT 1
        """, (today, target_class, period))
        att_record = c.fetchone()
        
        if att_record:
            marker_name = att_record[0]
            
            # Fetch stored statuses from period_attendance
            c.execute("""
                SELECT s.name, s.roll_no, pa.status
                FROM period_attendance pa
                JOIN students s ON pa.student_id = s.id
                WHERE pa.date=? AND pa.class=? AND pa.period=? AND pa.status != 'P'
                ORDER BY s.roll_no
            """, (today, target_class, period))
            non_present = c.fetchall()
            
            absent_list = [f"{escape_html(r[0])} ({r[1]})" for r in non_present if r[2] == 'A']
            sick_list = [f"{escape_html(r[0])} ({r[1]})" for r in non_present if r[2] == 'S']
            leave_list = [f"{escape_html(r[0])} ({r[1]})" for r in non_present if r[2] == 'L']

            # Build Formatted Response (Read-only Report)
            res = [f"📘 <b>Class {escape_html(target_class)} — Period {escape_html(period)}</b>\n"]
            res.append("Status: Attendance Recorded")
            res.append(f"Marked by: {escape_html(marker_name)}\n")
            
            res.append(f"❌ <b>Absent</b> ({len(absent_list)})")
            res.append("\n".join([f"• {n}" for n in absent_list]) if absent_list else "None")
            res.append("")
            
            res.append(f"💊 <b>Sick</b>")
            res.append("\n".join([f"• {n}" for n in sick_list]) if sick_list else "None")
            res.append("")
            
            res.append(f"🏠 <b>Leave</b>")
            res.append("\n".join([f"• {n}" for n in leave_list]) if leave_list else "None")
            
            response = "\n".join(res)
        else:
            # Check timetable for "Free Class"
            current_date_obj = dt.strptime(today, "%Y-%m-%d")
            weekday = current_date_obj.weekday()
            c.execute("SELECT 1 FROM timetable WHERE class=? AND weekday=? AND period_label=? LIMIT 1", (target_class, weekday, period))
            if c.fetchone():
                response = f"📘 <b>{target_class} — Period {period}</b>\n\nStatus: ⚪ Not Marked Yet"
            else:
                response = f"📘 <b>{target_class} — Period {period}</b>\n\nStatus: 🆓 Free Period"

    # ===============================
    # .DAILY_AGGREGATE (Feature 4)
    # ===============================
    elif cmd == ".daily_aggregate":
        response = generate_daily_aggregate_report(c, today)

    # ===============================
    # .TODAY REPORT
    # ===============================
    # ===============================
    # .DAILY STATUS REPORT (Replaces .today)
    # Usage: .daily_status <CLASS>
    # ===============================
    elif cmd == ".daily_status":
        if len(parts) < 2:
            response = "⚠️ Usage: .daily_status <CLASS>"
        else:
            target_class = parts[1].upper()
            
            # 1. Get Timetable for Today
            # We need to know what was SCHEDULED
            current_date_obj = dt.strptime(today, "%Y-%m-%d")
            weekday = current_date_obj.weekday()
            
            c.execute("""
                SELECT period_label, tt.subject, t.name, t.id 
                FROM timetable tt 
                JOIN teachers t ON tt.teacher_id = t.id 
                WHERE tt.class = ? AND tt.weekday = ?
            """, (target_class, weekday))
            
            tt_rows = c.fetchall()
            # Map: P1 -> {subject: 'Math', teacher: 'Mr. X', tid: 1}
            tt_map = {}
            for row in tt_rows:
                tt_map[row[0]] = {'subject': row[1], 'teacher': row[2], 'tid': row[3]}
                
            # 2. Get Actual Attendance Status
            # We check if ANY attendance was marked for this class/period/date
            # We group by period to get the teacher who marked it
            c.execute("""
                SELECT period, teacher_id 
                FROM period_attendance 
                WHERE class = ? AND date = ? 
                GROUP BY period
            """, (target_class, today))
            
            att_rows = c.fetchall()

            att_map = {}
            for period, tid in att_rows:
                # Fetch teacher name who actually took the class
                c.execute("SELECT name FROM teachers WHERE id=?", (tid,))
                t_row = c.fetchone()
                taken_by_name = t_row[0] if t_row else "Unknown"
                att_map[period] = {'tid': tid, 'name': taken_by_name}
            
            # 3. Build Report
            lines = [f"📅 <b>Daily Class Status: {escape_html(target_class)}</b>", f"Date: {escape_html(today)}\n"]
            
            # Standard periods P1 to P8
            # You can adjust this list based on your school's standard periods
            all_periods = [f"P{i}" for i in range(1, 9)] 
            
            has_data = False
            
            for p in all_periods:
                tt_info = tt_map.get(p)
                att_info = att_map.get(p)
                
                # Logic:
                # 1. If NO Timetable AND NO Attendance -> Free Period (or skip if we want compact)
                #    But requirement says "Free Period".
                
                if not tt_info and not att_info:
                    # Only show Free Period if it's 'sandwiched' or we want to show full P1-P8?
                    # The user said "Period 1 -> Period N... Free Period".
                    # Let's show it to be explicit.
                    lines.append(f"<b>{p}:</b> 🆓 Free Period")
                    lines.append("") # Spacer
                    continue
                
                has_data = True
                
                # Subject and Assigned Teacher (from Timetable)
                if tt_info:
                    subject = tt_info['subject']
                    assigned = tt_info['teacher']
                    assigned_tid = str(tt_info['tid'])
                    
                    if att_info:
                        # ✅ Class Taken
                        actual_name = att_info['name']
                        actual_tid = str(att_info['tid'])
                        
                        status_line = "✅ <b>Class Taken</b>"
                        details_line = f"📘 {escape_html(subject)} | 👨‍🏫 {escape_html(assigned)}"
                        
                        # Check Substitute
                        if actual_tid != assigned_tid:
                            details_line += f"\n🔄 <i>Substituted by {escape_html(actual_name)}</i>"
                        
                        lines.append(f"<b>{p}:</b> {status_line}")
                        lines.append(details_line)
                        
                    else:
                        # ❌ Class Not Taken
                        lines.append(f"<b>{p}:</b> ❌ <b>Class Not Taken</b>")
                        lines.append(f"📘 {escape_html(subject)} | 👨‍🏫 {escape_html(assigned)}")
                
                else:
                    # No Timetable but Attendance Exists -> Extra Class?
                    # Status: Taken
                    if att_info:
                         actual_name = att_info['name']
                         lines.append(f"<b>{p}:</b> ✅ <b>Extra Class Taken</b>")
                         lines.append(f"📘 Extra | 👨‍🏫 {escape_html(actual_name)}")

                lines.append("") # Spacer

            # Footer
            lines.append("────────────────")
            lines.append("✅ = Marked | ❌ = Not Marked")
            
            response = "\n".join(lines)

    # ===============================
    # .GET ALL STUDENTS (for Node.js class loading)
    # ===============================
    elif cmd == ".get_all_students":
        c.execute("""
            SELECT roll_no, name, class 
            FROM students 
            ORDER BY class, roll_no
        """)
        students = c.fetchall()
        
        student_list = []
        for row in students:
            student_list.append({
                'roll_no': row[0],
                'name': row[1], 
                'class': row[2]
            })
        
        # Return proper JSON format for Node.js
        response = json.dumps({
            'reply': json.dumps(student_list),
            'notifications': []
        })

    # ===============================
    # .GET STUDENTS FOR MARKING (includes S/L status)
    # ===============================
    elif cmd == ".get_students_for_marking":
        if len(parts) < 3:
            response = json.dumps({'reply': '[]', 'notifications': []})
        else:
            target_class = parts[1].upper()
            target_period = parts[2].upper()
            
            c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (target_class,))
            all_students = c.fetchall()
            
            student_list_with_status = []
            for student_id, roll_no, name in all_students:
                status = 'P' # Default
                
                # Check for active Sick/Leave status
                status = get_student_current_status(c, student_id) or 'P'
                
                student_list_with_status.append({
                    'roll': str(roll_no),
                    'name': name,
                    'status': status
                })
                
            response = json.dumps({
                'reply': json.dumps(student_list_with_status),
                'notifications': []
            })

    # ===============================
    # .GET ALL TEACHERS (for Node.js auth check)
    # ===============================
    elif cmd == ".get_all_teachers":
        c.execute("SELECT telegram_username, telegram_chat_id FROM teachers")
        teachers = []
        for row in c.fetchall():
            if row[0]: teachers.append(row[0].lower())
            if row[1]: teachers.append(str(row[1]))
        response = json.dumps({
            'reply': json.dumps(teachers),
            'notifications': []
        })

    # ===============================
    # .STUDENT REPORT
    # ===============================
    elif cmd == ".student":
        if len(parts) < 2:
            response = "⚠️ Usage: .student <ROLL_NO>\nExample: .student 1201"
        else:
            roll = parts[1]
            response = get_student_history(c, roll)

    # ===============================
    # .CLASS REPORT
    # ===============================
    elif cmd == ".class":
        if len(parts) < 2:
            response = "⚠️ Usage: .class <CLASS_NAME>\nExample: .class 10A"
        else:
            class_name = parts[1].upper()
            # Get all students in class ordered by roll
            c.execute(
                """
                SELECT id, name, roll_no
                FROM students
                WHERE class = ?
                ORDER BY roll_no
                """,
                (class_name,)
            )
            students_rows = c.fetchall()

            if not students_rows:
                response = f"⚠️ No records found for class {escape_html(class_name)}."
            else:
                lines = [f"🏫 <b>CLASS REPORT - {escape_html(class_name)}</b>"]
                for sid, name, roll in students_rows:
                    status_symbol = get_student_current_status(c, sid) or '-'

                    lines.append(f"• {escape_html(roll)} {escape_html(name)} — {escape_html(status_symbol)}")
                response = "\n".join(lines)

    # ===============================
    # .CLASS_DETAILS REPORT (NEW)
    # ===============================
    elif cmd == ".class_details":
        if len(parts) < 2:
            response = "⚠️ Usage: .class_details <CLASS_NAME>"
        else:
            class_name = parts[1].upper()
            c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_name,))
            students = c.fetchall()
            
            if not students:
                response = f"⚠️ No students found for class {escape_html(class_name)}."
            else:
                lines = [
                    f"📘 <b>تفاصيل الصف — {escape_html(class_name)}</b>", 
                    f"عدد الطلاب: {len(students)}", 
                    ""
                ]
                
                for sid, roll, name in students:
                    # Use standard system logic to get active S/L emoji
                    emoji = get_active_sl_emoji(c, sid, today)
                    lines.append(f"{escape_html(str(roll))}  {escape_html(name)}{emoji}")
                
                lines.append("")
                lines.append("──────────────")
                lines.append("💊 مريض")
                lines.append("🛖 إجازة")
                
                response = "\n".join(lines)

    # ===============================
    # .BATCH_REPORT (NEW)
    # ===============================
    elif cmd == ".batch_report":
        if len(parts) < 2:
            response = "⚠️ Usage: .batch_report <CLASS_NAME>"
        else:
            class_name = parts[1].upper()
            c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_name,))
            students = c.fetchall()
            
            if not students:
                response = f"⚠️ No students found for class {escape_html(class_name)}."
            else:
                lines = [f"<b>━━━━━━━━━━ {escape_html(class_name)} ━━━━━━━━━━</b>", ""]
                for i, (sid, roll, name) in enumerate(students, 1):
                    # Reuse the same logic as Student-wise report
                    total, attended, percent, _ = get_student_stats(c, sid, name, class_name, roll)
                    
                    lines.append(f"{i}️⃣ 🍥 <b>STUDENT REPORT</b>")
                    lines.append(f"Name: {escape_html(name)}")
                    lines.append(f"Class: {escape_html(class_name)}")
                    lines.append(f"Roll No: {escape_html(str(roll))}")
                    lines.append(f"Total Classes (Inc. Extra): {total}")
                    lines.append(f"Attended: {attended}")
                    lines.append(f"Not Attended: {total - attended}")
                    lines.append(f"Attendance 📊: {percent}%")
                    lines.append("") # Blank line between students
                
                response = "\n".join(lines)

    # ===============================
    # EXTRA CLASS REPORTS (NEW)
    # ===============================
    elif cmd == ".get_extra_dates":
        c.execute("SELECT DISTINCT date FROM extra_classes ORDER BY date DESC LIMIT 30")
        dates = [row[0] for row in c.fetchall()]
        response = json.dumps(dates)

    elif cmd == ".get_extra_list":
        if len(parts) < 2:
            response = "[]"
        else:
            date_arg = parts[1]
            c.execute("""
                SELECT id, class, teacher, subject, period, time 
                FROM extra_classes 
                WHERE date=? 
                ORDER BY time DESC, id DESC
            """, (date_arg,))
            rows = c.fetchall()
            result = []
            for r in rows:
                result.append({
                    "id": r[0],
                    "class": r[1],
                    "teacher": r[2],
                    "subject": r[3],
                    "period": r[4] or "Extra",
                    "time": r[5]
                })
            response = json.dumps(result)

    elif cmd == ".report_extra":
        if len(parts) < 2:
            response = "❌ Usage error."
        else:
            try:
                ec_id = int(parts[1])
                c.execute("SELECT date, class, subject, teacher, time, absent_rolls, period FROM extra_classes WHERE id=?", (ec_id,))
                record = c.fetchone()
                
                if not record:
                    response = "❌ Extra class record not found."
                else:
                    ec_date, ec_class, ec_subj, ec_teacher, ec_time, ec_absent_str, ec_period = record
                    
                    # Fetch all students in class
                    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (ec_class,))
                    all_students = c.fetchall()
                    total_count = len(all_students)
                    
                    # Parse Absentees
                    absent_rolls_set = set()
                    if ec_absent_str:
                        # Handle potential whitespace/empty strings
                        raw_rolls = [r.strip() for r in ec_absent_str.split(',') if r.strip()]
                        absent_rolls_set = set(raw_rolls)
                        
                    # Calculate Active Sick / Leave
                    active_sick = []
                    active_leave = []
                    absent_list = []
                    present_count = 0
                    
                    for sid, roll, name in all_students:
                        str_roll = str(roll)
                        
                        # Check S/L status logic
                        sl_type = get_student_current_status(c, sid)
                        is_active_sl = sl_type is not None
                        
                        # Classify
                        if is_active_sl:
                            if sl_type == 'S':
                                active_sick.append(f"{name} ({roll})")
                            elif sl_type == 'L':
                                active_leave.append(f"{name} ({roll})")
                        elif str_roll in absent_rolls_set:
                            absent_list.append(f"{name} ({roll})")
                        else:
                            present_count += 1
                            
                    # Construct Report
                    lines = [
                        f"📘 <b>EXTRA CLASS REPORT</b>",
                        f"📅 Date: {escape_html(ec_date)}",
                        f"🏫 Class: {escape_html(ec_class)}",
                        f"⏰ Period: {escape_html(ec_period or 'Extra')}",
                        f"👨‍🏫 Teacher: {escape_html(ec_teacher)}",
                        f"📘 Subject: {escape_html(ec_subj)}",
                        "",
                        f"👥 Total Students: {total_count}",
                        f"✅ Present: {present_count}",
                        ""
                    ]
                    
                    if absent_list:
                        lines.append(f"❌ <b>Absent ({len(absent_list)}):</b>")
                        for s in absent_list: lines.append(f"• {escape_html(s)}")
                        lines.append("")
                        
                    if active_sick:
                        lines.append(f"🩺 <b>Sick ({len(active_sick)}):</b>")
                        for s in active_sick: lines.append(f"• {escape_html(s)}")
                        lines.append("")
                        
                    if active_leave:
                        lines.append(f"🏠 <b>On Leave ({len(active_leave)}):</b>")
                        for s in active_leave: lines.append(f"• {escape_html(s)}")
                    
                    response = "\n".join(lines)
            except Exception as e:
                response = f"❌ Error generating report: {str(e)}"

    # ===============================
    # .WEEK REPORT
    # ===============================
    elif cmd == ".week":
        today_date = datetime.datetime.strptime(today, "%Y-%m-%d")
        week_start = (today_date - datetime.timedelta(days=6)).strftime("%Y-%m-%d")

        # 1. Normal Attendance
        c.execute("""
            SELECT s.name, s.roll_no, s.class, a.date, a.status, a.period
            FROM attendance a 
            JOIN students s ON a.student_id = s.id
            WHERE a.date BETWEEN ? AND ?
            ORDER BY a.date ASC, s.class, s.roll_no
        """, (week_start, today))
        data = c.fetchall()

        # 2. Extra Classes
        c.execute("""
            SELECT class, subject, teacher, absent_rolls, period, date
            FROM extra_classes
            WHERE date BETWEEN ? AND ?
            ORDER BY date ASC
        """, (week_start, today))
        extra_data = c.fetchall()

        if not data and not extra_data:
            response = f"📆 No attendance data in the last 7 days ({week_start} to {today})."
        else:
            lines = [f"📆 <b>WEEKLY ATTENDANCE ({week_start} ➜ {today})</b>"]
            
            # Group by date
            records_by_date = {}
            
            for name, roll, cls, date, status, period in data:
                records_by_date.setdefault(date, {"normal": [], "extra": []})
                records_by_date[date]["normal"].append(f"• {escape_html(roll)} {escape_html(name)} ({escape_html(cls)}) - {escape_html(status)} ({escape_html(period)})")
            
            for cls, sub, teacher, absent_rolls, period, date in extra_data:
                records_by_date.setdefault(date, {"normal": [], "extra": []})
                # Add extra class info
                records_by_date[date]["extra"].append(f"📘 EXTRA: {escape_html(cls)} — {escape_html(sub)} — {escape_html(teacher)} ({escape_html(period)})")
                # If there were absentees, they are already captured in normal report if they were marked in `attendance` table?
                # No, extra class absentees are ONLY in `extra_classes` table.
                if absent_rolls:
                    rolls = [r.strip() for r in absent_rolls.split(',') if r.strip()]
                    for r in rolls:
                        c.execute("SELECT name FROM students WHERE roll_no = ? AND class = ?", (r, cls))
                        st_name_row = c.fetchone()
                        st_name = st_name_row[0] if st_name_row else "Unknown"
                        records_by_date[date]["normal"].append(f"• {escape_html(r)} {escape_html(st_name)} ({escape_html(cls)}) - ABSENT ({escape_html(period)} Extra)")

            for date in sorted(records_by_date.keys()):
                lines.append(f"\n📅 {escape_html(date)}:")
                if records_by_date[date]["extra"]:
                    lines.extend(records_by_date[date]["extra"])
                if records_by_date[date]["normal"]:
                    # De-duplicate
                    unique_normal = sorted(list(set(records_by_date[date]["normal"])))
                    lines.extend(unique_normal)
                else:
                    lines.append("• No student attendance records.")

            response = "\n".join(lines)

    # ===============================
    # .SICK REPORT (only active, not cured yet)
    # ===============================
    elif cmd == ".sick":
        # Find latest Sick record per student
        c.execute(
            """
            SELECT s.id, s.name, s.roll_no, s.class, a.id as sick_id, a.date as sick_date, a.created_at
            FROM students s
            JOIN attendance a ON a.student_id = s.id AND a.status = 'S'
            WHERE a.id = (
                SELECT id FROM attendance
                WHERE student_id = s.id AND status = 'S'
                ORDER BY date DESC, id DESC LIMIT 1
            )
            ORDER BY s.class, s.roll_no
            """
        )
        latest_sick_rows = c.fetchall()

        active_sick = []
        for sid, name, roll, cls, sick_id, sick_date, created_at in latest_sick_rows:
            # Check if a Cure exists after this Sick
            c.execute(
                """
                SELECT 1 FROM attendance
                WHERE student_id=? AND status='C'
                  AND (date > ? OR (date = ? AND id > ?))
                LIMIT 1
                """,
                (sid, sick_date, sick_date, sick_id),
            )
            cured_after = c.fetchone()
            if not cured_after:
                # Format 12h time if available
                time_str = ""
                if created_at:
                    try:
                        time_str = dt.strptime(created_at, "%Y-%m-%d %H:%M:%S").strftime(" %I:%M %p")
                    except Exception:
                        time_str = ""
                active_sick.append((name, roll, cls, sick_date, time_str, created_at))

        if not active_sick:
            response = "✅ <b>No students are currently marked as sick.</b>"
        else:
            # Emoji number helper
            def get_emoji_num(n):
                num_map = {'0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'}
                return "".join(num_map.get(d, d) for d in str(n))

            current_time = ist_now.strftime("%I:%M %p")
            lines = [
                "🩺 <b>Sick Students Report</b>",
                "━━━━━━━━━━━━━━━━━━",
                f"📅 Date       : {today_display}",
                f"👥 Total Sick : {len(active_sick)} Students",
                "━━━━━━━━━━━━━━━━━━",
                ""
            ]
            
            for i, (name, roll, cls, date, time_str, created_raw) in enumerate(active_sick, 1):
                # Calculate duration
                try:
                    start_date = dt.strptime(date, "%Y-%m-%d").date()
                    current_date = ist_now.date()
                    duration_days = (current_date - start_date).days
                except:
                    duration_days = 0
                
                # Format "Since" date (Short: DD Mon, HH:MM AM/PM)
                since_fmt = f"{date}{time_str}" # Fallback
                if created_raw:
                    try:
                        since_dt = dt.strptime(created_raw, "%Y-%m-%d %H:%M:%S")
                        since_fmt = since_dt.strftime("%d %b, %I:%M %p")
                    except:
                        pass

                lines.append(f"{get_emoji_num(i)} <b>{escape_html(name)}</b>")
                lines.append(f"   🎓 ID       : {escape_html(roll)}")
                lines.append(f"   🏫 Class    : {escape_html(cls)}")
                lines.append(f"   🕒 Since    : {escape_html(since_fmt)}")
                lines.append(f"   ⏳ Duration : {duration_days} day(s)")
                lines.append("")
                
            lines.append("━━━━━━━━━━━━━━━━━━")
            lines.append(f"🔄 Last Updated: {current_time}")
            response = "\n".join(lines)

    # ===============================
    # .LEAVE REPORT (only active, not returned yet)
    # ===============================
    elif cmd == ".leave":
        # Find latest Leave record per student
        c.execute(
            """
            SELECT s.id, s.name, s.roll_no, s.class, a.id as leave_id, a.date as leave_date, a.created_at
            FROM students s
            JOIN attendance a ON a.student_id = s.id AND a.status = 'L'
            WHERE a.id = (
                SELECT id FROM attendance
                WHERE student_id = s.id AND status = 'L'
                ORDER BY date DESC, id DESC LIMIT 1
            )
            ORDER BY s.class, s.roll_no
            """
        )
        latest_leave_rows = c.fetchall()

        active_leave = []
        for sid, name, roll, cls, leave_id, leave_date, created_at in latest_leave_rows:
            # Check if a Return exists after this Leave
            c.execute(
                """
                SELECT 1 FROM attendance
                WHERE student_id=? AND status='R'
                  AND (date > ? OR (date = ? AND id > ?))
                LIMIT 1
                """,
                (sid, leave_date, leave_date, leave_id),
            )
            returned_after = c.fetchone()
            if not returned_after:
                time_str = ""
                if created_at:
                    try:
                        time_str = dt.strptime(created_at, "%Y-%m-%d %H:%M:%S").strftime(" %I:%M %p")
                    except Exception:
                        time_str = ""
                active_leave.append((name, roll, cls, leave_date, time_str, created_at))

        if not active_leave:
            response = "✅ <b>No students are currently on leave.</b>"
        else:
            # Emoji number helper (locally defined if not already)
            def get_emoji_num(n):
                num_map = {'0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'}
                return "".join(num_map.get(d, d) for d in str(n))

            current_time = ist_now.strftime("%I:%M %p")
            lines = [
                "📄 <b>Students on Leave</b>",
                "━━━━━━━━━━━━━━━━━━",
                f"📅 Date        : {today_display}",
                f"👥 Total Leave : {len(active_leave)} Students",
                "━━━━━━━━━━━━━━━━━━",
                ""
            ]
            
            for i, (name, roll, cls, date, time_str, created_raw) in enumerate(active_leave, 1):
                # Format To date (always Ongoing for now as End Date isn't tracked in schema)
                # Format From date
                from_date = date
                try:
                    from_dt = dt.strptime(date, "%Y-%m-%d")
                    from_date = from_dt.strftime("%d %b %Y")
                except:
                    pass

                lines.append(f"{get_emoji_num(i)} <b>{escape_html(name)}</b>")
                lines.append(f"   🎓 ID       : {escape_html(roll)}")
                lines.append(f"   🏫 Class    : {escape_html(cls)}")
                lines.append(f"   🗂️ Type     : Official Leave")
                lines.append(f"   📆 From     : {escape_html(from_date)}")
                lines.append(f"   📆 To       : Ongoing")
                lines.append("")

            lines.append("━━━━━━━━━━━━━━━━━━")
            lines.append(f"🔄 Last Updated: {current_time}")
            response = "\n".join(lines)

    # ===============================
    # .TEACHER REPORT
    # ===============================
    elif cmd == ".teacher":
        c.execute("""
            SELECT name, class_teacher_of, telegram_username, phone 
            FROM teachers 
            ORDER BY name
        """)
        teachers = c.fetchall()

        if not teachers:
            response = "⚠️ No teacher records found."
        else:
            lines = ["👩‍🏫 <b>TEACHERS LIST</b>", "", "━━━━━━━━━━━━━━━━━━", ""]
            for name, cls, tg_username, phone in teachers:
                cls_text = cls if cls else "Not Assigned"
                username_text = f"@{tg_username}" if tg_username else "Not Set"
                phone_text = phone if phone else "Not Set"
                
                lines.append(f"🧑‍🏫 <b>{escape_html(name)}</b>")
                lines.append(f"🏫 Class: {escape_html(cls_text)}")
                lines.append(f"👤 Username: {escape_html(username_text)}")
                lines.append(f"📞 Phone: {escape_html(phone_text)}")
                lines.append("")
            
            lines.append("━━━━━━━━━━━━━━━━━━")
            response = "\n".join(lines)


    # --- NEW COMMAND: .me ---
    elif cmd == ".me":
        try:
            # The teacher is already looked up at the start of handle_message
            # We can use the teacher_id, teacher_name, class_teacher_of variables
            c.execute("SELECT name, phone, class_teacher_of, telegram_username FROM teachers WHERE id=?", (teacher_id,))
            teacher_data = c.fetchone()
            if not teacher_data:
                response = f"❌ Teacher data not found."
            else:
                name, phone, class_teacher_of_val, tg_username = teacher_data
                class_info = class_teacher_of_val if class_teacher_of_val else "None"
                username_info = f"@{tg_username}" if tg_username else "Not Set"
                # Use a multi-line f-string for clarity
                response = (f"👤 Your Details\n"
                            f"-------------------------\n"
                            f"Name: {escape_html(name)}\n"
                            f"Phone: {escape_html(phone)}\n"
                            f"Telegram Username: {escape_html(username_info)}\n"
                            f"Class Incharge: {escape_html(class_info)}\n"
                            f" ------ MARKHINS BOT® ------ ")
        except sqlite3.Error as e:
            response = f"❌ Error fetching your details: {e}"

    # ===============================
    # .TIMETABLE COMMAND
    # ===============================
    elif cmd == ".timetable":
        subcmd = parts[1].lower() if len(parts) > 1 else "my"
        
        # Get current weekday (0=Monday, 6=Sunday)
        weekday = get_ist_now().weekday()
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        today_name = days[weekday]
        
        if subcmd == "my":
            # 1️⃣ My Classes Today
            c.execute("""
                SELECT period_label, class, subject 
                FROM timetable 
                WHERE teacher_id = ? AND weekday = ?
                ORDER BY period_label
            """, (teacher_id, weekday))
            rows = c.fetchall()
            
            if not rows:
                response = f"📘 <b>YOUR CLASSES TODAY ({escape_html(today_name)})</b>\n\nNo classes scheduled for today."
            else:
                lines = [f"📘 <b>YOUR CLASSES TODAY ({escape_html(today_name)})</b>", ""]
                for period, cls, subject in rows:
                    lines.append(f"⏰ Period {escape_html(period)} — {escape_html(cls)} — {escape_html(subject)}")
                response = "\n".join(lines)
                
        elif subcmd == "all":
            # 2️⃣ All Classes Today
            c.execute("""
                SELECT t.class, t.period_label, t.subject, tch.name
                FROM timetable t
                LEFT JOIN teachers tch ON t.teacher_id = tch.id
                WHERE t.weekday = ?
                ORDER BY t.class, t.period_label
            """, (weekday,))
            rows = c.fetchall()
            
            if not rows:
                response = f"🏫 TODAY’S FULL TIMETABLE ({today_name})\n\nNo classes scheduled for today."
            else:
                # Group by class
                class_schedule = {}
                for cls, period, subject, teacher_name in rows:
                    if cls not in class_schedule:
                        class_schedule[cls] = []
                    
                    # Store full name and subject (removing initials logic)
                    name = teacher_name if teacher_name else "Unknown"
                    subj = subject if subject else "General"
                    class_schedule[cls].append((period, name, subj))
                
                lines = [f"📘 TODAY’S FULL TIMETABLE ({escape_html(today_name)})", ""]
                lines.append("=============")
                lines.append("")
                
                # Emoji number mapping for periods
                emoji_nums = {
                    "P1": "1️⃣", "P2": "2️⃣", "P3": "3️⃣", "P4": "4️⃣", 
                    "P5": "5️⃣", "P6": "6️⃣", "P7": "7️⃣", "P8": "8️⃣", "P9": "9️⃣"
                }

                for cls in sorted(class_schedule.keys()):
                    lines.append(f"<b>━━━━ 🏫 {escape_html(cls)} ━━━━</b>")
                    for period, teacher, subj in class_schedule[cls]:
                        p_emoji = emoji_nums.get(period.upper(), period)
                        lines.append(f"{p_emoji} {escape_html(teacher)} — {escape_html(subj)}")
                    lines.append("")
                    lines.append("=============")
                    lines.append("")
                
                response = "\n".join(lines)

    # ================================
    # VIEW ATTENDANCE COMMAND
    # Usage:
    #   .view DD.MM.YYYY <class>
    #   .view DD.MM.YYYY <period> <class>
    # ================================
    elif cmd == ".view":
        if len(parts) < 3:
            conn.close()
            return (
                "⚠️ Usage:\n"
                ".view DD.MM.YYYY <class>\n"
                ".view DD.MM.YYYY <period> <class>\n"
                "Example: .view 12.09.2025 BS3 or .view 12.09.2025 P1 BS3"
            )

        date_str = parts[1].replace(",", ".").replace("-", ".")
        try:


            # later in code:
            view_date = dt.strptime(date_str, "%d.%m.%Y").strftime("%d,%m,%y")

        except ValueError:
            conn.close()
            return "❌ Invalid date format. Use DD.MM.YYYY (e.g., 12.09.2025)"

        if len(parts) >= 4 and parts[2].lower().startswith("p"):
            period = parts[2].upper()
            class_ = parts[3].upper()
        else:
            period = None
            class_ = parts[2].upper()

        # ---------------------------------
        # Fetch records from period_attendance
        # ---------------------------------
        c.execute("""
            SELECT s.roll_no, s.name, pa.period, pa.status
            FROM period_attendance pa
            JOIN students s ON pa.student_id = s.id
            WHERE pa.date = ? AND pa.class = ?
            {}
            ORDER BY s.roll_no
        """.format("AND pa.period = ?" if period else ""), (view_date, class_, period) if period else (view_date, class_))

        records = [list(r) for r in c.fetchall()]

        # ---------------------------------
        # Fetch records from extra_classes
        # ---------------------------------
        # extra_classes date is YYYY-MM-DD
        extra_date_query = dt.strptime(date_str, "%d.%m.%Y").strftime("%Y-%m-%d")
        
        if period:
            # If a specific period was requested, check if it matches an extra class period (e.g. 'Extra' or 'P1')
            c.execute("SELECT absent_rolls, subject, teacher FROM extra_classes WHERE date=? AND class=? AND period=?", (extra_date_query, class_, period))
        else:
            c.execute("SELECT absent_rolls, subject, teacher, period FROM extra_classes WHERE date=? AND class=?", (extra_date_query, class_))
        
        extra_rows = c.fetchall()
        for row in extra_rows:
            absent_rolls = row[0]
            sub = row[1]
            teacher = row[2]
            p_label = row[3] if len(row) > 3 else period
            
            # For each student in the class, determine their status for this extra class
            # Since we only store absentees in extra_classes, everyone else is present
            c.execute("SELECT roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_,))
            all_students = c.fetchall()
            
            absent_list = [r.strip() for r in absent_rolls.split(',') if r.strip()] if absent_rolls else []
            
            for roll, name in all_students:
                status = "A" if str(roll) in absent_list else "P"
                records.append([roll, name, f"{p_label} (Extra)", status])

        if not records:
            conn.close()
            return f"⚠️ No attendance records found for {class_} on {date_str}."

        # ---------------------------------
        # Generate formatted response
        # ---------------------------------
        lines = [
            f"📘 <b>ATTENDANCE VIEW</b>",
            f"Date: {escape_html(date_str)}",
            f"Class: {escape_html(class_)}",
        ]
        if period:
            lines.append(f"Period: {escape_html(period)}")
        lines.append("━━━━━━━━━━━━━━━━━━━━━")

        # Use status from records. records is list of [roll, name, period, status]
        present = [r for r in records if r[3] == "P"]
        absent = [r for r in records if r[3] == "A"]
        sick = [r for r in records if r[3] == "S"]
        leave = [r for r in records if r[3] == "L"]

        lines.append(f"✅ Present: {len(present)}")
        lines.append(f"❌ Absent: {len(absent)}")
        if sick: lines.append(f"💊 Sick: {len(sick)}")
        if leave: lines.append(f"🏝️ Leave: {len(leave)}")
        lines.append("━━━━━━━━━━━━━━━━━━━━━")
        lines.append("🧾 Student-wise List:")

        # Sort by roll and then period to keep it organized
        for roll, name, p, status in sorted(records, key=lambda x: (x[0], x[2] or "")):
            p_str = f"({escape_html(p)})" if p else ""
            lines.append(f"{escape_html(roll)}. {escape_html(name)} {p_str} → {escape_html(status)}")

        response = "\n".join(lines)

        # ---------------------------------
        # Optional Notifications
        # ---------------------------------
        # Notify Principal that attendance was viewed
        c.execute("""
            SELECT telegram_chat_id FROM teachers
            WHERE UPPER(class_teacher_of)='PRINCIPAL'
               OR UPPER(name)='PRINCIPAL'
            LIMIT 1
        """)
        principal = c.fetchone()
        if principal:
            principal_phone = principal[0]
            msg = (
                f"🏛️ <b>PRINCIPAL LEVEL NOTIFICATION</b>\n"
                f"👀 <b>Attendance Viewed</b>\n"
                f"Class: {escape_html(class_)}\n"
                f"Date: {escape_html(date_str)}\n"
                f"{'Period: ' + escape_html(period) if period else ''}\n"
                f"By: {escape_html(teacher_name)}"
            )
            send_whatsapp_message(principal_phone, msg)

        conn.close()
        return response

    # ================================
    # ADMIN COMMANDS
    # ================================
    elif cmd.startswith(".admin_") or cmd == ".is_admin":
        # Bootstrap: Automatically add the first user who tries an admin command
        if str(chat_id) != "0" and cmd != ".admin_list_ids":
            c.execute("SELECT COUNT(*) FROM admins")
            if c.fetchone()[0] == 0:
                try:
                    admin_name = telegram_username or f"Admin_{chat_id}"
                    c.execute("INSERT INTO admins (telegram_id, name) VALUES (?, ?)", (str(chat_id), admin_name))
                    conn.commit()
                except: pass

        if cmd == ".is_admin":
            target = parts[1] if len(parts) > 1 else telegram_username
            if is_admin(target):
                conn.close()
                return "YES"
            conn.close()
            return "NO"

        elif cmd == ".admin_list_ids":
            conn.close()
            return ",".join(ADMIN_USERNAMES)

        elif cmd == ".admin_summary":
            if not is_admin(telegram_username): return "❌ Unauthorized"
            # Today's stats
            c.execute("SELECT COUNT(DISTINCT class) FROM timetable WHERE weekday=?", (ist_now.weekday(),))
            total_scheduled = c.fetchone()[0] * 8 # Approximation
            
            c.execute("SELECT COUNT(DISTINCT class || period) FROM period_attendance WHERE date=?", (today,))
            marked_count = c.fetchone()[0]
            
            c.execute("SELECT COUNT(*) FROM period_attendance WHERE date=? AND status='A'", (today,))
            absentees = c.fetchone()[0]
            
            c.execute("SELECT COUNT(*) FROM substitute_log WHERE date=?", (today,))
            subs = c.fetchone()[0]
            
            lines = [
                "📅 <b>Today's Attendance Summary</b>",
                f"Date: {escape_html(today_display)}",
                "━━━━━━━━━━━━━━━━━━━━━",
                f"✅ Marked Classes: {marked_count}",
                f"❌ Total Absentees: {absentees}",
                f"🔄 Substitutions: {subs}",
                "━━━━━━━━━━━━━━━━━━━━━",
                "MARKHINS Administration 🌟"
            ]
            conn.close()
            return "\n".join(lines)

        elif cmd == ".admin_pending":
            # Classes that are scheduled but not marked
            weekday = ist_now.weekday()
            c.execute("SELECT class, period_label FROM timetable WHERE weekday=? ORDER BY class, period_label", (weekday,))
            scheduled = c.fetchall()
            
            c.execute("SELECT DISTINCT class, period FROM period_attendance WHERE date=?", (today,))
            marked = {(r[0], r[1]) for r in c.fetchall()}
            
            pending = []
            for cls, p in scheduled:
                if (cls, p) not in marked:
                    pending.append(f"• {cls} - {p}")
            
            if not pending:
                response = "✅ All scheduled classes have been marked for today!"
            else:
                response = "⏳ <b>Pending Attendances Today</b>\n\n" + "\n".join([escape_html(p) for p in pending[:50]])
                if len(pending) > 50:
                    response += f"\n...and {len(pending)-50} more."
            
            conn.close()
            return response

        elif cmd == ".admin_sub_log":
            # Today's substitution log
            c.execute("SELECT period, actual_teacher, substitute_teacher, class FROM substitute_log WHERE date=? ORDER BY period", (today,))
            rows = c.fetchall()
            
            if not rows:
                response = "ℹ️ No substitutions recorded today."
            else:
                lines = ["🔄 <b>Today's Substitutions</b>"]
                for r in rows:
                    lines.append(f"• {escape_html(r[0])} ({escape_html(r[3])}): {escape_html(r[1])} ➡️ {escape_html(r[2])}")
                response = "\n".join(lines)
            
            conn.close()
            return response

        elif cmd == ".admin_test_principal":
            c.execute("""
                SELECT telegram_chat_id 
                FROM teachers 
                WHERE UPPER(class_teacher_of)='PRINCIPAL' 
                OR UPPER(name)='PRINCIPAL' 
                LIMIT 1
            """)
            row = c.fetchone()

            if row and row[0]:
                send_whatsapp_message(
                    row[0],
                    "📣 <b>Notification Test</b>\nThis is a test notification from the Admin Panel. Principal-level access confirmed."
                )
                response = "✅ Test notification sent to Principal."
            else:
                response = "❌ Principal not found in database or no Chat ID linked."

            conn.close()
            return response


        elif cmd == ".admin_test_teacher":
            if not is_admin(telegram_username): return "❌ Unauthorized"
            # Send test to self
            send_whatsapp_message(chat_id, "📣 <b>Notification Test</b>\nThis is a test notification from the Admin Panel. Teacher-level access confirmed.")
            response = "✅ Test notification sent to you."
            conn.close()
            return response

        elif cmd == ".admin_list":
            if not is_admin(telegram_username): return "❌ Unauthorized"
            response = f"📋 <b>Authorized Administrators</b>\n"
            response += "\n".join(sorted(ADMIN_USERNAMES))
            conn.close()
            return response

        elif cmd == ".admin_add":
            conn.close()
            return "❌ Admin users are hardcoded. Cannot add new admins via command."

        elif cmd == ".admin_remove":
            conn.close()
            return "❌ Admin users are hardcoded. Cannot remove admins via command."

    # Fallback for any other commands: ensure we return a string, not None
    if not response:
        response = "❓ Unknown command."

    conn.close()
    return response


# === Bridge with Node.js & Web API ===
if __name__ == "__main__":
    try:
        raw = sys.stdin.read()
        if not raw:
            sys.exit(0)
        data = json.loads(raw)
        
        action = data.get("action")
        
        # --- WEB APP API MODE ---
        if action:
            conn = sqlite3.connect(DB_NAME)
            c = conn.cursor()
            result = {"success": False}

            try:
                if action == "login":
                    username = data.get("username", "").lower().strip()
                    password = str(data.get("password", ""))  # phone number entered by user

                    # Query teacher by username
                    c.execute("SELECT id, name, phone, class_teacher_of, subject FROM teachers WHERE LOWER(username)=?", (username,))
                    teacher = c.fetchone()
                    print(f"[DEBUG] Login attempt - Username: {username}, Found in DB: {teacher is not None}")
                    
                    authenticated = False
                    if teacher:
                        tid, tname, tphone, tcto, tsubj = teacher
                        stored_password = str(tphone or "").strip()
                        entered_password = str(password).strip()
                        print(f"[DEBUG] Stored pass: '{stored_password}', Entered pass: '{entered_password}'")
                        
                        if not stored_password:
                            # User has no password set (NULL or empty string) - allow default
                            print("[DEBUG] Using default password check")
                            if entered_password == "staffcouncil":
                                authenticated = True
                        else:
                            # User has a set password
                            if entered_password == stored_password:
                                authenticated = True
                    
                    print(f"[DEBUG] Authentication result: {authenticated}")

                    if authenticated:
                        tid, tname, tphone, tcto, tsubj = teacher
                        
                        # ── Role Detection ──
                        # Hardcoded: id=3 = Principal (JAFAR NURANI), id=1 = VP (JUNAID NURANI)
                        if tid == 3:
                            role = "Principal"
                        elif tid == 1:
                            role = "Vice Principal"
                        else:
                            role = "Subject Teacher"
                            upper_cto = str(tcto or "").upper()
                            upper_name = str(tname or "").upper()
                            if "PRINCIPAL" in upper_name or "PRINCIPAL" in upper_cto:
                                role = "Vice Principal" if ("VICE" in upper_name or "VICE" in upper_cto) else "Principal"
                            elif tcto and str(tcto) not in ("None", "", "DEVELOPER"):
                                role = "Class Teacher"
                            
                        # Generate and store session token for single active session
                        import secrets
                        session_id = secrets.token_hex(16)
                        now_str = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
                        
                        c.execute("UPDATE teachers SET active_session_token=?, last_login=? WHERE id=?", 
                                (session_id, now_str, tid))
                        conn.commit()

                        result = {
                            "success": True,
                            "user": {
                                "id": tid,
                                "name": tname,
                                "role": role,
                                "class_teacher_of": tcto if role in ("Class Teacher", "Vice Principal") else None,
                                "subject": tsubj,
                                "sessionId": session_id
                            }
                        }
                    # ── HARDCODED ADMIN BYPASS REMOVED (Handled in server.js via Env Vars) ──
                    else:
                        result = {"success": False, "error": "Invalid username or password"}

                elif action == "get_classes":
                    # Comprehensive class list from all relevant tables
                    c.execute("""
                        SELECT DISTINCT class FROM (
                            SELECT class FROM students WHERE class IS NOT NULL AND class != ''
                            UNION SELECT class FROM timetable
                            UNION SELECT class FROM extra_classes
                            UNION SELECT class FROM attendance
                            UNION SELECT class_teacher_of as class FROM teachers WHERE class_teacher_of IS NOT NULL AND class_teacher_of != ''
                        ) 
                        WHERE UPPER(class) NOT IN ('DEVELOPER', 'MAIN PANEL', 'PRINCIPAL')
                        ORDER BY class
                    """)
                    classes = [{"id": r[0], "name": r[0]} for r in c.fetchall()]
                    result = {"success": True, "data": classes}

                elif action == "get_students":
                    class_id = data.get("classId")
                    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_id,))
                    student_rows = c.fetchall()
                    
                    students = []
                    for r in student_rows:
                        sid, roll, name = r
                        health_status = get_student_current_status(c, sid)
                        students.append({
                            "id": sid, 
                            "rollNo": roll, 
                            "name": name, 
                            "healthStatus": health_status, # 'S', 'L', or None
                            "health_status": health_status 
                        })
                    result = {"success": True, "data": students}

                elif action == "get_timetable":
                    cls = data.get("class")
                    c.execute("""
                        SELECT tt.weekday, tt.period_label, tt.subject, t.name as teacher_name
                        FROM timetable tt
                        LEFT JOIN teachers t ON tt.teacher_id = t.id
                        WHERE tt.class=?
                        ORDER BY tt.weekday, tt.period_label
                    """, (cls,))
                    rows = c.fetchall()
                    timetable = [
                        {"weekday": r[0], "period": r[1], "subject": r[2], "teacher": r[3]}
                        for r in rows
                    ]
                    result = {"success": True, "data": timetable}

                elif action == "get_student_history":
                    roll_no = data.get("rollNo")
                    c.execute("SELECT id, name, class FROM students WHERE roll_no=?", (roll_no,))
                    student = c.fetchone()
                    if student:
                        sid, sname, sclass = student
                        total, attended, percent, log = get_student_stats(c, sid, sname, sclass, roll_no)
                        result = {
                            "success": True,
                            "data": {
                                "id": sid, "name": sname, "class": sclass, "rollNo": roll_no,
                                "stats": {"total": total, "attended": attended, "percent": percent},
                                "log": [{"date": l[0], "period": l[1], "status": l[2]} for l in log]
                            }
                        }
                    else:
                        result = {"success": False, "message": "Student not found"}

                elif action == "get_period_summary":
                    class_id = data.get("class")
                    period = data.get("period")
                    date = data.get("date")

                    # Normalize period label
                    if period and not period.startswith("P"):
                        period = f"P{period}"

                    # ── Get all students in class ──
                    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_id,))
                    students_rows = c.fetchall()

                    # ── Get period_attendance records for this session ──
                    c.execute("""
                        SELECT pa.student_id, pa.status, pa.teacher_id, t.name
                        FROM period_attendance pa
                        LEFT JOIN teachers t ON pa.teacher_id = t.id
                        WHERE pa.date=? AND pa.class=? AND pa.period=?
                    """, (date, class_id, period))
                    pa_rows = c.fetchall()
                    # Map student_id -> status, also get who actually marked
                    pa_map = {}
                    actual_teacher_name = None
                    actual_teacher_id = None
                    for sid, status, tid, tname in pa_rows:
                        pa_map[sid] = status
                        if actual_teacher_name is None:
                            actual_teacher_name = tname
                            actual_teacher_id = tid

                    # ── Scheduled teacher from timetable ──
                    current_date_obj = dt.strptime(date, "%Y-%m-%d")
                    weekday = current_date_obj.weekday()
                    c.execute("""
                        SELECT tt.subject, t.name, t.id
                        FROM timetable tt
                        LEFT JOIN teachers t ON tt.teacher_id = t.id
                        WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
                    """, (class_id, weekday, period))
                    tt_row = c.fetchone()
                    scheduled_subject = tt_row[0] if tt_row else None
                    scheduled_teacher_name = tt_row[1] if tt_row else None
                    scheduled_teacher_id = tt_row[2] if tt_row else None

                    # ── Check substitute_log_simple for override ──
                    substitute_info = None
                    c.execute("""
                        SELECT scheduled_teacher_name, substitute_teacher_name
                        FROM substitute_log_simple
                        WHERE date=? AND class=? AND period=?
                        ORDER BY id DESC LIMIT 1
                    """, (date, class_id, period))
                    sub_row = c.fetchone()
                    if sub_row:
                        substitute_info = {
                            "scheduled": sub_row[0],
                            "substitute": sub_row[1]
                        }

                    # ── Check attendance table for S/L overrides ──
                    c.execute("""
                        SELECT student_id, status FROM attendance
                        WHERE date=? AND class=? AND period=? AND status IN ('S','L')
                    """, (date, class_id, period))
                    sl_map = {r[0]: r[1] for r in c.fetchall()}

                    # ── Build student records with full status ──
                    records = []
                    counts = {"present": 0, "absent": 0, "sick": 0, "leave": 0, "not_marked": 0}
                    for sid, roll, name in students_rows:
                        # S/L from attendance table takes priority
                        if sid in sl_map:
                            raw = sl_map[sid]
                            status_label = "sick" if raw == "S" else "leave"
                        elif sid in pa_map:
                            code = pa_map[sid]
                            status_label = {"P": "present", "A": "absent", "S": "sick", "L": "leave"}.get(code, "absent")
                        else:
                            status_label = "not_marked"

                        counts[status_label] = counts.get(status_label, 0) + 1
                        records.append({
                            "id": sid,
                            "rollNo": roll,
                            "name": name,
                            "status": status_label
                        })

                    is_taken = len(pa_map) > 0

                    result = {
                        "success": True,
                        "data": {
                            "class": class_id,
                            "period": period,
                            "date": date,
                            "subject": scheduled_subject,
                            "scheduledTeacher": scheduled_teacher_name,
                            "actualTeacher": actual_teacher_name,
                            "isSubstitute": (
                                bool(substitute_info) or
                                (actual_teacher_id is not None and scheduled_teacher_id is not None
                                 and actual_teacher_id != scheduled_teacher_id)
                            ),
                            "substituteInfo": substitute_info,
                            "isTaken": is_taken,
                            "counts": counts,
                            "records": records
                        }
                    }


                elif action == "get_daily_report":
                    date = data.get("date")
                    # Use a comprehensive class list for report
                    c.execute("""
                        SELECT DISTINCT class FROM (
                            SELECT class FROM students WHERE class IS NOT NULL AND class != ''
                            UNION SELECT class FROM timetable
                            UNION SELECT class FROM extra_classes
                            UNION SELECT class FROM period_attendance WHERE date=?
                        )
                        WHERE UPPER(class) NOT IN ('DEVELOPER', 'MAIN PANEL', 'PRINCIPAL')
                    """, (date,))
                    raw_classes = [row[0] for row in c.fetchall()]
                    
                    # Custom Sorting Order
                    order_map = {
                        'hs1': 10, 'hsu1': 20, 'hs2': 30, 'hsu2': 40,
                        'bs1': 50, 'bs2': 60, 'bs3': 70, 'bs4': 80, 'bs5': 90
                    }
                    def class_sort_key(cls):
                        return order_map.get(cls.lower(), 999)
                    
                    classes = sorted(raw_classes, key=class_sort_key)
                    
                    current_date_obj = dt.strptime(date, "%Y-%m-%d")
                    weekday = current_date_obj.weekday()
                    
                    report_data = []
                    for cls in classes:
                        periods = []
                        for p in ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]:
                            # Check timetable
                            c.execute("""
                                SELECT tt.subject, t.name 
                                FROM timetable tt 
                                JOIN teachers t ON tt.teacher_id = t.id 
                                WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
                            """, (cls, weekday, p))
                            tt_row = c.fetchone()
                            
                            # Check attendance
                            c.execute("SELECT status FROM period_attendance WHERE date=? AND class=? AND period=? LIMIT 1", (date, cls, p))
                            pa_row = c.fetchone()
                            
                            periods.append({
                                "period": p,
                                "scheduled": bool(tt_row),
                                "subject": tt_row[0] if tt_row else None,
                                "taken": bool(pa_row)
                            })
                        report_data.append({"class": cls, "periods": periods})
                    
                    result = {"success": True, "data": report_data}

                elif action == "get_batch_report":
                    class_id = data.get("classId")
                    c.execute("SELECT id, roll_no, name FROM students WHERE class=? ORDER BY roll_no", (class_id,))
                    students = c.fetchall()
                    
                    batch_data = []
                    for sid, roll, name in students:
                        total, attended, percent, _ = get_student_stats(c, sid, name, class_id, roll)
                        batch_data.append({
                            "rollNo": roll,
                            "name": name,
                            "total": total,
                            "attended": attended,
                            "absent": total - attended,
                            "percent": percent
                        })
                    result = {"success": True, "data": batch_data}

                elif action == "get_weekly_report":
                    end_date = get_ist_now()
                    start_date = end_date - datetime.timedelta(days=7)
                    start_str = start_date.strftime("%Y-%m-%d")
                    end_str = end_date.strftime("%Y-%m-%d")
                    
                    c.execute("""
                        SELECT date, class, period, COUNT(*) as count 
                        FROM period_attendance 
                        WHERE date BETWEEN ? AND ? 
                        GROUP BY date, class, period
                        ORDER BY date DESC
                    """, (start_str, end_str))
                    rows = c.fetchall()
                    history = [{"date": r[0], "class": r[1], "period": r[2], "markedCount": r[3]} for r in rows]
                    result = {"success": True, "data": history}

                elif action == "get_sick_leave_overview":
                    # Currently active Sick
                    c.execute("""
                        SELECT s.name, s.roll_no, s.class, a.date, a.status 
                        FROM students s JOIN attendance a ON a.student_id = s.id 
                        WHERE a.status IN ('S', 'L') 
                        AND a.id = (SELECT id FROM attendance WHERE student_id = s.id ORDER BY date DESC, id DESC LIMIT 1)
                        ORDER BY s.class, s.roll_no
                    """)
                    rows = c.fetchall()
                    active = []
                    for name, roll, cls, adate, state in rows:
                        # Check if returned/cured
                        c.execute("SELECT 1 FROM attendance WHERE student_id=(SELECT id FROM students WHERE roll_no=?) AND status IN ('C', 'R') AND (date > ? OR (date = ? AND id > (SELECT id FROM attendance WHERE student_id=(SELECT id FROM students WHERE roll_no=?) AND status IN ('S','L') ORDER BY date DESC, id DESC LIMIT 1)))", (roll, adate, adate, roll))
                        if not c.fetchone():
                            active.append({"name": name, "rollNo": roll, "class": cls, "since": adate, "type": "Sick" if state == 'S' else "Leave"})
                    result = {"success": True, "data": active}

                elif action == "resolve_period":
                    cls = data.get("class")
                    period = data.get("period")
                    if not period.startswith("P"):
                        p_label = f"P{period}"
                    else:
                        p_label = period
                        
                    weekday = get_ist_now().weekday() 
                    
                    c.execute("""
                        SELECT tt.subject, t.name 
                        FROM timetable tt 
                        LEFT JOIN teachers t ON tt.teacher_id = t.id 
                        WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
                    """, (cls, weekday, p_label))
                    row = c.fetchone()
                    
                    if row:
                        result = {"success": True, "data": {"subject": row[0], "teacher": row[1]}}
                    else:
                        result = {"success": False, "message": f"No subject scheduled for {cls} in Period {p_label} today."}

                elif action == "get_teacher_subjects":
                    teacher_id = data.get("teacherId")
                    c.execute("SELECT class, subject, period FROM teacher_subjects WHERE teacher_id=?", (teacher_id,))
                    subjects = [{"class": r[0], "subject": r[1], "period": r[2]} for r in c.fetchall()]
                    result = {"success": True, "data": subjects}

                elif action == "get_teacher_profile":
                    teacher_id = data.get("teacher_id")
                    c.execute("SELECT name, username, class_teacher_of, subject FROM teachers WHERE id=?", (teacher_id,))
                    row = c.fetchone()
                    if not row:
                        result = {"success": False, "error": "Teacher not found."}
                    else:
                        name, username, class_teacher_of, main_subject = row
                        
                        # ── Role Detection ──
                        # Hardcoded: id=3 is Principal (JAFAR NURANI), id=1 is Vice Principal (JUNAID NURANI)
                        PRINCIPAL_ID = 3
                        VP_ID = 1
                        role = "Subject Teacher"
                        
                        if int(teacher_id) == PRINCIPAL_ID:
                            role = "Principal"
                        elif int(teacher_id) == VP_ID:
                            role = "Vice Principal"
                        else:
                            upper_name = str(name or "").upper()
                            upper_cto = str(class_teacher_of or "").upper()
                            if "PRINCIPAL" in upper_name or "PRINCIPAL" in upper_cto:
                                role = "Vice Principal" if ("VICE" in upper_name or "VICE" in upper_cto) else "Principal"
                            elif class_teacher_of and str(class_teacher_of) not in ("None", "", "DEVELOPER"):
                                role = "Class Teacher"
                        
                        # Fetch all subjects/classes this teacher teaches from timetable
                        c.execute("SELECT DISTINCT class, subject FROM timetable WHERE teacher_id=? ORDER BY class, subject", (teacher_id,))
                        tt_rows = c.fetchall()
                        subjects = [{"class": r[0], "subject": r[1]} for r in tt_rows]
                        
                        result = {
                            "success": True,
                            "data": {
                                "name": name,
                                "username": username,
                                "imageUrl": get_teacher_image_url(teacher_id),
                                "role": role,
                                "class_teacher_of": class_teacher_of if role in ("Class Teacher", "Vice Principal") else None,
                                "main_subject": main_subject,
                                "subjects": subjects
                            }
                        }

                elif action == "get_teacher_profile_by_phone":
                    phone = str(data.get("phone", ""))
                    hardcoded_id = data.get("hardcoded_id")
                    
                    c.execute("SELECT id, name, username, class_teacher_of, subject FROM teachers WHERE phone=?", (phone,))
                    row = c.fetchone()
                    
                    if not row:
                        # Fallback: return minimal static profile if not in DB
                        is_vp = hardcoded_id == 999
                        result = {
                            "success": True,
                            "data": {
                                "name": "Vice Principal" if is_vp else "Principal",
                                "username": "vp" if is_vp else "principal",
                                "imageUrl": get_teacher_image_url(hardcoded_id),
                                "role": "Vice Principal" if is_vp else "Principal",
                                "class_teacher_of": "bs3" if is_vp else None,
                                "main_subject": "Administration & Teaching" if is_vp else "Administration",
                                "subjects": []
                            }
                        }
                    else:
                        real_id, name, username, class_teacher_of, main_subject = row
                        
                        # Role is always forced from hardcoded_id
                        is_vp = hardcoded_id == 999
                        role = "Vice Principal" if is_vp else "Principal"
                        
                        # Fetch all subjects/classes this teacher teaches from timetable
                        c.execute("SELECT DISTINCT class, subject FROM timetable WHERE teacher_id=? ORDER BY class, subject", (real_id,))
                        tt_rows = c.fetchall()
                        subjects = [{"class": r[0], "subject": r[1]} for r in tt_rows]
                        
                        result = {
                            "success": True,
                            "data": {
                                "name": name,
                                "username": username or ("vp" if is_vp else "principal"),
                                "role": role,
                                "class_teacher_of": "bs3" if is_vp else None,
                                "main_subject": main_subject or ("Administration & Teaching" if is_vp else "Administration"),
                                "subjects": subjects
                            }
                        }

                elif action == "get_teachers_list":
                    # Fetch all teachers
                    c.execute("SELECT id, name, username, class_teacher_of, subject FROM teachers ORDER BY name")
                    rows = c.fetchall()
                    
                    teachers_list = []
                    for r in rows:
                        tid, tname, tuname, tcto, tsubj = r
                        
                        trole = "Subject Teacher"
                        if str(tcto).upper() == "PRINCIPAL" or str(tname).upper() == "PRINCIPAL":
                            trole = "Principal"
                        elif tcto and str(tcto) not in ("None", "", "DEVELOPER"):
                            trole = "Class Teacher"
                        
                        teachers_list.append({
                            "id": tid,
                            "name": tname,
                            "username": tuname,
                            "role": trole,
                            "class_teacher_of": tcto if trole == "Class Teacher" else None,
                            "subject": tsubj
                        })
                    
                    result = {"success": True, "data": teachers_list}

                elif action == "get_full_timetable":
                    weekday = data.get("weekday", 0)
                    try:
                        c.execute("""
                            SELECT DISTINCT class FROM (
                                SELECT class FROM students WHERE class IS NOT NULL AND class != ''
                                UNION SELECT class FROM timetable WHERE class IS NOT NULL AND class != ''
                            ) ORDER BY class
                        """)
                        classes = [r[0] for r in c.fetchall()]
                        
                        full_tt = []
                        for cls in classes:
                            periods_dict = {}
                            for p in ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]:
                                c.execute("""
                                    SELECT tt.subject, t.name 
                                    FROM timetable tt 
                                    LEFT JOIN teachers t ON tt.teacher_id = t.id 
                                    WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
                                """, (cls, weekday, p))
                                row = c.fetchone()
                                periods_dict[p] = {"subject": row[0], "teacher": row[1]} if row else None
                            full_tt.append({"class": cls, "periods": periods_dict})
                        
                        result = {"success": True, "data": full_tt}
                    except Exception as e:
                        result = {"success": False, "message": f"Timetable Query Error: {str(e)}"}

                elif action == "get_subjects":
                    c.execute("""
                        SELECT DISTINCT subject FROM timetable 
                        WHERE subject IS NOT NULL AND subject != ''
                        ORDER BY subject
                    """)
                    subjects = [{"id": r[0], "name": r[0]} for r in c.fetchall()]
                    if not subjects:
                        subjects = [{"id": "General", "name": "General"}]
                    result = {"success": True, "data": subjects}

                elif action == "mark_attendance":
                    class_id = data.get("classId")
                    period_raw = data.get("period", "Web")
                    teacher_id = data.get("teacher_id", 1)
                    records = data.get("records", [])

                    date = get_ist_now().strftime("%Y-%m-%d")

                    if not period_raw.startswith("P"):
                        p_label = f"P{period_raw}"
                    else:
                        p_label = period_raw

                    # ── Feature 1: Duplicate check ──────────────────────────────
                    # Check if ANY attendance row already exists for this class/period/date
                    c.execute("""
                        SELECT COUNT(*) FROM period_attendance
                        WHERE class=? AND period=? AND date=?
                    """, (class_id, p_label, date))
                    already_count = c.fetchone()[0]
                    if already_count > 0:
                        result = {
                            "success": False,
                            "duplicate": True,
                            "error": "Attendance already marked for this period."
                        }
                    else:
                        weekday = get_ist_now().weekday()
                        c.execute("SELECT subject FROM timetable WHERE class=? AND weekday=? AND period_label=? LIMIT 1", (class_id, weekday, p_label))
                        row = c.fetchone()
                        subject_id = row[0] if row else "General"

                        now_ts = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")

                        for rec in records:
                            student_id = rec.get("studentId")
                            status_map = {"present": "P", "absent": "A", "sick": "S", "leave": "L"}
                            requested_status = status_map.get(rec.get("status"), "A")
                            
                            # BACKEND ENFORCEMENT: Check auto-absent for Sick/Leave
                            health_status = get_student_current_status(c, student_id)
                            if health_status in ('S', 'L'):
                                final_status = 'A' # Always Absent in period_attendance if marked Sick/Leave in health
                            else:
                                final_status = requested_status

                            c.execute("""
                                INSERT INTO period_attendance (date, class, period, student_id, status, teacher_id)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (date, class_id, p_label, student_id, final_status, teacher_id))

                        conn.commit()
                        result = {
                            "success": True,
                            "message": f"Attendance recorded for {len(records)} students.",
                            "last": {
                                "classId": class_id,
                                "period": p_label,
                                "date": date,
                                "teacher_id": teacher_id
                            }
                        }

                elif action == "get_last_attendance":
                    teacher_id = data.get("teacher_id")
                    
                    # 1. Get the very last attendance entry created by THIS teacher
                    c.execute("""
                        SELECT class, period, date, id FROM period_attendance
                        WHERE teacher_id=?
                        ORDER BY date DESC, id DESC LIMIT 1
                    """, (teacher_id,))
                    row = c.fetchone()
                    
                    if row:
                        class_id, period, date, row_id = row
                        
                        # 2. Check if ANY attendance was marked after this specific entry (any teacher)
                        # We use id and date to strictly ensure no NEWER record exists in the system.
                        c.execute("""
                            SELECT COUNT(*) FROM period_attendance
                            WHERE (date > ?) OR (date = ? AND id > ?)
                        """, (date, date, row_id))
                        newer_count = c.fetchone()[0]
                        
                        is_latest = (newer_count == 0)
                        
                        # 3. Resolve the subject name from the timetable for better UI
                        try:
                            weekday_idx = dt.strptime(date, "%Y-%m-%d").weekday()
                            c.execute("SELECT subject FROM timetable WHERE class=? AND weekday=? AND period_label=? LIMIT 1", (class_id, weekday_idx, period))
                            tt_row = c.fetchone()
                            subj_name = tt_row[0] if tt_row else ""
                        except:
                            subj_name = ""

                        result = {
                            "success": True,
                            "data": {
                                "classId": class_id,
                                "className": class_id,
                                "period": period,
                                "date": date,
                                "subjectName": subj_name,
                                "editable": is_latest
                            }
                        }
                    else:
                        result = {"success": True, "data": None}

                elif action == "get_marked_periods":
                    # --- NEW: Pre-check marked periods with teacher details for Seal UI ---
                    class_id = data.get("class")
                    date = data.get("date")

                    c.execute("""
                        SELECT DISTINCT pa.period, COALESCE(t.name, 'Admin') as name
                        FROM period_attendance pa
                        LEFT JOIN teachers t ON pa.teacher_id = t.id
                        WHERE pa.class=? AND pa.date=?
                    """, (class_id, date))
                    rows = c.fetchall()
                    
                    marked_results = [{"period": r[0], "teacher": r[1]} for r in rows]
                    marked_periods = [r[0] for r in rows]
                    
                    result = {
                        "success": True,
                        "data": {
                            "marked_periods": marked_periods,
                            "marked_details": marked_results
                        }
                    }

                elif action == "edit_last_attendance":
                    # ── Feature 3: Edit last attendance ─────────────────────────
                    class_id  = data.get("classId")
                    period    = data.get("period")
                    edit_date = data.get("date")
                    teacher_id= data.get("teacher_id", 1)
                    records   = data.get("records", [])

                    # Safety & Security: 
                    # 1. Fetch the actual record to check ownership
                    c.execute("""
                        SELECT teacher_id, id FROM period_attendance
                        WHERE class=? AND period=? AND date=?
                        ORDER BY id DESC LIMIT 1
                    """, (class_id, period, edit_date))
                    record = c.fetchone()
                    
                    if not record:
                        result = {"success": False, "error": "No attendance found to edit."}
                    elif record[0] != teacher_id:
                        result = {"success": False, "error": "Unauthorized: You did not mark this attendance."}
                    else:
                        # 2. Extra Security: Check if this is truly the LATEST entry in the system
                        rec_id = record[1]
                        c.execute("""
                            SELECT COUNT(*) FROM period_attendance
                            WHERE (date > ?) OR (date = ? AND id > ?)
                        """, (edit_date, edit_date, rec_id))
                        if c.fetchone()[0] > 0:
                            result = {"success": False, "error": "Unauthorized: A newer attendance has been marked."}
                        else:
                            now_ts = get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
                        for rec in records:
                            student_id = rec.get("studentId")
                            status_map = {"present": "P", "absent": "A", "sick": "S", "leave": "L"}
                            requested_status = status_map.get(rec.get("status"), "A")
                            
                            # BACKEND ENFORCEMENT: Check auto-absent for Sick/Leave
                            health_status = get_student_current_status(c, student_id)
                            if health_status in ('S', 'L'):
                                final_status = 'A'
                            else:
                                final_status = requested_status

                            c.execute("""
                                UPDATE period_attendance SET status=?, teacher_id=?
                                WHERE class=? AND period=? AND date=? AND student_id=?
                            """, (final_status, teacher_id, class_id, period, edit_date, student_id))

                        conn.commit()
                        result = {"success": True, "message": "Attendance updated successfully."}


                elif action == "get_extra_subjects":
                    # Return all known subjects for manual selection (only from timetable)
                    c.execute("""
                        SELECT DISTINCT subject FROM timetable 
                        WHERE subject IS NOT NULL AND subject != ''
                        ORDER BY subject
                    """)
                    rows = c.fetchall()
                    subjects = [{"id": r[0], "name": r[0]} for r in rows]
                    if not subjects:
                        subjects = [{"id": "General", "name": "General"}]
                    result = {"success": True, "data": subjects}

                elif action == "mark_extra_attendance":
                    # === EXTRA CLASS ATTENDANCE MARKING ===
                    # Mirrors bot's extra_att logic:
                    # - Stores in extra_classes table
                    # - Only absent roll numbers stored (everyone else = present)
                    class_id = data.get("classId")
                    subject_name = data.get("subject", "Extra Class")
                    teacher_id = data.get("teacher_id", 1)
                    period_val = data.get("period", "Extra")
                    records = data.get("records", [])  # [{studentId, rollNo, status}]
                    date = data.get("date", get_ist_now().strftime("%Y-%m-%d"))
                    now_ts = get_ist_now().strftime("%H:%M")

                    # Resolve teacher name for extra_classes.teacher column
                    c.execute("SELECT name FROM teachers WHERE id=?", (teacher_id,))
                    t_row = c.fetchone()
                    teacher_name = t_row[0] if t_row else f"Teacher#{teacher_id}"

                    # Normalize period label
                    if period_val and period_val != "Extra" and not period_val.startswith("P"):
                        period_val = f"P{period_val}"

                    # Build absent_rolls string from records (only absent students)
                    absent_rolls = []
                    present_count = 0
                    total_count = len(records)
                    for rec in records:
                        if rec.get("status") in ("absent", "A"):
                            absent_rolls.append(str(rec.get("rollNo", "")))
                        else:
                            present_count += 1

                    absent_rolls_str = ",".join(r for r in absent_rolls if r)

                    # Upsert into extra_classes (same as bot's extra_att logic)
                    c.execute("""
                        SELECT id FROM extra_classes
                        WHERE date=? AND class=? AND subject=? AND teacher=? AND period=?
                        ORDER BY id DESC LIMIT 1
                    """, (date, class_id, subject_name, teacher_name, period_val))
                    existing = c.fetchone()

                    if existing:
                        c.execute("""
                            UPDATE extra_classes SET absent_rolls=?, time=?
                            WHERE id=?
                        """, (absent_rolls_str, now_ts, existing[0]))
                    else:
                        c.execute("""
                            INSERT INTO extra_classes (date, class, subject, teacher, time, absent_rolls, period)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (date, class_id, subject_name, teacher_name, now_ts, absent_rolls_str, period_val))

                    conn.commit()

                    result = {
                        "success": True,
                        "message": f"Extra class attendance recorded for {class_id}.",
                        "data": {
                            "class": class_id,
                            "subject": subject_name,
                            "period": period_val,
                            "date": date,
                            "total": total_count,
                            "present": present_count,
                            "absent": len(absent_rolls)
                        }
                    }

                elif action == "get_health_list":
                    target_status = data.get("status") # 'S' or 'L'
                    
                    # Fetch latest status for every student who has ever had a health status
                    # We use a subquery to find the latest (highest ID) record per student
                    c.execute("""
                        SELECT s.roll_no, s.name, s.class
                        FROM students s
                        JOIN (
                            SELECT student_id, status, MAX(id) as max_id
                            FROM attendance
                            GROUP BY student_id
                        ) latest ON s.id = latest.student_id
                        WHERE latest.status = ?
                        ORDER BY s.class, s.roll_no
                    """, (target_status,))
                    
                    rows = c.fetchall()
                    
                    # Group by class
                    grouped_data = {}
                    for roll, name, cls in rows:
                        if cls not in grouped_data:
                            grouped_data[cls] = []
                        grouped_data[cls].append({"roll_no": roll, "name": name})
                    
                    # Format for frontend
                    final_data = []
                    for cls in sorted(grouped_data.keys()):
                        final_data.append({
                            "class": cls,
                            "students": grouped_data[cls]
                        })
                    
                    result = {
                        "success": True,
                        "health_list": final_data,
                        "total_count": len(rows)
                    }

                elif action == "health_action":
                    action_type = data.get("type") # sick, leave, cure, return
                    roll_no = data.get("roll_no")
                    teacher_id = data.get("teacher_id")

                    # Roll number normalization: ensure it's a list or string of rolls
                    # The frontend sends a single roll number as string
                    
                    # 1. Fetch teacher info to identify sender for handle_message
                    c.execute("SELECT telegram_username, telegram_chat_id, name FROM teachers WHERE id=?", (teacher_id,))
                    t_row = c.fetchone()
                    if not t_row:
                        result = {"success": False, "error": "Teacher not found."}
                    else:
                        t_username, t_chat_id, t_name = t_row
                        
                        # Map internal action type to bot command prefix
                        cmd_map = {'sick': 's', 'leave': 'l', 'cure': 'c', 'return': 'r'}
                        cmd_prefix = cmd_map.get(action_type)
                        
                        if not cmd_prefix:
                            result = {"success": False, "error": f"Invalid health action: {action_type}"}
                        else:
                            # Construct the exact message the bot would receive, e.g. "s 101"
                            bot_command = f"{cmd_prefix} {roll_no}"
                            
                            notifications = []
                            def capture_notif(cid, msg):
                                notifications.append({"chat_id": str(cid), "message": msg})
                            
                            # Re-use existing handle_message logic exactly as requested
                            reply = handle_message(t_username, t_chat_id or 12345, bot_command, capture_notif)
                            
                            # Determine success based on reply content
                            # Success patterns: "Marked Sick", "Recovered", "Returned", "Marked Leave"
                            # Failure patterns: "BLOCKED", "Unauthorized", "Not Found", etc.
                            success = True
                            low_reply = reply.lower()
                            if any(x in low_reply for x in ["access denied", "blocked", "not found", "invalid", "unauthorized"]):
                                success = False
                            
                            # Special case: If bot returns a help message or doesn't mention the action
                            if len(reply) > 500 or "choose an action" in low_reply:
                                success = False
                                reply = "Invalid student identifier or command format."

                            result = {
                                "success": success,
                                "reply": reply,
                                "message": reply,
                                "error": None if success else reply,
                                "notifications": notifications
                            }

                elif action == "get_admin_sessions":
                    c.execute("SELECT id, name, class_teacher_of, last_login, active_session_token, username, phone FROM teachers ORDER BY name")
                    rows = c.fetchall()
                    sessions = []
                    for r in rows:
                        sessions.append({
                            "id": r[0],
                            "name": r[1],
                            "class": r[2],
                            "last_login": r[3],
                            "session_active": bool(r[4]),
                            "username": r[5],
                            "password": r[6]
                        })
                    result = {"success": True, "sessions": sessions}

                elif action == "get_admin_activity_log":
                    report_date = str(data.get("date") or get_ist_now().strftime("%Y-%m-%d")).strip()

                    c.execute("""
                        SELECT id, name, username, class_teacher_of, last_login
                        FROM teachers
                        WHERE TRIM(COALESCE(active_session_token, '')) != ''
                        ORDER BY COALESCE(last_login, '') DESC, name COLLATE NOCASE
                    """)
                    active_rows = c.fetchall()
                    active_users = []
                    for tid, name, username, class_teacher_of, last_login in active_rows:
                        role = "Subject Teacher"
                        upper_name = str(name or "").upper()
                        upper_cto = str(class_teacher_of or "").upper()
                        if tid == 3:
                            role = "Principal"
                        elif tid == 1:
                            role = "Vice Principal"
                        elif "PRINCIPAL" in upper_name or "PRINCIPAL" in upper_cto:
                            role = "Vice Principal" if ("VICE" in upper_name or "VICE" in upper_cto) else "Principal"
                        elif class_teacher_of and str(class_teacher_of) not in ("None", "", "DEVELOPER"):
                            role = "Class Teacher"

                        active_users.append({
                            "id": tid,
                            "name": name,
                            "username": username,
                            "role": role,
                            "classTeacherOf": class_teacher_of,
                            "lastLogin": last_login,
                        })

                    actions = []

                    def append_action(sort_key, actor, username, action_type, summary, meta=""):
                        actions.append({
                            "sortKey": sort_key or "",
                            "timestamp": sort_key or "",
                            "actor": actor or "System",
                            "username": username or "",
                            "type": action_type,
                            "summary": summary,
                            "meta": meta,
                        })

                    c.execute("""
                        SELECT name, username, last_login
                        FROM teachers
                        WHERE last_login LIKE ?
                        ORDER BY last_login DESC
                    """, (f"{report_date}%",))
                    for name, username, last_login in c.fetchall():
                        time_label = last_login.split(" ")[1] if last_login and " " in last_login else "Today"
                        append_action(last_login, name, username, "Login", "Logged into the app", time_label)

                    c.execute("""
                        SELECT pa.teacher_id, t.name, t.username, pa.class, pa.period,
                               COUNT(*),
                               SUM(CASE WHEN pa.status='A' THEN 1 ELSE 0 END),
                               SUM(CASE WHEN pa.status='S' THEN 1 ELSE 0 END),
                               SUM(CASE WHEN pa.status='L' THEN 1 ELSE 0 END)
                        FROM period_attendance pa
                        LEFT JOIN teachers t ON pa.teacher_id = t.id
                        WHERE pa.date = ?
                        GROUP BY pa.teacher_id, pa.class, pa.period
                        ORDER BY pa.period DESC, pa.class ASC
                    """, (report_date,))
                    for teacher_id, name, username, cls, period, total_marked, absent_count, sick_count, leave_count in c.fetchall():
                        meta_parts = [f"{total_marked} students"]
                        if absent_count:
                            meta_parts.append(f"{absent_count} absent")
                        if sick_count:
                            meta_parts.append(f"{sick_count} sick")
                        if leave_count:
                            meta_parts.append(f"{leave_count} leave")
                        append_action(
                            f"{report_date} {period}",
                            name,
                            username,
                            "Attendance",
                            f"Marked attendance for {cls} {period}",
                            " • ".join(meta_parts)
                        )

                    c.execute("""
                        SELECT a.created_at, t.name, t.username, a.class, a.status, COUNT(*)
                        FROM attendance a
                        LEFT JOIN teachers t ON a.marked_by = t.id
                        WHERE a.date = ? AND a.status IN ('S', 'L', 'C', 'R')
                        GROUP BY a.created_at, a.marked_by, a.class, a.status
                        ORDER BY COALESCE(a.created_at, '') DESC, a.id DESC
                    """, (report_date,))
                    status_labels = {'S': 'Marked sick', 'L': 'Marked leave', 'C': 'Marked cured', 'R': 'Marked returned'}
                    for created_at, name, username, cls, status, count in c.fetchall():
                        time_label = created_at.split(" ")[1] if created_at and " " in created_at else cls
                        append_action(
                            created_at or f"{report_date} 00:00:00",
                            name,
                            username,
                            "Health",
                            f"{status_labels.get(status, 'Updated health status')} for {cls}",
                            f"{count} student{'s' if count != 1 else ''} • {time_label}"
                        )

                    c.execute("""
                        SELECT created_at, teacher, class, subject, period, time
                        FROM extra_classes
                        WHERE date = ?
                        ORDER BY COALESCE(created_at, '') DESC
                    """, (report_date,))
                    for created_at, teacher_name, cls, subject, period, time_value in c.fetchall():
                        append_action(
                            created_at or f"{report_date} 00:00:00",
                            teacher_name,
                            "",
                            "Extra Class",
                            f"Recorded extra class for {cls} {period or 'Extra'}",
                            f"{subject} • {time_value or 'Today'}"
                        )

                    c.execute("""
                        SELECT created_at, substitute_teacher, actual_teacher, class, period, subject
                        FROM substitute_log
                        WHERE date = ?
                        ORDER BY COALESCE(created_at, '') DESC
                    """, (report_date,))
                    for created_at, substitute_teacher, actual_teacher, cls, period, subject in c.fetchall():
                        append_action(
                            created_at or f"{report_date} 00:00:00",
                            substitute_teacher,
                            "",
                            "Substitute",
                            f"Handled substitute class for {cls} {period}",
                            f"{subject} • Assigned teacher: {actual_teacher}"
                        )

                    actions.sort(key=lambda row: row.get("sortKey") or "", reverse=True)
                    for row in actions:
                        row["time"] = row["sortKey"].split(" ")[1] if " " in row["sortKey"] else row["sortKey"]
                        row.pop("sortKey", None)

                    result = {"success": True, "data": {"activeUsers": active_users, "actions": actions[:80]}}

                elif action == "get_admin_teachers":
                    c.execute("""
                        SELECT id, name, username, phone, class_teacher_of, subject, active_session_token
                        FROM teachers
                        ORDER BY name COLLATE NOCASE, username COLLATE NOCASE
                    """)
                    rows = c.fetchall()
                    teachers = []
                    for r in rows:
                        tid, name, username, phone, class_teacher_of, subject, active_session_token = r
                        teachers.append({
                            "id": tid,
                            "name": name,
                            "username": username,
                            "imageUrl": get_teacher_image_url(tid),
                            "hasPassword": bool(str(phone or "").strip()),
                            "passwordStatus": "Has password" if str(phone or "").strip() else "Using default",
                            "classTeacherOf": class_teacher_of,
                            "subject": subject,
                            "sessionActive": bool(active_session_token)
                        })
                    result = {"success": True, "data": teachers}

                elif action == "create_teacher":
                    name = str(data.get("name") or "").strip()
                    username = str(data.get("username") or "").strip().lower()
                    password = str(data.get("password") or "").strip()

                    if not name:
                        result = {"success": False, "message": "Teacher name is required."}
                    elif not username:
                        result = {"success": False, "message": "Username is required."}
                    else:
                        c.execute("SELECT id FROM teachers WHERE LOWER(username)=?", (username,))
                        if c.fetchone():
                            result = {"success": False, "message": "Username already exists."}
                        else:
                            c.execute("""
                                INSERT INTO teachers (name, username, phone, class_teacher_of, subject)
                                VALUES (?, ?, ?, '', 'General')
                            """, (name, username, password))
                            conn.commit()
                            result = {"success": True, "message": "Teacher created successfully."}

                elif action == "update_teacher":
                    teacher_id = data.get("teacherId")
                    name = str(data.get("name") or "").strip()
                    username = str(data.get("username") or "").strip().lower()
                    password = data.get("password")

                    if not teacher_id:
                        result = {"success": False, "message": "Teacher ID is required."}
                    elif not name:
                        result = {"success": False, "message": "Teacher name is required."}
                    elif not username:
                        result = {"success": False, "message": "Username is required."}
                    else:
                        c.execute("SELECT id FROM teachers WHERE id=?", (teacher_id,))
                        if not c.fetchone():
                            result = {"success": False, "message": "Teacher not found."}
                        else:
                            c.execute("SELECT id FROM teachers WHERE LOWER(username)=? AND id != ?", (username, teacher_id))
                            if c.fetchone():
                                result = {"success": False, "message": "Username already exists."}
                            else:
                                if password is not None and str(password).strip() != "":
                                    c.execute("UPDATE teachers SET name=?, username=?, phone=? WHERE id=?", (name, username, str(password).strip(), teacher_id))
                                else:
                                    c.execute("UPDATE teachers SET name=?, username=? WHERE id=?", (name, username, teacher_id))
                                conn.commit()
                                result = {"success": True, "message": "Teacher updated successfully."}

                elif action == "delete_teacher":
                    teacher_id = data.get("teacherId")

                    if not teacher_id:
                        result = {"success": False, "message": "Teacher ID is required."}
                    else:
                        c.execute("SELECT id FROM teachers WHERE id=?", (teacher_id,))
                        if not c.fetchone():
                            result = {"success": False, "message": "Teacher not found."}
                        else:
                            c.execute("DELETE FROM teacher_subjects WHERE teacher_id=?", (teacher_id,))
                            c.execute("UPDATE timetable SET teacher_id=NULL WHERE teacher_id=?", (teacher_id,))
                            c.execute("DELETE FROM teachers WHERE id=?", (teacher_id,))
                            conn.commit()
                            result = {"success": True, "message": "Teacher deleted successfully."}

                elif action == "get_admin_timetable":
                    weekday = int(data.get("weekday", 0))

                    c.execute("""
                        SELECT DISTINCT class FROM (
                            SELECT class FROM students WHERE class IS NOT NULL AND class != ''
                            UNION
                            SELECT class FROM timetable WHERE class IS NOT NULL AND class != ''
                        )
                        ORDER BY class
                    """)
                    classes = [r[0] for r in c.fetchall()]

                    timetable_rows = []
                    for cls in classes:
                        periods_dict = {}
                        for p in ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]:
                            c.execute("""
                                SELECT tt.subject, tt.teacher_id, t.name
                                FROM timetable tt
                                LEFT JOIN teachers t ON tt.teacher_id = t.id
                                WHERE tt.class=? AND tt.weekday=? AND tt.period_label=? LIMIT 1
                            """, (cls, weekday, p))
                            row = c.fetchone()
                            periods_dict[p] = {
                                "subject": row[0] if row else "",
                                "teacherId": row[1] if row else None,
                                "teacher": row[2] if row else "",
                            }
                        timetable_rows.append({"class": cls, "periods": periods_dict})

                    result = {"success": True, "data": timetable_rows}

                elif action == "get_teacher_subject_options":
                    teacher_id = data.get("teacherId")

                    c.execute("""
                        SELECT DISTINCT subject FROM (
                            SELECT subject FROM teacher_subjects WHERE teacher_id=? AND subject IS NOT NULL AND TRIM(subject) != ''
                            UNION
                            SELECT subject FROM timetable WHERE teacher_id=? AND subject IS NOT NULL AND TRIM(subject) != ''
                            UNION
                            SELECT subject FROM teachers WHERE id=? AND subject IS NOT NULL AND TRIM(subject) != '' AND subject != 'General'
                        )
                        ORDER BY subject COLLATE NOCASE
                    """, (teacher_id, teacher_id, teacher_id))
                    subjects = [r[0] for r in c.fetchall()]
                    result = {"success": True, "data": subjects}

                elif action == "update_timetable_period":
                    class_id = str(data.get("classId") or "").strip()
                    weekday = data.get("weekday")
                    period_label = str(data.get("period") or "").strip().upper()
                    teacher_id = data.get("teacherId")
                    subject = str(data.get("subject") or "").strip()

                    if not class_id:
                        result = {"success": False, "message": "Class is required."}
                    elif weekday is None or weekday == "":
                        result = {"success": False, "message": "Weekday is required."}
                    elif not period_label:
                        result = {"success": False, "message": "Period is required."}
                    elif not teacher_id or not subject:
                        c.execute("DELETE FROM timetable WHERE class=? AND weekday=? AND period_label=?", (class_id, int(weekday), period_label))
                        conn.commit()
                        result = {"success": True, "message": "Timetable entry cleared."}
                    else:
                        c.execute("""
                            SELECT 1
                            FROM (
                                SELECT subject FROM teacher_subjects WHERE teacher_id=?
                                UNION
                                SELECT subject FROM timetable WHERE teacher_id=?
                                UNION
                                SELECT subject FROM teachers WHERE id=?
                            )
                            WHERE TRIM(COALESCE(subject, '')) != '' AND subject=?
                            LIMIT 1
                        """, (teacher_id, teacher_id, teacher_id, subject))
                        if not c.fetchone():
                            c.execute("""
                                INSERT INTO teacher_subjects (teacher_id, class, subject, period)
                                VALUES (?, ?, ?, ?)
                            """, (teacher_id, class_id, subject, period_label))

                        c.execute("SELECT id FROM timetable WHERE class=? AND weekday=? AND period_label=? LIMIT 1", (class_id, int(weekday), period_label))
                        existing = c.fetchone()
                        if existing:
                            c.execute("""
                                UPDATE timetable
                                SET subject=?, teacher_id=?
                                WHERE id=?
                            """, (subject, teacher_id, existing[0]))
                        else:
                            c.execute("""
                                INSERT INTO timetable (class, weekday, period_label, subject, teacher_id)
                                VALUES (?, ?, ?, ?, ?)
                            """, (class_id, int(weekday), period_label, subject, teacher_id))
                        conn.commit()
                        result = {"success": True, "message": "Timetable updated successfully."}

                elif action == "update_credentials":
                    target_tid = data.get("teacher_id")
                    new_username = str(data.get("username", "")).lower().strip()
                    new_password = str(data.get("password", "")).strip()

                    if not new_username or not new_password:
                        result = {"success": False, "error": "Username and password cannot be empty."}
                    else:
                        # Check if duplicate username
                        c.execute("SELECT id FROM teachers WHERE LOWER(username)=? AND id != ?", (new_username, target_tid))
                        if c.fetchone():
                            result = {"success": False, "error": "Username already taken."}
                        else:
                            c.execute("UPDATE teachers SET username=?, phone=? WHERE id=?", (new_username, new_password, target_tid))
                            conn.commit()
                            result = {"success": True, "message": "Credentials updated successfully."}

                elif action == "revoke_session":
                    target_tid = data.get("teacher_id")
                    c.execute("UPDATE teachers SET active_session_token=NULL WHERE id=?", (target_tid,))
                    conn.commit()
                    result = {"success": True, "message": "Session revoked successfully"}

                elif action == "get_system_info":
                    c.execute("SELECT COUNT(*) FROM students")
                    student_count = c.fetchone()[0]
                    c.execute("SELECT COUNT(*) FROM teachers")
                    teacher_count = c.fetchone()[0]
                    c.execute("SELECT COUNT(DISTINCT date || '-' || period || '-' || class) FROM period_attendance")
                    total_classes = c.fetchone()[0]
                    
                    result = {
                        "success": True,
                        "data": {
                            "dbPath": DB_NAME,
                            "totalStudents": student_count,
                            "totalTeachers": teacher_count,
                            "totalClasses": total_classes,
                            "currentTime": get_ist_now().strftime("%Y-%m-%d %H:%M:%S")
                        }
                    }

                elif action == "get_admin_config":
                    c.execute("SELECT value FROM system_settings WHERE key='admin_password'")
                    row = c.fetchone()
                    result = {
                        "success": True,
                        "admin_password": row[0] if row else None
                    }

                elif action == "update_admin_password":
                    new_password = data.get("password")
                    if not new_password:
                        result = {"success": False, "message": "Password cannot be empty"}
                    else:
                        c.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('admin_password', ?)", (new_password,))
                        conn.commit()
                        result = {"success": True, "message": "Admin password updated successfully"}

                elif action == "verify_session":
                    tid = data.get("teacher_id")
                    session_id = data.get("sessionId")
                    c.execute("SELECT active_session_token FROM teachers WHERE id=?", (tid,))
                    row = c.fetchone()
                    if row and row[0] == session_id:
                        result = {"success": True}
                    else:
                        result = {"success": False, "error": "Session invalidated"}

                elif action == "get_absentees_report":
                    class_id = str(data.get("classId") or "").strip()
                    date = str(data.get("date") or "").strip() or get_ist_now().strftime("%Y-%m-%d")
                    status_filter = str(data.get("filter", "all") or "all").strip().upper()
                    
                    print(f"[DEBUG] Fetching absentees for class: '{class_id}' on {date}")
                    
                    # 1. Get all students scheduled for this class
                    c.execute("SELECT id, roll_no, name FROM students WHERE UPPER(class)=UPPER(?) ORDER BY roll_no", (class_id,))
                    students_data = c.fetchall()
                    students_map = {
                        row[0]: {"roll": row[1], "name": row[2], "codes": set(), "absent_count": 0}
                        for row in students_data
                    }
                    
                    print(f"[DEBUG] Found {len(students_map)} students in class")
                    
                    if not students_map:
                        result = {"success": True, "data": []}
                    else:
                        # 2. Extract all non-present period statuses for the selected day.
                        c.execute("""
                            SELECT student_id, status, COUNT(*) 
                            FROM period_attendance 
                            WHERE date=? AND UPPER(class)=UPPER(?) AND status IN ('A', 'S', 'L')
                            GROUP BY student_id, status
                        """, (date, class_id))
                        p_recs = c.fetchall()
                        print(f"[DEBUG] Found {len(p_recs)} period_attendance records")
                        
                        for sid, status, count in p_recs:
                            if sid in students_map:
                                normalized_status = str(status or "").strip().upper()
                                if normalized_status in ('A', 'S', 'L'):
                                    students_map[sid]["codes"].add(normalized_status)
                                if normalized_status == 'A':
                                    students_map[sid]["absent_count"] += count
                        
                        # 3. Resolve the latest same-day health status per student.
                        c.execute("""
                            SELECT a.student_id, a.status
                            FROM attendance a
                            INNER JOIN (
                                SELECT student_id, MAX(id) AS latest_id
                                FROM attendance
                                WHERE date=? AND UPPER(class)=UPPER(?) AND status IN ('S', 'L', 'C', 'R')
                                GROUP BY student_id
                            ) latest ON latest.latest_id = a.id
                        """, (date, class_id))
                        a_recs = c.fetchall()
                        print(f"[DEBUG] Found {len(a_recs)} health status records")
                        
                        for sid, status in a_recs:
                            if sid in students_map:
                                normalized_status = str(status or "").strip().upper()
                                if normalized_status in ('S', 'L'):
                                    students_map[sid]["codes"].add(normalized_status)
                                elif normalized_status in ('C', 'R'):
                                    students_map[sid]["codes"].discard('S')
                                    students_map[sid]["codes"].discard('L')

                        # 4. Compile results
                        results = []
                        for sid, info in students_map.items():
                            all_codes = set(info["codes"])
                            status_code = None
                            status_label = None

                            if 'S' in all_codes:
                                status_code = 'S'
                                status_label = "Sick"
                            elif 'L' in all_codes:
                                status_code = 'L'
                                status_label = "Leave"
                            elif info.get("absent_count", 0) > 0 or 'A' in all_codes:
                                status_code = 'A'
                                absent_count = info.get("absent_count", 0)
                                status_label = f"Absent ({absent_count} {'period' if absent_count == 1 else 'periods'})" if absent_count else "Absent"

                            if not status_code:
                                continue
                                
                            # Apply filter
                            if status_filter != "ALL" and status_filter != status_code:
                                continue
                            
                            
                            results.append({
                                "id": sid,
                                "rollNo": info["roll"],
                                "name": info["name"],
                                "status": status_label,
                                "statusCode": status_code,
                                "codes": sorted(all_codes),
                                "absentCount": info.get("absent_count", 0)
                            })

                        def sort_key(row):
                            roll = str(row.get("rollNo") or "")
                            match = re.search(r"\d+", roll)
                            return (int(match.group()) if match else float("inf"), roll)

                        results.sort(key=sort_key)
                        result = {"success": True, "data": results}

                else:
                    result = {"success": False, "message": f"Unknown action: {action}"}

            except Exception as e:
                result = {"success": False, "message": f"Database Error: {str(e)}"}
            
            conn.close()
            print(json.dumps(result, ensure_ascii=False))

        # --- TELEGRAM BOT MODE (Legacy) ---
        else:
            sender = data.get("sender", "")
            username = data.get("username", "")
            chat_id = data.get("chat_id", "")
            text = data.get("message", "")
            notifications = []

            def send_whatsapp_message(chat_id_to_send, message_to_send):
                if chat_id_to_send and message_to_send:
                    notifications.append({"chat_id": str(chat_id_to_send), "message": str(message_to_send)})

            reply = handle_message(username, chat_id, text, send_whatsapp_message)
            result = {
                "reply": reply,
                "notifications": notifications
            }
            print(json.dumps(result, ensure_ascii=False))

    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "message": "Invalid JSON input"}, ensure_ascii=False))
    except Exception as e:
        import traceback
        # print(traceback.format_exc(), file=sys.stderr) # Log to stderr for node to catch
        print(json.dumps({"success": False, "message": str(e)}, ensure_ascii=False))

    sys.stdout.flush()
