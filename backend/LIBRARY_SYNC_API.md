# Library Sync API (Desktop App → Web App)

The **desktop library PC app** does all book issuing/returning. The web app is a
**read-only display** (search, status, student history). After every issue or
return, the desktop app must POST the event here so the web app updates **on the
spot**.

Database: **`islamic_library.db`** — completely separate from `attendance.db`.
All reads/writes go through `library.py` (same stdin/stdout JSON bridge pattern
as `attendance.py`).

---

## Endpoint

```
POST /api/library/sync
Header: x-library-api-key: <LIBRARY_API_KEY>
Content-Type: application/json
```

The key lives in `backend/.env` as `LIBRARY_API_KEY` (same value must be
configured on the desktop app). If unset on the server, the endpoint returns
`503`.

### Response

```json
{
  "success": true,
  "applied": { "books": 0, "members": 0, "transactions": 0, "issues": 1, "returns": 0 },
  "last_sync": "2026-11-19 11:27:13"
}
```

Errors: `401` bad key · `400` bad payload / unknown event type · `503` key not
configured.

---

## Payload

```jsonc
{
  "events": [ /* issue/return events, see below */ ],
  "snapshot": {           // optional, full-state upsert (e.g. on app start)
    "books":      [ { "id": "AA001", "title": "...", "author": "...",
                      "category": "...", "total_copies": 1,
                      "available_copies": 1, "shelf": "19", "row": "3",
                      "area": "NW", "added_date": "..." } ],
    "members":    [ { "student_id": "1210", "name": "...", "batch": "BS3",
                      "join_date": "...", "type": "student" } ],
    "transactions": [ { "id": 9, "book_id": "AA001", "member_id": "1210",
                        "issue_date": "...", "due_date": "...",
                        "return_date": null, "status": "issued",
                        "librarian": "...", "rating": null,
                        "rating_label": null } ]
  }
}
```

Both parts are optional, but at least one must be present.

### Event: issue

```jsonc
{
  "type": "issue",
  "book":      { "id": "AA001", "title": "...", "total_copies": 1 },
  "member":    { "student_id": "1210", "name": "...", "batch": "BS3" },
  "transaction": {
    "id": 9,                    // optional but RECOMMENDED (enables replay-safe dedupe)
    "book_id": "AA001",
    "member_id": "1210",
    "issue_date": "2026-11-19 12:00:00",
    "due_date": "2026-12-03",
    "librarian": "ansah"
  }
}
```

- `book.available_copies` may be omitted — the server decrements it itself
  (clamped to `[0, total_copies]`). If you send it, the server trusts your value.
- `member` and `book` are upserted if provided (used to push new books/members).

### Event: return

```jsonc
{
  "type": "return",
  "book":      { "id": "AA001" },           // optional if transaction.book_id present
  "transaction": {
    "id": 9,                                // preferred — server marks THIS row returned
    "book_id": "AA001",                     // fallback if no id
    "member_id": "1210",
    "return_date": "2026-11-19 12:30:00",
    "rating": 5,                            // optional 1-5
    "rating_label": "Legendary"             // optional
  }
}
```

- Server flips the transaction to `status='returned'`, sets `return_date` /
  `rating`, and restores `available_copies` (+1) **only on the status
  transition** — if `id` is omitted, the server finds the open transaction by
  `book_id + member_id`.

### Idempotency / replays

Safe to retry any payload:

| Case | Dedupe key |
|---|---|
| issue with `transaction.id` | existing row with that id |
| issue without id | `book_id + member_id + issue_date` |
| return with `transaction.id` | row already `returned` → no-op |
| return without id | no open transaction + a `returned` row already exists → no-op |

Replays never double-move stock and never insert duplicate rows.

---

## Read endpoints (web app display, JWT — any user incl. guests)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/library/stats` | counters + currently-issued list + `last_sync` |
| GET | `/api/library/books?q=&status=&category=&page=&limit=` | search (title/author/id), `status` = `available\|issued\|overdue` |
| GET | `/api/library/categories` | distinct categories for the filter |
| GET | `/api/library/members?q=&limit=` | member search |
| GET | `/api/library/members/:studentId/history` | full borrowing history |
| GET | `/api/library/transactions?limit=` | latest issue/return activity |

Arabic/Urdu search works (UTF-8 throughout).

---

## Configuration

`backend/.env`:

```ini
LIBRARY_API_KEY=mk_lib_...        # shared secret with the desktop app
# optional overrides:
# LIBRARY_DB_PATH=/path/to/islamic_library.db
# (defaults to ./islamic_library.db next to library.py, then /data/islamic_library.db)
```

## Desktop app quick start (pseudocode)

```python
import requests

URL = "https://<web-app-host>/api/library/sync"
HEADERS = {"x-library-api-key": "mk_lib_..."}

def push_issue(book, member, transaction):
    requests.post(URL, headers=HEADERS, json={
        "events": [{"type": "issue", "book": book,
                    "member": member, "transaction": transaction}]
    }, timeout=10)

def push_return(transaction, book_id=None, rating=None, rating_label=None):
    tx = dict(transaction, return_date=now())
    if rating is not None: tx["rating"] = rating
    if rating_label is not None: tx["rating_label"] = rating_label
    requests.post(URL, headers=HEADERS, json={
        "events": [{"type": "return",
                    "book": {"id": book_id} if book_id else None,
                    "transaction": tx}]
    }, timeout=10)
```

Fire the POST immediately after committing the transaction locally; the web
panel polls every 10 s, so changes appear within seconds. Failed POSTs can be
retried safely (idempotent).
