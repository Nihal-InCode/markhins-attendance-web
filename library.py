#!/usr/bin/env python3
"""
library.py — Bridge between the Node.js web backend and islamic_library.db.

Speaks the same stdin/stdout JSON protocol as attendance.py:
  INPUT : {"action": "...", ...}
  OUTPUT: {"success": true/false, ...}

Actions:
  stats               -> dashboard counters + currently issued list + last sync
  search_books        -> paginated book search (title/author/id/category + status)
  categories          -> distinct book categories (filter dropdown)
  search_members      -> member search by name / student_id / batch
  member_history      -> full issue/return history for one member
  recent_transactions -> latest issue/return activity (live feed)
  sync                -> apply issue/return events pushed by the desktop app
"""

import json
import os
import sqlite3
import sys
from datetime import datetime

# ---------------------------------------------------------------- DB LOCATION


def resolve_db_path():
    configured = (os.environ.get("LIBRARY_DB_PATH") or "").strip()
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if configured:
        candidates.append(configured)
    candidates.append(os.path.join(here, "islamic_library.db"))
    candidates.append("/data/islamic_library.db")
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return configured or os.path.join(here, "islamic_library.db")


DB_PATH = resolve_db_path()

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    category TEXT,
    total_copies INTEGER DEFAULT 1,
    available_copies INTEGER DEFAULT 1,
    shelf TEXT,
    "row" TEXT,
    area TEXT,
    added_date TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS members (
    student_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    batch TEXT,
    join_date TEXT DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'student'
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT,
    member_id TEXT,
    issue_date TEXT,
    due_date TEXT,
    return_date TEXT,
    status TEXT DEFAULT 'issued',
    librarian TEXT,
    rating INTEGER,
    rating_label TEXT
);
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str():
    return datetime.now().strftime("%Y-%m-%d")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ------------------------------------------------------------------- READ ACTIONS


def handle_stats(c):
    totals = c.execute(
        """SELECT COUNT(*) AS titles,
                  COALESCE(SUM(total_copies), 0) AS total_copies,
                  COALESCE(SUM(available_copies), 0) AS available_copies
             FROM books"""
    ).fetchone()
    members = c.execute("SELECT COUNT(*) AS n FROM members").fetchone()["n"]
    today = today_str()

    issued_now = c.execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE status = 'issued'"
    ).fetchone()["n"]
    overdue = c.execute(
        """SELECT COUNT(*) AS n FROM transactions
             WHERE status = 'issued'
               AND due_date IS NOT NULL AND TRIM(due_date) != ''
               AND substr(due_date, 1, 10) < ?""",
        (today,),
    ).fetchone()["n"]
    issued_today = c.execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE substr(IFNULL(issue_date,''),1,10) = ?",
        (today,),
    ).fetchone()["n"]
    returned_today = c.execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE substr(IFNULL(return_date,''),1,10) = ?",
        (today,),
    ).fetchone()["n"]

    issued_list = rows_to_list(
        c.execute(
            """SELECT t.id, t.book_id, IFNULL(b.title, t.book_id) AS title,
                      t.member_id, IFNULL(m.name, t.member_id) AS member_name,
                      t.issue_date, t.due_date,
                      CASE WHEN t.due_date IS NOT NULL AND TRIM(t.due_date) != ''
                                AND substr(t.due_date,1,10) < ?
                           THEN 1 ELSE 0 END AS overdue
                 FROM transactions t
            LEFT JOIN books b ON b.id = t.book_id
            LEFT JOIN members m ON m.student_id = t.member_id
                WHERE t.status = 'issued'
             ORDER BY t.issue_date DESC, t.id DESC
                LIMIT 50""",
            (today,),
        ).fetchall()
    )

    last_sync = c.execute(
        "SELECT value FROM system_settings WHERE key = 'library_last_sync'"
    ).fetchone()

    return {
        "success": True,
        "data": {
            "titles": totals["titles"],
            "total_copies": totals["total_copies"],
            "available_copies": totals["available_copies"],
            "issued_now": issued_now,
            "overdue": overdue,
            "members": members,
            "issued_today": issued_today,
            "returned_today": returned_today,
            "issued_now_list": issued_list,
            "last_sync": last_sync["value"] if last_sync else None,
        },
    }


def handle_search_books(c, data):
    q = str(data.get("q") or "").strip()
    status = str(data.get("status") or "").strip().lower()
    category = str(data.get("category") or "").strip()
    try:
        page = max(1, int(data.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        limit = min(50, max(1, int(data.get("limit") or 20)))
    except (TypeError, ValueError):
        limit = 20
    today = today_str()

    where = []
    params = []
    if q:
        like = "%{}%".format(q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
        where.append("(b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\' OR b.id LIKE ? ESCAPE '\\')")
        params.extend([like, like, like])
    if category:
        where.append("b.category = ?")
        params.append(category)
    if status == "available":
        where.append("b.available_copies > 0")
    elif status == "issued":
        where.append("b.available_copies <= 0")
    elif status == "overdue":
        where.append(
            """EXISTS (SELECT 1 FROM transactions t
                        WHERE t.book_id = b.id AND t.status = 'issued'
                          AND t.due_date IS NOT NULL AND TRIM(t.due_date) != ''
                          AND substr(t.due_date,1,10) < ?)"""
        )
        params.append(today)

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    total = c.execute(
        "SELECT COUNT(*) AS n FROM books b" + where_sql, params
    ).fetchone()["n"]

    offset = (page - 1) * limit
    books = rows_to_list(
        c.execute(
            """SELECT b.id, b.title, b.author, b.category, b.total_copies,
                      b.available_copies, b.shelf, b."row" AS book_row, b.area, b.added_date
                 FROM books b"""
            + where_sql
            + " ORDER BY b.title COLLATE NOCASE LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    )

    # Attach current holders for the returned page of books
    holders = {}
    if books:
        ids = [b["id"] for b in books]
        ph = ",".join("?" * len(ids))
        holder_rows = c.execute(
            f"""SELECT t.book_id, t.member_id, m.name, t.due_date
                  FROM transactions t
             LEFT JOIN members m ON m.student_id = t.member_id
                 WHERE t.status = 'issued' AND t.book_id IN ({ph})""",
            ids,
        ).fetchall()
        for r in holder_rows:
            holders.setdefault(r["book_id"], []).append(
                {
                    "member_id": r["member_id"],
                    "name": r["name"] or r["member_id"],
                    "due_date": r["due_date"],
                }
            )

    for b in books:
        b["holders"] = holders.get(b["id"], [])
        b["status"] = "available" if (b["available_copies"] or 0) > 0 else "issued"
        b["overdue"] = any(
            h.get("due_date")
            and str(h["due_date"])[:10] < today
            for h in b["holders"]
        )

    return {
        "success": True,
        "data": {
            "books": books,
            "total": total,
            "page": page,
            "pages": max(1, (total + limit - 1) // limit),
        },
    }


def handle_categories(c):
    rows = c.execute(
        """SELECT DISTINCT category FROM books
             WHERE category IS NOT NULL AND TRIM(category) != ''
          ORDER BY category COLLATE NOCASE"""
    ).fetchall()
    return {"success": True, "data": [r["category"] for r in rows]}


def handle_search_members(c, data):
    q = str(data.get("q") or "").strip()
    try:
        limit = min(50, max(1, int(data.get("limit") or 30)))
    except (TypeError, ValueError):
        limit = 30

    if q:
        like = "%{}%".format(q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
        members = rows_to_list(
            c.execute(
                """SELECT m.student_id, m.name, m.batch, m.join_date, m.type,
                          (SELECT COUNT(*) FROM transactions t
                            WHERE t.member_id = m.student_id AND t.status = 'issued') AS books_in_hand,
                          (SELECT COUNT(*) FROM transactions t
                            WHERE t.member_id = m.student_id) AS total_borrowed
                     FROM members m
                    WHERE m.name LIKE ? ESCAPE '\\'
                       OR m.student_id LIKE ? ESCAPE '\\'
                       OR IFNULL(m.batch,'') LIKE ? ESCAPE '\\'
                 ORDER BY m.name COLLATE NOCASE
                    LIMIT ?""",
                (like, like, like, limit),
            ).fetchall()
        )
    else:
        members = rows_to_list(
            c.execute(
                """SELECT m.student_id, m.name, m.batch, m.join_date, m.type,
                          (SELECT COUNT(*) FROM transactions t
                            WHERE t.member_id = m.student_id AND t.status = 'issued') AS books_in_hand,
                          (SELECT COUNT(*) FROM transactions t
                            WHERE t.member_id = m.student_id) AS total_borrowed
                     FROM members m
                 ORDER BY m.name COLLATE NOCASE
                    LIMIT ?""",
                (limit,),
            ).fetchall()
        )

    return {"success": True, "data": members}


def handle_member_history(c, data):
    sid = str(data.get("student_id") or "").strip()
    if not sid:
        return {"success": False, "message": "student_id is required"}

    member = c.execute(
        "SELECT * FROM members WHERE student_id = ?", (sid,)
    ).fetchone()
    if not member:
        return {"success": False, "message": "Member not found"}

    today = today_str()
    txs = rows_to_list(
        c.execute(
            """SELECT t.id, t.book_id, IFNULL(b.title, t.book_id) AS title,
                      b.author, b.category, b.shelf, b."row" AS book_row, b.area,
                      t.issue_date, t.due_date, t.return_date, t.status,
                      t.librarian, t.rating, t.rating_label
                 FROM transactions t
            LEFT JOIN books b ON b.id = t.book_id
                WHERE t.member_id = ?
             ORDER BY t.issue_date DESC, t.id DESC""",
            (sid,),
        ).fetchall()
    )

    in_hand = 0
    returned = 0
    overdue = 0
    for t in txs:
        if t["status"] == "issued":
            in_hand += 1
            if t["due_date"] and str(t["due_date"])[:10] < today:
                overdue += 1
        elif t["status"] == "returned":
            returned += 1

    return {
        "success": True,
        "data": {
            "member": dict(member),
            "summary": {
                "total_borrowed": len(txs),
                "in_hand": in_hand,
                "returned": returned,
                "overdue": overdue,
            },
            "transactions": txs,
        },
    }


def handle_recent_transactions(c, data):
    try:
        limit = min(100, max(1, int(data.get("limit") or 25)))
    except (TypeError, ValueError):
        limit = 25

    rows = rows_to_list(
        c.execute(
            """SELECT t.id, t.book_id, IFNULL(b.title, t.book_id) AS title,
                      t.member_id, IFNULL(m.name, t.member_id) AS member_name,
                      t.issue_date, t.due_date, t.return_date, t.status,
                      t.librarian, t.rating, t.rating_label,
                      CASE WHEN t.return_date IS NOT NULL AND TRIM(t.return_date) != ''
                           THEN t.return_date ELSE IFNULL(t.issue_date,'') END AS activity_time
                 FROM transactions t
            LEFT JOIN books b ON b.id = t.book_id
            LEFT JOIN members m ON m.student_id = t.member_id
             ORDER BY activity_time DESC, t.id DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()
    )
    return {"success": True, "data": rows}


# ------------------------------------------------------------------ SYNC (DESKTOP)


def upsert_book(c, book):
    if not isinstance(book, dict) or not book.get("id"):
        return False
    cols = [
        "id", "title", "author", "category", "total_copies",
        "available_copies", "shelf", "row", "area", "added_date",
    ]
    present = [k for k in cols if book.get(k) is not None]
    if "id" not in present:
        return False
    if "title" not in present:
        present.append("title")  # NOT NULL on fresh insert
        book = dict(book)
        book["title"] = str(book.get("id"))

    col_sql = ", ".join('"{}"'.format(k) if k == "row" else k for k in present)
    ph = ", ".join("?" * len(present))
    sql = "INSERT INTO books ({}) VALUES ({})".format(col_sql, ph)
    updates = [k for k in present if k != "id"]
    if updates:
        set_sql = ", ".join(
            '"{0}" = excluded."{0}"'.format(k) if k == "row" else "{0} = excluded.{0}".format(k)
            for k in updates
        )
        sql += " ON CONFLICT(id) DO UPDATE SET " + set_sql
    else:
        sql += " ON CONFLICT(id) DO NOTHING"
    c.execute(sql, [book[k] for k in present])
    return True


def upsert_member(c, member):
    if not isinstance(member, dict) or not member.get("student_id"):
        return False
    cols = ["student_id", "name", "batch", "join_date", "type"]
    present = [k for k in cols if member.get(k) is not None]
    if "student_id" not in present:
        return False
    if "name" not in present:
        present.append("name")
        member = dict(member)
        member["name"] = str(member.get("student_id"))

    col_sql = ", ".join(present)
    ph = ", ".join("?" * len(present))
    sql = "INSERT INTO members ({}) VALUES ({})".format(col_sql, ph)
    updates = [k for k in present if k != "student_id"]
    if updates:
        sql += " ON CONFLICT(student_id) DO UPDATE SET " + ", ".join(
            "{0} = excluded.{0}".format(k) for k in updates
        )
    else:
        sql += " ON CONFLICT(student_id) DO NOTHING"
    c.execute(sql, [member[k] for k in present])
    return True


def upsert_transaction(c, tx):
    """Insert or update a transaction. Requires tx['id'] for updates."""
    if not isinstance(tx, dict):
        return False
    cols = [
        "id", "book_id", "member_id", "issue_date", "due_date",
        "return_date", "status", "librarian", "rating", "rating_label",
    ]
    present = [k for k in cols if tx.get(k) is not None]
    if "book_id" not in present or "member_id" not in present:
        return False

    col_sql = ", ".join(present)
    ph = ", ".join("?" * len(present))
    sql = "INSERT INTO transactions ({}) VALUES ({})".format(col_sql, ph)
    updates = [k for k in present if k != "id"]
    if "id" in present and updates:
        sql += " ON CONFLICT(id) DO UPDATE SET " + ", ".join(
            "{0} = excluded.{0}".format(k) for k in updates
        )
    c.execute(sql, [tx[k] for k in present])
    return True


def bump_available(c, book_id, delta):
    """delta = -1 on issue, +1 on return. Clamped to [0, total_copies]."""
    c.execute(
        """UPDATE books SET available_copies = MAX(0, MIN(IFNULL(total_copies,1),
                  available_copies + ?)) WHERE id = ?""",
        (delta, book_id),
    )


def apply_issue(c, ev):
    member = ev.get("member") or None
    book = ev.get("book") or None
    tx = dict(ev.get("transaction") or {})

    if member:
        upsert_member(c, member)

    has_copies = isinstance(book, dict) and book.get("available_copies") is not None
    if book:
        upsert_book(c, book)

    book_id = (book or {}).get("id") or tx.get("book_id")
    member_id = (member or {}).get("student_id") or tx.get("member_id")
    if not book_id or not member_id:
        return False

    # Idempotency: if this transaction id already exists, it was already applied.
    # Without an id, dedupe on the natural key (book + member + issue_date).
    already_applied = False
    if tx.get("id") is not None:
        row = c.execute(
            "SELECT 1 FROM transactions WHERE id = ?", (tx["id"],)
        ).fetchone()
        already_applied = row is not None
    elif tx.get("issue_date"):
        row = c.execute(
            """SELECT 1 FROM transactions
                 WHERE book_id = ? AND member_id = ? AND issue_date = ?
                 LIMIT 1""",
            (book_id, member_id, tx["issue_date"]),
        ).fetchone()
        already_applied = row is not None

    if already_applied:
        # Replay: refresh fields if we have a real id, otherwise do nothing.
        if tx.get("id") is not None:
            return upsert_transaction(c, tx)
        return False

    if not has_copies:
        # Desktop did not send the recomputed availability — adjust ourselves.
        bump_available(c, book_id, -1)

    tx.setdefault("book_id", book_id)
    tx.setdefault("member_id", member_id)
    tx.setdefault("issue_date", now_str())
    tx.setdefault("status", "issued")
    return upsert_transaction(c, tx)


def apply_return(c, ev):
    member = ev.get("member") or None
    book = ev.get("book") or None
    tx = dict(ev.get("transaction") or {})

    if member:
        upsert_member(c, member)

    has_copies = isinstance(book, dict) and book.get("available_copies") is not None
    if book:
        upsert_book(c, book)

    tx_id = tx.get("id")
    if not tx_id and tx.get("book_id") and tx.get("member_id"):
        row = c.execute(
            """SELECT id FROM transactions
                 WHERE book_id = ? AND member_id = ? AND status = 'issued'
              ORDER BY id DESC LIMIT 1""",
            (tx["book_id"], tx["member_id"]),
        ).fetchone()
        if row:
            tx_id = row["id"]

    # Resolve which book to restock: prefer explicit ids, else ask the DB.
    book_id = (book or {}).get("id") or tx.get("book_id")
    if tx_id and not book_id:
        row = c.execute("SELECT book_id FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        if row:
            book_id = row["book_id"]

    transitioned = False
    if tx_id:
        sets = ["status = 'returned'", "return_date = ?"]
        params = [tx.get("return_date") or now_str()]
        if tx.get("rating") is not None:
            sets.append("rating = ?")
            params.append(tx["rating"])
        if tx.get("rating_label") is not None:
            sets.append("rating_label = ?")
            params.append(tx["rating_label"])
        params.append(tx_id)
        cur = c.execute(
            "UPDATE transactions SET {} WHERE id = ? AND status != 'returned'".format(
                ", ".join(sets)
            ),
            params,
        )
        transitioned = cur.rowcount > 0
    elif tx.get("book_id") and tx.get("member_id"):
        # Nothing outstanding for this pair. If a return already exists, this
        # event is a replay — don't insert a duplicate row or restock twice.
        already = c.execute(
            """SELECT 1 FROM transactions
                 WHERE book_id = ? AND member_id = ? AND status = 'returned'
                 LIMIT 1""",
            (tx["book_id"], tx["member_id"]),
        ).fetchone()
        if already:
            transitioned = False
        else:
            tx.setdefault("status", "returned")
            tx.setdefault("return_date", now_str())
            transitioned = upsert_transaction(c, tx)

    if transitioned and not has_copies and book_id:
        bump_available(c, book_id, +1)
    return transitioned


def stamp_last_sync(c):
    ts = now_str()
    c.execute(
        """INSERT INTO system_settings (key, value) VALUES ('library_last_sync', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
        (ts,),
    )
    return ts


def handle_sync(c, data):
    applied = {"books": 0, "members": 0, "transactions": 0, "issues": 0, "returns": 0}

    snapshot = data.get("snapshot") or {}
    if isinstance(snapshot, dict):
        for b in snapshot.get("books") or []:
            if upsert_book(c, b):
                applied["books"] += 1
        for m in snapshot.get("members") or []:
            if upsert_member(c, m):
                applied["members"] += 1
        for t in snapshot.get("transactions") or []:
            if upsert_transaction(c, t):
                applied["transactions"] += 1

    for ev in data.get("events") or []:
        etype = str(ev.get("type") or "").lower()
        if etype == "issue":
            if apply_issue(c, ev):
                applied["issues"] += 1
        elif etype == "return":
            if apply_return(c, ev):
                applied["returns"] += 1
        else:
            return {"success": False, "message": "Unknown event type: {}".format(etype)}

    ts = stamp_last_sync(c)
    return {"success": True, "applied": applied, "last_sync": ts}


# ------------------------------------------------------------------------ BRIDGE


if __name__ == "__main__":
    try:
        raw = sys.stdin.read()
        if not raw:
            sys.exit(0)
        data = json.loads(raw)
        action = data.get("action")

        conn = connect()
        c = conn.cursor()
        try:
            if action == "stats":
                result = handle_stats(c)
            elif action == "search_books":
                result = handle_search_books(c, data)
            elif action == "categories":
                result = handle_categories(c)
            elif action == "search_members":
                result = handle_search_members(c, data)
            elif action == "member_history":
                result = handle_member_history(c, data)
            elif action == "recent_transactions":
                result = handle_recent_transactions(c, data)
            elif action == "sync":
                result = handle_sync(c, data)
                conn.commit()
            else:
                result = {"success": False, "message": "Unknown action: {}".format(action)}
        except Exception as e:
            conn.rollback()
            result = {"success": False, "message": "Library Error: {}".format(str(e))}

        conn.close()
        print(json.dumps(result, ensure_ascii=False))

    except json.JSONDecodeError:
        print(json.dumps({"success": False, "message": "Invalid JSON input"}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "message": str(e)}, ensure_ascii=False))

    sys.stdout.flush()
