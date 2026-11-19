"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
    getLibraryStats,
    searchLibraryBooks,
    getLibraryCategories,
    searchLibraryMembers,
    getLibraryMemberHistory,
    getLibraryTransactions,
} from "@/lib/api";

/**
 * LibraryPanel — read-only data display for islamic_library.db.
 *
 * The desktop library PC app does all issuing/returning and pushes every
 * event to POST /api/library/sync. This panel only displays that data and
 * polls regularly so desktop updates show up on the spot.
 *
 * Views: Search Books | Status | Student History
 */

const POLL_MS = 10000; // live refresh so desktop pushes appear immediately

const fmtTime = (s) => {
    if (!s) return "—";
    const str = String(s);
    return str.length > 16 ? str.slice(0, 16) : str;
};

const StatusPill = ({ status, overdue }) => {
    if (overdue) {
        return (
            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-red-50 text-red-600 border border-red-200">
                Overdue
            </span>
        );
    }
    if (status === "issued") {
        return (
            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-200">
                Issued
            </span>
        );
    }
    return (
        <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-200">
            Available
        </span>
    );
};

const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Highlights every case-insensitive occurrence of `query` inside `text`
 * so users can instantly spot their search term in the results.
 * Works for English and Arabic/Urdu alike.
 */
const Highlight = ({ text, query }) => {
    const str = text == null ? "" : String(text);
    const q = String(query || "").trim();
    if (!str || !q) return <>{str}</>;
    let parts;
    try {
        parts = str.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
    } catch {
        return <>{str}</>;
    }
    return (
        <>
            {parts.map((part, i) =>
                part && part.toLowerCase() === q.toLowerCase() ? (
                    <mark key={i} className="bg-yellow-200 text-inherit">{part}</mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
};

export default function LibraryPanel() {
    const [view, setView] = useState("status"); // status | books | history
    const [stats, setStats] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [lastSync, setLastSync] = useState(null);
    const [liveTick, setLiveTick] = useState(0);
    const [panelError, setPanelError] = useState("");

    // Books search
    const [bookQuery, setBookQuery] = useState("");
    const [bookStatus, setBookStatus] = useState("");
    const [bookCategory, setBookCategory] = useState("");
    const [categories, setCategories] = useState([]);
    const [books, setBooks] = useState([]);
    const [bookTotal, setBookTotal] = useState(0);
    const [bookPage, setBookPage] = useState(1);
    const [bookPages, setBookPages] = useState(1);
    const [booksLoading, setBooksLoading] = useState(false);
    const [expandedBookId, setExpandedBookId] = useState(null);
    const [appliedBookQuery, setAppliedBookQuery] = useState(""); // query that produced current results
    const bookSearchRef = useRef(null);

    // Member history
    const [memberQuery, setMemberQuery] = useState("");
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [appliedMemberQuery, setAppliedMemberQuery] = useState(""); // query that produced current results
    const [selectedMember, setSelectedMember] = useState(null); // {student_id, name, ...}
    const [history, setHistory] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const memberSearchRef = useRef(null);

    // ── Status dashboard + live feed ──
    // NOTE: apiRequest() auto-unwraps the .data field, so these resolve to the
    // inner payload directly (no .success flag on success).
    const fetchStatus = useCallback(async () => {
        try {
            const [statsData, txData] = await Promise.all([
                getLibraryStats(),
                getLibraryTransactions(25),
            ]);
            if (statsData && typeof statsData === 'object') {
                setStats(statsData);
                setLastSync(statsData.last_sync ?? null);
            }
            if (Array.isArray(txData)) setTransactions(txData);
            setPanelError("");
        } catch (err) {
            setPanelError(err.message || "Failed to load library data");
        }
    }, []);

    // ── Initial load + categories ──
    useEffect(() => {
        fetchStatus();
        getLibraryCategories()
            .then((r) => { if (Array.isArray(r)) setCategories(r); })
            .catch(() => { });
    }, [fetchStatus]);

    // ── Live polling: desktop pushes appear on the spot ──
    useEffect(() => {
        const id = setInterval(() => setLiveTick((t) => t + 1), POLL_MS);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (view === "status") fetchStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveTick]);

    // ── Book search (debounced) ──
    const fetchBooks = useCallback(async (q, status, category, page) => {
        setBooksLoading(true);
        try {
            const data = await searchLibraryBooks({ q, status, category, page, limit: 20 });
            if (data && typeof data === 'object') {
                setBooks(Array.isArray(data.books) ? data.books : []);
                setBookTotal(data.total || 0);
                setBookPages(data.pages || 1);
                setBookPage(data.page || 1);
                setAppliedBookQuery(q); // remember what was searched for highlighting
            }
        } catch (err) {
            setPanelError(err.message || "Book search failed");
        } finally {
            setBooksLoading(false);
        }
    }, []);

    useEffect(() => {
        if (view !== "books") return;
        const timer = setTimeout(() => {
            fetchBooks(bookQuery.trim(), bookStatus, bookCategory, 1);
        }, 350);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookQuery, bookStatus, bookCategory, view]);

    // Refresh book list on poll while the books view is open
    useEffect(() => {
        if (view === "books" && liveTick > 0) {
            fetchBooks(bookQuery.trim(), bookStatus, bookCategory, bookPage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveTick]);

    // ── Member search (debounced) ──
    useEffect(() => {
        if (view !== "history") return;
        const timer = setTimeout(() => {
            let cancelled = false;
            setMembersLoading(true);
            searchLibraryMembers(memberQuery.trim(), 30)
                .then((data) => {
                    if (!cancelled && Array.isArray(data)) {
                        setMembers(data);
                        setAppliedMemberQuery(memberQuery.trim());
                    }
                })
                .catch((err) => { if (!cancelled) setPanelError(err.message || "Member search failed"); })
                .finally(() => { if (!cancelled) setMembersLoading(false); });
            return () => { cancelled = true; };
        }, 300);
        return () => clearTimeout(timer);
    }, [memberQuery, view]);

    const openHistory = useCallback(async (member) => {
        setSelectedMember(member);
        setHistoryLoading(true);
        setHistory(null);
        try {
            const data = await getLibraryMemberHistory(member.student_id);
            if (data && typeof data === 'object') setHistory(data);
        } catch (err) {
            setPanelError(err.message || "Failed to load member history");
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    const statCards = stats ? [
        { label: "Titles", value: stats.titles, color: "text-[#0d9488]" },
        { label: "Total Copies", value: stats.total_copies, color: "text-blue-600" },
        { label: "Available", value: stats.available_copies, color: "text-emerald-600" },
        { label: "Issued Now", value: stats.issued_now, color: "text-amber-600" },
        { label: "Overdue", value: stats.overdue, color: "text-red-600" },
        { label: "Members", value: stats.members, color: "text-violet-600" },
        { label: "Issued Today", value: stats.issued_today, color: "text-teal-600" },
        { label: "Returned Today", value: stats.returned_today, color: "text-rose-600" },
    ] : [];

    const views = [
        { id: "status", label: "Status", emoji: "📊" },
        { id: "books", label: "Search Books", emoji: "🔍" },
        { id: "history", label: "Student History", emoji: "🎓" },
    ];

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="rounded-3xl p-6 text-white shadow-sm" style={{ background: "linear-gradient(135deg, #082231 0%, #0a505c 100%)" }}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-black">📚 Library</h3>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mt-1">
                            Search books, stock status &amp; student borrowing history
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Beta
                        </span>
                        <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-white/70">
                            Sync: {fmtTime(lastSync) || "never"}
                        </span>
                    </div>
                </div>
            </div>

            {panelError && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-bold">
                    ⚠️ {panelError}
                </div>
            )}

            {/* View switcher */}
            <div className="grid grid-cols-3 gap-2.5">
                {views.map((v) => (
                    <button
                        key={v.id}
                        onClick={() => setView(v.id)}
                        className={`rounded-2xl border p-3 text-center transition-all active:scale-[0.98] shadow-sm ${view === v.id
                            ? "border-[#0d9488] bg-[#0d9488]/10 text-[#0d9488]"
                            : "border-gray-100 bg-white text-gray-500 hover:shadow-md"
                            }`}
                    >
                        <span className="block text-lg">{v.emoji}</span>
                        <span className="mt-1 block text-[9.5px] font-black uppercase tracking-wider">{v.label}</span>
                    </button>
                ))}
            </div>

            {/* ══════════ STATUS ══════════ */}
            {view === "status" && (
                <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {statCards.map((s) => (
                            <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-4 text-center shadow-sm">
                                <p className={`text-xl font-black ${s.color}`}>{s.value ?? "—"}</p>
                                <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">{s.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Currently issued */}
                    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-black text-gray-900">📖 Currently Issued</h4>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-0.5">
                                    Books out of the library right now
                                </p>
                            </div>
                            <span className="text-xs font-black text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
                                {stats?.issued_now ?? 0}
                            </span>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {(stats?.issued_now_list || []).length === 0 && (
                                <p className="px-5 py-6 text-xs font-bold text-gray-400 text-center">No books currently issued 🎉</p>
                            )}
                            {(stats?.issued_now_list || []).map((row) => (
                                <div key={row.id} className="px-5 py-3 flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-gray-800 truncate">{row.title}</p>
                                        <p className="text-[10px] text-gray-400 font-medium truncate">
                                            {row.member_name} · ID {row.member_id} · {row.book_id}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-bold text-gray-500">{fmtTime(row.issue_date)}</p>
                                        {row.overdue ? (
                                            <span className="text-[9px] font-black uppercase text-red-500">Overdue</span>
                                        ) : (
                                            <span className="text-[9px] font-bold text-gray-400">
                                                Due: {row.due_date ? fmtTime(row.due_date) : "—"}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Live activity feed */}
                    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-50">
                            <h4 className="text-sm font-black text-gray-900">⏱️ Recent Activity</h4>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-0.5">
                                Latest issues &amp; returns pushed by the library computer
                            </p>
                        </div>
                        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                            {transactions.length === 0 && (
                                <p className="px-5 py-6 text-xs font-bold text-gray-400 text-center">No transactions yet</p>
                            )}
                            {transactions.map((t) => (
                                <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                                    <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm ${t.status === "returned" ? "bg-emerald-50" : "bg-amber-50"}`}>
                                        {t.status === "returned" ? "↩️" : "📤"}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-gray-800 truncate">
                                            {t.status === "returned" ? "Returned" : "Issued"} · {t.title}
                                        </p>
                                        <p className="text-[10px] text-gray-400 font-medium truncate">
                                            {t.member_name} · {t.book_id}
                                            {t.rating ? ` · ${"★".repeat(Math.min(5, t.rating))}` : ""}
                                        </p>
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-400 shrink-0">{fmtTime(t.activity_time)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════ SEARCH BOOKS ══════════ */}
            {view === "books" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm space-y-3">
                        <input
                            ref={bookSearchRef}
                            type="text"
                            value={bookQuery}
                            onChange={(e) => setBookQuery(e.target.value)}
                            placeholder="Search by title, author or book ID… (English / اردو)"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#0d9488] focus:bg-white transition-all"
                        />
                        <div className="flex flex-wrap gap-2">
                            {[{ id: "", label: "All" }, { id: "available", label: "Available" }, { id: "issued", label: "Issued" }, { id: "overdue", label: "Overdue" }].map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setBookStatus(s.id)}
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${bookStatus === s.id
                                        ? "bg-[#0d9488] text-white shadow-md shadow-teal-100"
                                        : "bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100"
                                        }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                            <select
                                value={bookCategory}
                                onChange={(e) => setBookCategory(e.target.value)}
                                className="ml-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-bold text-gray-600 focus:outline-none focus:border-[#0d9488]"
                            >
                                <option value="">All Categories</option>
                                {categories.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            {booksLoading ? "Searching…" : `${bookTotal} book${bookTotal === 1 ? "" : "s"} found`}
                        </p>
                    </div>

                    <div className="space-y-2.5">
                        {books.map((b) => {
                            const currentIssues = (stats?.issued_now_list || []).filter((issue) => String(issue.book_id) === String(b.id));
                            const isExpanded = expandedBookId === b.id;
                            return (
                            <div key={b.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button type="button" onClick={() => setExpandedBookId(isExpanded ? null : b.id)} aria-expanded={isExpanded} className="text-left text-sm font-black text-gray-900 truncate hover:text-[#0d9488] focus:outline-none focus:underline">
                                                <Highlight text={b.title} query={appliedBookQuery} />
                                            </button>
                                            <StatusPill status={b.status} overdue={b.overdue} />
                                        </div>
                                        <p className="text-[11px] text-gray-500 font-medium mt-0.5 truncate">
                                            <Highlight text={b.author || "Unknown author"} query={appliedBookQuery} />
                                            {" · "}
                                            <span className="font-bold"><Highlight text={b.id} query={appliedBookQuery} /></span>
                                        </p>
                                        <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                                            {b.category || "—"} · Shelf {b.shelf || "—"}/Row {b.book_row || "—"}/Area {b.area || "—"}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className={`text-lg font-black ${(b.available_copies || 0) > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                                            {b.available_copies ?? 0}
                                        </p>
                                        <p className="text-[9px] font-bold text-gray-400 uppercase">/ {b.total_copies} free</p>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                                        {b.status === "issued" || currentIssues.length > 0 ? (
                                            currentIssues.length > 0 ? currentIssues.map((issue) => (
                                                <div key={issue.id} className="rounded-xl bg-amber-50/70 px-3 py-2.5 text-[11px] text-gray-700 space-y-1">
                                                    <p><span className="font-bold">Student:</span> {issue.member_name || "Name not provided"}{issue.member_id ? ` · ID ${issue.member_id}` : ""}</p>
                                                    <p><span className="font-bold">Librarian:</span> {issue.librarian || "Not provided by the Library API"}</p>
                                                    <p className="text-gray-500">Issued {fmtTime(issue.issue_date)} · Due {issue.due_date ? fmtTime(issue.due_date) : "—"}</p>
                                                </div>
                                            )) : (
                                                <div className="rounded-xl bg-amber-50/70 px-3 py-2.5 text-[11px] text-gray-600">
                                                    Current borrower and librarian details are not included in the available Library API response.
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-[11px] text-gray-500">This book is not currently issued.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )})}
                        {!booksLoading && books.length === 0 && (
                            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                                <p className="text-xs font-bold text-gray-400">No books match your search 🔍</p>
                            </div>
                        )}
                    </div>

                    {bookPages > 1 && (
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => fetchBooks(bookQuery.trim(), bookStatus, bookCategory, Math.max(1, bookPage - 1))}
                                disabled={bookPage <= 1}
                                className="rounded-xl border border-gray-100 bg-white px-4 py-2 text-xs font-black text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-all"
                            >
                                ← Prev
                            </button>
                            <span className="text-[11px] font-black text-gray-500">Page {bookPage} / {bookPages}</span>
                            <button
                                onClick={() => fetchBooks(bookQuery.trim(), bookStatus, bookCategory, Math.min(bookPages, bookPage + 1))}
                                disabled={bookPage >= bookPages}
                                className="rounded-xl border border-gray-100 bg-white px-4 py-2 text-xs font-black text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-all"
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ══════════ STUDENT HISTORY ══════════ */}
            {view === "history" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm space-y-3">
                        <input
                            ref={memberSearchRef}
                            type="text"
                            value={memberQuery}
                            onChange={(e) => { setMemberQuery(e.target.value); setSelectedMember(null); setHistory(null); }}
                            placeholder="Search student by name, ID or batch…"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#0d9488] focus:bg-white transition-all"
                        />
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            {membersLoading ? "Searching…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
                        </p>
                    </div>

                    {!selectedMember && (
                        <div className="space-y-2">
                            {members.map((m) => (
                                <button
                                    key={m.student_id}
                                    onClick={() => openHistory(m)}
                                    className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 text-left hover:border-[#0d9488]/40 hover:shadow-md transition-all active:scale-[0.99]"
                                >
                                    <span className="shrink-0 w-9 h-9 rounded-full bg-[#0d9488]/10 text-[#0d9488] flex items-center justify-center text-xs font-black">
                                        {String(m.name || "?").charAt(0)}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-black text-gray-800 truncate">
                                            <Highlight text={m.name} query={appliedMemberQuery} />
                                        </p>
                                        <p className="text-[10px] text-gray-400 font-medium">
                                            ID <Highlight text={m.student_id} query={appliedMemberQuery} />
                                            {" · "}
                                            <Highlight text={m.batch || "—"} query={appliedMemberQuery} />
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className={`text-sm font-black ${m.books_in_hand > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                            {m.books_in_hand ?? "—"}
                                        </p>
                                        <p className="text-[9px] font-bold text-gray-400 uppercase">in hand</p>
                                    </div>
                                </button>
                            ))}
                            {!membersLoading && members.length === 0 && (
                                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                                    <p className="text-xs font-bold text-gray-400">No members found 🎓</p>
                                </div>
                            )}
                        </div>
                    )}

                    {selectedMember && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => { setSelectedMember(null); setHistory(null); }}
                                    className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all"
                                >
                                    ←
                                </button>
                                <div className="flex-1 rounded-xl border border-gray-100 bg-white px-4 py-2.5 flex items-center gap-3">
                                    <span className="shrink-0 w-9 h-9 rounded-full bg-[#0d9488] text-white flex items-center justify-center text-sm font-black">
                                        {String(selectedMember.name || "?").charAt(0)}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-gray-900 truncate">{selectedMember.name}</p>
                                        <p className="text-[10px] text-gray-400 font-bold">ID {selectedMember.student_id} · {selectedMember.batch || "—"}</p>
                                    </div>
                                </div>
                            </div>

                            {historyLoading && (
                                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                                    <p className="text-xs font-bold text-gray-400 animate-pulse">Loading history…</p>
                                </div>
                            )}

                            {history && (
                                <>
                                    <div className="grid grid-cols-4 gap-2.5">
                                        {[
                                            { label: "Borrowed", value: history.summary?.total_borrowed, color: "text-blue-600" },
                                            { label: "In Hand", value: history.summary?.in_hand, color: "text-amber-600" },
                                            { label: "Returned", value: history.summary?.returned, color: "text-emerald-600" },
                                            { label: "Overdue", value: history.summary?.overdue, color: "text-red-600" },
                                        ].map((s) => (
                                            <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-3 text-center shadow-sm">
                                                <p className={`text-lg font-black ${s.color}`}>{s.value ?? 0}</p>
                                                <p className="text-[8.5px] font-bold text-gray-400 uppercase">{s.label}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                                        <div className="px-5 py-4 border-b border-gray-50">
                                            <h4 className="text-sm font-black text-gray-900">📜 Full History</h4>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-0.5">
                                                Every book this member ever borrowed
                                            </p>
                                        </div>
                                        <div className="divide-y divide-gray-50">
                                            {(history.transactions || []).length === 0 && (
                                                <p className="px-5 py-6 text-xs font-bold text-gray-400 text-center">No borrowing history yet</p>
                                            )}
                                            {(history.transactions || []).map((t) => (
                                                <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                                                    <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm ${t.status === "returned" ? "bg-emerald-50" : "bg-amber-50"}`}>
                                                        {t.status === "returned" ? "↩️" : "📤"}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-gray-800 truncate">{t.title}</p>
                                                        <p className="text-[10px] text-gray-400 font-medium">
                                                            {t.book_id} · Issued {fmtTime(t.issue_date)}
                                                            {t.return_date ? ` · Returned ${fmtTime(t.return_date)}` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <StatusPill status={t.status} overdue={t.status === "issued" && t.due_date && String(t.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10)} />
                                                        {t.rating ? (
                                                            <p className="text-[10px] font-black text-amber-500 mt-0.5">
                                                                {"★".repeat(Math.min(5, t.rating))}{t.rating_label ? ` ${t.rating_label}` : ""}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
