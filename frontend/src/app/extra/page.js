"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getClasses, getStudents, getSubjectsByClass, getExtraClassesReport, markExtraAttendance, trackEvent } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { useAuth } from "@/context/AuthContext";

const getIstToday = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const pick = (t) => parts.find((p) => p.type === t)?.value;
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

const newSessionId = () => {
    try {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) { /* ignore */ }
    return `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const STATUS_CYCLE = ["present", "absent"];
const statusConfig = {
    present: { label: "Present", color: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    absent: { label: "Absent", color: "bg-red-500", text: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
    sick: { label: "Sick", color: "bg-orange-500", text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
    leave: { label: "On Leave", color: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
};

export default function ExtraAttendancePage() {
    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    useEffect(() => {
        const isBlocked =
            user &&
            (user.role === "admin" || user.role === "Majlis" ||
                user.is_teacher === 0 || user.is_teacher === false);
        if (isBlocked) router.replace("/?tab=reports");
    }, [user, router]);

    const [step, setStep] = useState("setup");
    const [classes, setClasses] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [selectedClass, setSelectedClass] = useState("");
    const [selectedSubject, setSelectedSubject] = useState("");
    const [customSubject, setCustomSubject] = useState("");
    const [date, setDate] = useState(getIstToday());
    const [loadingSetup, setLoadingSetup] = useState(true);
    const [setupError, setSetupError] = useState("");
    const [students, setStudents] = useState([]);
    const [attendance, setAttendance] = useState({});
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [summary, setSummary] = useState(null);

    // One uuid per marking session. Re-submitting the same session updates its
    // own row; a fresh session always creates a new one, so taking two extra
    // classes for the same class on the same day keeps both records.
    const [sessionId, setSessionId] = useState(null);
    const [editId, setEditId] = useState(null);
    const [editingSubject, setEditingSubject] = useState("");
    const [existing, setExisting] = useState([]);
    const [existingLoading, setExistingLoading] = useState(false);

    useEffect(() => {
        async function load() {
            trackEvent("Opened extra class page");
            showLoader("Loading...");
            try {
                const clsData = await getClasses();
                setClasses(Array.isArray(clsData) ? clsData : []);

                // Edit hand-off from Management > Extra Classes report.
                let req = null;
                try {
                    const raw = sessionStorage.getItem("extra_edit_request");
                    if (raw) {
                        sessionStorage.removeItem("extra_edit_request");
                        req = JSON.parse(raw);
                    }
                } catch (_) { req = null; }

                if (req && req.id && req.date) {
                    const rows = await getExtraClassesReport({ date: req.date });
                    const rec = (Array.isArray(rows) ? rows : [])
                        .find((r) => String(r.id) === String(req.id));
                    if (rec) {
                        await startEditSession(rec);
                        return;
                    }
                }
            } catch (err) { setSetupError(err.message); }
            finally { setLoadingSetup(false); hideLoader(); }
        }
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedClass) { setSubjects([]); setSelectedSubject(""); return; }
        async function loadSubjects() {
            try {
                const subData = await getSubjectsByClass(selectedClass);
                setSubjects(Array.isArray(subData) ? subData : []);
                setSelectedSubject("");
                setCustomSubject("");
            } catch (err) { setSubjects([]); }
        }
        loadSubjects();
    }, [selectedClass]);

    // Records already saved for this class + date, so the teacher can edit them
    // or simply start another session.
    useEffect(() => {
        if (!selectedClass || !date || step !== "setup") return;
        let cancelled = false;
        setExistingLoading(true);
        (async () => {
            try {
                const rows = await getExtraClassesReport({ date, classId: selectedClass });
                if (!cancelled) setExisting(Array.isArray(rows) ? rows : []);
            } catch (_) {
                if (!cancelled) setExisting([]);
            } finally {
                if (!cancelled) setExistingLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedClass, date, step]);

    // While editing an existing record its own subject wins - the subject
    // dropdown effect clears customSubject/selectedSubject whenever the class
    // changes, so relying on those would race during the edit hand-off.
    const effectiveSubject = editId
        ? (editingSubject || customSubject.trim() || selectedSubject)
        : (customSubject.trim() !== "" ? customSubject.trim() : selectedSubject);

    const fetchRoster = async (classId, dateStr) => {
        const data = await getStudents(classId || selectedClass, "", dateStr || date);
        return Array.isArray(data) ? data : [];
    };

    // Sick / Leave are auto-absent and locked, exactly like regular attendance.
    const buildInitial = (list, absentRolls) => {
        const initial = {};
        const byRoll = {};
        list.forEach((s) => {
            const roll = String(s.rollNo ?? s.roll_no ?? "").trim();
            byRoll[roll] = s;
            initial[s.id] = s.healthStatus === "S" || s.healthStatus === "L" ? "absent" : "present";
        });
        (absentRolls || []).forEach((roll) => {
            const s = byRoll[String(roll).trim()];
            if (!s) return;
            if (s.healthStatus === "S" || s.healthStatus === "L") return;
            initial[s.id] = "absent";
        });
        return initial;
    };

    const startNewSession = async () => {
        if (!selectedClass) return setSetupError("Select a class.");
        if (!effectiveSubject) return setSetupError("Select or type a subject.");
        if (!date) return setSetupError("Select a date.");
        setSetupError("");
        setLoadingStudents(true);
        showLoader("Loading students...");
        try {
            const list = await fetchRoster(selectedClass, date);
            setStudents(list);
            setAttendance(buildInitial(list, null));
            setSessionId(newSessionId());
            setEditId(null);
            setEditingSubject("");
            setStep("marking");
        } catch (err) { setSetupError(err.message); }
        finally { setLoadingStudents(false); hideLoader(); }
    };

    const startEditSession = async (record, classId, dateStr) => {
        if (!record) return;
        const cls = record.class || classId || selectedClass;
        const day = record.date || dateStr || date;
        setSetupError("");
        setLoadingStudents(true);
        showLoader("Loading students...");
        try {
            // Resolve the roster from the record's own class/date - the matching
            // state may not be committed yet when this is called on mount.
            const list = await fetchRoster(cls, day);
            setStudents(list);
            setAttendance(buildInitial(list, record.absentRolls || []));
            setSelectedClass(cls);
            setDate(day);
            setEditingSubject(record.subject || "");
            setSelectedSubject("");
            setCustomSubject("");
            setSessionId(null);
            setEditId(record.id);
            setStep("marking");
        } catch (err) { setSetupError(err.message); }
        finally { setLoadingStudents(false); hideLoader(); }
    };

    const toggleStatus = (id) => {
        const student = students.find((s) => s.id === id);
        if (student?.healthStatus === "S" || student?.healthStatus === "L") return;
        setAttendance((prev) => {
            const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(prev[id]) + 1) % STATUS_CYCLE.length];
            return { ...prev, [id]: next };
        });
    };

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        showLoader(editId ? "Updating..." : "Submitting...");
        setSubmitError("");
        try {
            const records = students.map((s) => ({
                studentId: s.id,
                rollNo: s.rollNo || s.roll_no,
                status: attendance[s.id] || "present",
            }));
            const payload = { classId: selectedClass, subject: effectiveSubject, period: "Extra", date, records };
            if (editId) payload.editId = editId;
            else payload.sessionId = sessionId || newSessionId();

            const result = await markExtraAttendance(payload);
            const data = result && result.success !== undefined && result.data ? result.data : result;
            if (result && result.success === false) throw new Error(result.message || "Failed");
            trackEvent(editId ? "Edited extra class" : "Marked extra class", `${selectedClass} ${effectiveSubject}`);
            setSummary(data || {});
            setStep("success");
        } catch (err) { setSubmitError(err.message); }
        finally { setSubmitting(false); hideLoader(); }
    };

    const resetAll = () => {
        setStep("setup");
        setSummary(null);
        setStudents([]);
        setAttendance({});
        setSelectedClass("");
        setSelectedSubject("");
        setCustomSubject("");
        setDate(getIstToday());
        setSessionId(null);
        setEditId(null);
        setEditingSubject("");
        setExisting([]);
        setSubmitError("");
        setSetupError("");
    };

    const counts = { present: 0, absent: 0, sick: 0, leave: 0 };
    students.forEach((s) => {
        if (s.healthStatus === "S") counts.sick++;
        else if (s.healthStatus === "L") counts.leave++;
        else if (attendance[s.id] === "absent") counts.absent++;
        else counts.present++;
    });
    const totalAbsent = counts.absent + counts.sick + counts.leave;

    return (
        <div className="min-h-screen font-sans" style={{ backgroundColor: "rgba(55, 151, 169, 0.04)" }}>

            {/* Header */}
            <div className="rounded-b-3xl px-4 pt-6 pb-10 sm:px-6" style={{ background: "linear-gradient(135deg, #082231 0%, #0a505c 100%)" }}>
                <div className="mx-auto max-w-md">
                    <div className="flex items-center justify-between mb-5">
                        <button onClick={() => {
                                if (step === "marking") {
                                    // Leaving marking cancels an in-progress edit.
                                    setStep("setup");
                                    setEditId(null);
                                    setEditingSubject("");
                                    setSessionId(newSessionId());
                                    setSubmitError("");
                                } else {
                                    router.push("/");
                                }
                            }}
                            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 transition-all">← Back</button>
                        <span className="rounded-full bg-amber-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300 animate-pulse">⚡ Extra</span>
                    </div>
                    <div className="text-center">
                        <h1 className="text-xl font-black text-white animate-fade-in">
                            {step === "setup" ? "New Extra Class" : step === "marking" ? `${selectedClass} • ${effectiveSubject}` : "Done!"}
                        </h1>
                        {step === "setup" && (
                            <p className="mt-2 text-xs text-white/50 font-medium animate-fade-in">Outside regular timetable — select class & subject manually</p>
                        )}
                        {step === "marking" && editId && (
                            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-amber-300 animate-fade-in">✏️ Editing saved record</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Setup Step */}
            {step === "setup" && (
                <main className="mx-auto max-w-md px-4 py-6 space-y-5">
                    <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm space-y-5 animate-fade-in">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Class</label>
                            <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20 transition-all">
                                <option value="">Select class</option>
                                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        {selectedClass && (
                            <div className="animate-fade-in">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Subject</label>
                                {subjects.length > 0 ? (
                                    <select value={selectedSubject} onChange={(e) => { setSelectedSubject(e.target.value); setCustomSubject(""); }}
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20 transition-all">
                                        <option value="">Select subject</option>
                                        {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                ) : (
                                    <p className="text-xs text-gray-400 mb-2">No subjects in timetable for this class</p>
                                )}
                                <input type="text" placeholder="Or type custom subject"
                                    className="mt-2 w-full rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20 transition-all"
                                    value={customSubject} onChange={(e) => { setCustomSubject(e.target.value); if (e.target.value) setSelectedSubject(""); }} />
                            </div>
                        )}
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Date</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20 transition-all" />
                        </div>

                        {/* Already-recorded chips for this class + date.
                            Everyone's extra classes are listed, but only the ones this
                            teacher marked can be edited. */}
                        {selectedClass && existing.length > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-2 animate-fade-in">
                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                                    {existing.length} extra class{existing.length > 1 ? "es" : ""} already saved on {date}
                                </p>
                                <p className="text-[11px] font-medium text-amber-700/70">
                                    Each session is stored separately — edit one of yours, or start a new one below.
                                </p>
                                {existing.map((r) => {
                                    const mine = String(r.teacherId) === String(user?.id);
                                    return (
                                        <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-black text-gray-800">{r.subject || "Extra"}</p>
                                                <p className="truncate text-[10px] font-bold text-gray-400">
                                                    {r.time} • {r.presentCount}/{r.totalStudents} present
                                                    {r.sickCount ? ` • ${r.sickCount} sick` : ""}
                                                    {r.leaveCount ? ` • ${r.leaveCount} leave` : ""}
                                                </p>
                                                {!mine && r.teacherName && (
                                                    <p className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400">by {r.teacherName}</p>
                                                )}
                                            </div>
                                            {mine ? (
                                                <button onClick={() => startEditSession(r)}
                                                    className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-[10px] font-black uppercase text-amber-950 transition-all active:scale-95">
                                                    Edit
                                                </button>
                                            ) : (
                                                <span className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-black uppercase text-gray-400">
                                                    Others
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {selectedClass && existingLoading && (
                            <p className="text-[11px] font-bold text-gray-400">Checking saved records…</p>
                        )}

                        {setupError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 animate-fade-in">{setupError}</div>}
                        <button onClick={startNewSession} disabled={loadingStudents || !effectiveSubject || !selectedClass}
                            className="w-full rounded-2xl bg-[#0d9488] py-4 text-sm font-bold text-white hover:bg-[#0a7a70] disabled:opacity-50 transition-all shadow-lg shadow-[#0d9488]/20 active:scale-[0.98]">
                            {loadingStudents ? "Loading..." : "Start Marking"}
                        </button>
                    </div>
                </main>
            )}

            {/* Marking Step */}
            {step === "marking" && (
                <main className="mx-auto max-w-md px-4 py-5 space-y-4 animate-fade-in">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center transition-all hover:scale-[1.02]">
                            <p className="text-2xl font-black text-emerald-600">{counts.present}</p>
                            <p className="text-[9px] font-bold text-emerald-500 uppercase">Present</p>
                        </div>
                        <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-center transition-all hover:scale-[1.02]">
                            <p className="text-2xl font-black text-red-500">{totalAbsent}</p>
                            <p className="text-[9px] font-bold text-red-400 uppercase">Absent</p>
                        </div>
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-center transition-all hover:scale-[1.02]">
                            <p className="text-2xl font-black text-gray-600">{students.length}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase">Total</p>
                        </div>
                    </div>

                    {(counts.sick > 0 || counts.leave > 0) && (
                        <div className="flex flex-wrap gap-2 animate-fade-in">
                            {counts.sick > 0 && (
                                <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-orange-600">🤒 {counts.sick} Sick</span>
                            )}
                            {counts.leave > 0 && (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-600">🏠 {counts.leave} On Leave</span>
                            )}
                            <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500">Locked</span>
                        </div>
                    )}

                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 animate-fade-in">
                        <span className="text-amber-500">⚡</span>
                        <p className="text-xs font-bold text-amber-700">{effectiveSubject} • {date}</p>
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
                        {students.map((student, idx) => {
                            const isHealth = student.healthStatus === "S" || student.healthStatus === "L";
                            const st = isHealth ? (student.healthStatus === "S" ? "sick" : "leave") : (attendance[student.id] || "present");
                            const cfg = statusConfig[st] || statusConfig.present;
                            return (
                                <div key={student.id}
                                    className={`p-4 flex items-center justify-between transition-all hover:bg-gray-50/50 ${st === "absent" ? "bg-red-50/30" : isHealth ? "bg-gray-50/30" : ""}`}
                                    style={{ animationDelay: `${idx * 30}ms` }}>
                                    <div className="flex items-center gap-3">
                                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-black transition-all ${cfg.bg} ${cfg.text}`}>
                                            {student.rollNo || student.roll_no}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-gray-800">{student.name}</p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <div className={`h-1.5 w-1.5 rounded-full ${cfg.color} ${isHealth ? "animate-pulse" : ""}`} />
                                                <p className={`text-[9px] font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</p>
                                            </div>
                                        </div>
                                    </div>
                                    {isHealth ? (
                                        <div className={`rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                                            🔒 Locked
                                        </div>
                                    ) : (
                                        <button onClick={() => toggleStatus(student.id)}
                                            className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase border transition-all active:scale-95 ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                                            {cfg.label}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{submitError}</div>}

                    <button onClick={handleSubmit} disabled={submitting}
                        className={`w-full rounded-2xl py-4 text-sm font-bold transition-all shadow-lg active:scale-[0.98] ${submitting ? "bg-gray-200 text-gray-400 shadow-none" : "bg-[#0d9488] text-white hover:bg-[#0a7a70] shadow-[#0d9488]/20"}`}>
                        {submitting ? "Saving..." : editId ? "Update Attendance" : "Submit Attendance"}
                    </button>
                </main>
            )}

            {/* Success Step */}
            {step === "success" && (
                <main className="mx-auto max-w-md px-4 py-10 space-y-5 text-center animate-fade-in">
                    <div className="mx-auto h-16 w-16 rounded-2xl bg-[#0d9488]/10 flex items-center justify-center text-3xl animate-bounce">✓</div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900">{editId ? "Updated!" : "Recorded!"}</h2>
                        <p className="text-sm text-gray-500">Extra class attendance saved.</p>
                    </div>
                    {summary && (
                        <div className="rounded-3xl border border-gray-100 bg-white p-5 text-left shadow-sm space-y-3">
                            {[["Class", summary.class || selectedClass], ["Subject", summary.subject || effectiveSubject], ["Date", summary.date || date]].map(([l, v]) => (
                                <div key={l} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                                    <span className="text-xs font-bold text-gray-400 uppercase">{l}</span>
                                    <span className="text-sm font-black text-gray-800">{v}</span>
                                </div>
                            ))}
                            <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                                <div><p className="text-lg font-black text-gray-700">{summary.total ?? students.length}</p><p className="text-[9px] font-bold text-gray-400 uppercase">Total</p></div>
                                <div><p className="text-lg font-black text-emerald-600">{summary.present ?? counts.present}</p><p className="text-[9px] font-bold text-emerald-500 uppercase">Present</p></div>
                                <div><p className="text-lg font-black text-red-500">{summary.absent ?? totalAbsent}</p><p className="text-[9px] font-bold text-red-400 uppercase">Absent</p></div>
                            </div>
                            {((summary.sick || 0) > 0 || (summary.leave || 0) > 0) && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {(summary.sick || 0) > 0 && <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase text-orange-600">🤒 {summary.sick} Sick</span>}
                                    {(summary.leave || 0) > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase text-amber-600">🏠 {summary.leave} On Leave</span>}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex gap-3">
                        <button onClick={resetAll}
                            className="flex-1 rounded-2xl border border-gray-200 bg-white py-4 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all active:scale-[0.98]">New Class</button>
                        <button onClick={() => router.push("/")}
                            className="flex-1 rounded-2xl bg-gray-900 py-4 text-sm font-bold text-white hover:bg-black transition-all active:scale-[0.98]">Home</button>
                    </div>
                </main>
            )}
        </div>
    );
}
