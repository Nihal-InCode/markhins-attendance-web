"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from "@/lib/sound";
import PencilLoader from "@/components/PencilLoader";
import {
    getClasses,
    getStudents,
    getStudyLeaveSetting,
    getStudyLeaveStatus,
    markStudyLeaveAttendance,
    editStudyLeaveAttendance,
    deleteStudyLeaveAttendance,
    getLastStudyLeave,
    trackEvent,
} from "@/lib/api";


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const getIstToday = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
};

const formatDisplayDate = (dateStr) => {
    try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    } catch { return dateStr; }
};

const classNameOf = (c) => String(c?.name || c?.class || c?.id || c || "").trim();

// ─────────────────────────────────────────────
// STATUS CONFIG (same 3-state cycle as regular attendance)
// ─────────────────────────────────────────────
const STATUS_CYCLE = ["present", "absent", "special_leave"];

const statusConfig = {
    present: { label: "Present", color: "bg-green-500", text: "text-green-600", bg: "bg-green-50", border: "border-green-100", dot: "bg-green-500" },
    absent: { label: "Absent", color: "bg-red-500", text: "text-red-500", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500" },
    special_leave: { label: "Special Leave", color: "bg-blue-500", text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100", dot: "bg-blue-500" },
    sick: { label: "Sick", color: "bg-orange-500", text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100", dot: "bg-orange-500" },
    leave: { label: "On Leave", color: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", dot: "bg-amber-500" },
};


export default function StudyLeavePage() {
    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    const [loading, setLoading] = useState(true);
    const [setting, setSetting] = useState(null);
    const [classes, setClasses] = useState([]);
    const [lastMarking, setLastMarking] = useState(null);

    const [date, setDate] = useState(getIstToday());
    const [sessionKey, setSessionKey] = useState("");
    const [step, setStep] = useState(1);

    const [selectedClasses, setSelectedClasses] = useState([]);
    const [classModalOpen, setClassModalOpen] = useState(false);
    const [classSearch, setClassSearch] = useState("");

    const [studentsByClass, setStudentsByClass] = useState({});
    const [attendanceByClass, setAttendanceByClass] = useState({});
    const [classStatus, setClassStatus] = useState({});

    const [submitting, setSubmitting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    // Access guard: same rule as the regular marking page
    useEffect(() => {
        if (user && user.role !== 'admin' && (user.is_teacher === 0 || user.is_teacher === false)) {
            router.replace("/?tab=reports");
        }
    }, [user, router]);

    // Load setting first — redirect home when the feature is off (fail-closed)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await getStudyLeaveSetting();
                if (cancelled) return;
                if (!res?.enabled) { router.replace("/"); return; }
                setSetting(res);
            } catch (_) {
                if (!cancelled) router.replace("/");
                return;
            }
            try {
                const cls = await getClasses();
                if (!cancelled) setClasses(Array.isArray(cls) ? cls : []);
            } catch (_) { }
            try {
                const last = await getLastStudyLeave();
                if (!cancelled) setLastMarking(last || null);
            } catch (_) { }
            if (!cancelled) {
                trackEvent('Opened study leave page');
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [router]);

    const power = Number(setting?.powers?.[sessionKey] ?? 1);
    const sessionLabel = (setting?.sessions || []).find(s => s.key === sessionKey)?.label || "";

    const countsFor = (cls) => {
        const list = studentsByClass[cls] || [];
        const att = attendanceByClass[cls] || {};
        const counts = { present: 0, absent: 0, special_leave: 0, sick: 0, leave: 0 };
        list.forEach(s => {
            if (s.healthStatus === 'S') counts.sick++;
            else if (s.healthStatus === 'L') counts.leave++;
            else {
                const st = att[String(s.id)] || "present";
                if (counts[st] !== undefined) counts[st]++;
            }
        });
        return counts;
    };

    const buildPayload = (cls) => {
        const list = studentsByClass[cls] || [];
        const att = attendanceByClass[cls] || {};
        const students = {};
        list.forEach(s => { students[String(s.id)] = att[String(s.id)] || "present"; });
        return students;
    };

    const enterStep2 = async (override = {}) => {
        const targetDate = override.date || date;
        const targetSession = override.sessionKey || sessionKey;
        const targetClasses = override.classes || selectedClasses;
        if (!targetSession || targetClasses.length === 0) return;

        setSuccessMsg("");
        setError("");
        setStep(2);
        showLoader("Loading students...");
        try {
            const results = await Promise.all(targetClasses.map(cls => getStudents(cls)));
            const studentsMap = {};
            const attMap = {};
            targetClasses.forEach((cls, i) => {
                const list = Array.isArray(results[i]) ? results[i] : [];
                studentsMap[cls] = list;
                attMap[cls] = {};
                list.forEach(s => {
                    attMap[cls][String(s.id)] = (s.healthStatus === 'S' || s.healthStatus === 'L') ? "absent" : "present";
                });
            });

            const statusRes = await getStudyLeaveStatus(targetSession, targetDate, targetClasses);
            const statusMap = {};
            (statusRes?.classes || []).forEach(entry => {
                statusMap[entry.class] = entry;
                if (entry.marked && Array.isArray(entry.records)) {
                    entry.records.forEach(r => {
                        const sid = String(r.studentId);
                        const student = (studentsMap[entry.class] || []).find(s => String(s.id) === sid);
                        // Never override active Sick/Leave students
                        if (student?.healthStatus === 'S' || student?.healthStatus === 'L') return;
                        if (attMap[entry.class]) attMap[entry.class][sid] = r.status;
                    });
                }
            });

            setStudentsByClass(studentsMap);
            setAttendanceByClass(attMap);
            setClassStatus(statusMap);
            setDate(targetDate);
            setSessionKey(targetSession);
            setSelectedClasses(targetClasses);
        } catch (err) {
            setError("Failed to load students. Please try again.");
            setStep(1);
        } finally {
            hideLoader();
        }
    };

    const refreshStatus = async () => {
        try {
            const statusRes = await getStudyLeaveStatus(sessionKey, date, selectedClasses);
            const statusMap = {};
            (statusRes?.classes || []).forEach(entry => { statusMap[entry.class] = entry; });
            setClassStatus(prev => ({ ...prev, ...statusMap }));
            const last = await getLastStudyLeave();
            setLastMarking(last || null);
        } catch (_) { }
    };

    const toggleStatus = (cls, studentId) => {
        const student = (studentsByClass[cls] || []).find(s => String(s.id) === String(studentId));
        if (student?.healthStatus === 'S' || student?.healthStatus === 'L') return;
        const entry = classStatus[cls];
        if (entry?.marked && !entry?.editable) return;

        setAttendanceByClass(prev => {
            const current = prev[cls]?.[String(studentId)] || "present";
            const nextIndex = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
            return { ...prev, [cls]: { ...prev[cls], [String(studentId)]: STATUS_CYCLE[nextIndex] } };
        });
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        showLoader("Submitting study leave attendance...", { vibrate: true });
        setError("");
        try {
            const unmarked = selectedClasses.filter(cls => !classStatus[cls]?.marked);
            const editableMarked = selectedClasses.filter(cls => classStatus[cls]?.marked && classStatus[cls]?.editable);
            const blocked = selectedClasses.filter(cls => classStatus[cls]?.marked && !classStatus[cls]?.editable);

            const messages = [];
            let allOk = true;

            if (unmarked.length) {
                const classRecords = unmarked.map(cls => ({ class: cls, students: buildPayload(cls) }));
                const res = await markStudyLeaveAttendance({ date, session: sessionKey, classRecords });
                if (res?.success) {
                    messages.push(res.message || `Marked ${unmarked.join(', ')}.`);
                } else {
                    allOk = false;
                    messages.push(res?.error || res?.message || "Failed to mark attendance.");
                }
            }

            for (const cls of editableMarked) {
                const res = await editStudyLeaveAttendance(sessionKey, date, cls, buildPayload(cls));
                if (res?.success) messages.push(`${cls} updated.`);
                else { allOk = false; messages.push(`${cls}: ${res?.error || "Failed to update."}`); }
            }

            if (blocked.length) {
                messages.push(`Skipped (marked by another teacher): ${blocked.join(', ')}.`);
            }

            setShowConfirm(false);
            if (allOk) {
                playSound('attendanceSuccess');
                setSuccessMsg(messages.join(" "));
                await refreshStatus();
            } else {
                playSound('attendanceError');
                setError(messages.join(" "));
                await refreshStatus();
            }
        } catch (err) {
            playSound('attendanceError');
            setError("Error: " + err.message);
        } finally {
            setSubmitting(false);
            hideLoader();
        }
    };

    const handleDelete = async () => {
        if (!lastMarking) return;
        const ok = confirm(`Delete study leave attendance for ${lastMarking.className} (${lastMarking.sessionLabel}) on ${formatDisplayDate(lastMarking.date)}?`);
        if (!ok) return;
        showLoader("Deleting...");
        try {
            const res = await deleteStudyLeaveAttendance(lastMarking.session, lastMarking.date, lastMarking.className);
            if (res?.success) {
                playSound('attendanceSuccess');
                setLastMarking(null);
                setSuccessMsg(res.message || "Study leave attendance deleted.");
                if (step === 2 && selectedClasses.includes(lastMarking.className) && date === lastMarking.date && sessionKey === lastMarking.session) {
                    await refreshStatus();
                }
            } else {
                playSound('attendanceError');
                setError(res?.error || "Failed to delete.");
            }
        } catch (err) {
            playSound('attendanceError');
            setError(err.message);
        } finally {
            hideLoader();
        }
    };

    if (loading) return <PencilLoader />;

    const sessions = setting?.sessions || [];
    const classOptions = classes.map(classNameOf).filter(Boolean);
    const allMarked = selectedClasses.length > 0 && selectedClasses.every(cls => classStatus[cls]?.marked);
    const nothingEditable = selectedClasses.length > 0 && selectedClasses.every(cls => classStatus[cls]?.marked && !classStatus[cls]?.editable);

    return (
        <div className="min-h-screen bg-gray-50/50 pb-24 font-sans">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10 shadow-sm">
                <div className="max-w-md mx-auto flex justify-between items-center">
                    <button onClick={() => (step === 2 ? setStep(1) : router.push("/"))} className="text-gray-400 hover:text-gray-700 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center">
                        <h1 className="text-lg font-black">📚 Study Leave</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">
                            {step === 1 ? "Step 1 • Select Classes" : `Step 2 • ${sessionLabel}`}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-1.5">
                            <span className="text-[10px] font-bold text-gray-400">{formatDisplayDate(date)}</span>
                            {date === getIstToday() && (
                                <span className="text-[9px] font-black uppercase tracking-widest bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full">Today</span>
                            )}
                        </div>
                    </div>
                    <div className="w-6" />
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 py-6 space-y-4">
                {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100">{error}</div>}
                {successMsg && <div className="p-4 bg-green-50 text-green-700 rounded-2xl text-sm font-bold border border-green-100">{successMsg}</div>}

                {/* Recent marking card */}
                {lastMarking && step === 1 && (
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-5 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">Your last study leave marking</p>
                                <p className="text-sm font-black text-gray-900 mt-0.5">
                                    {lastMarking.className} • {lastMarking.sessionLabel}
                                </p>
                                <p className="text-[11px] font-bold text-gray-400">{formatDisplayDate(lastMarking.date)}</p>
                            </div>
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${lastMarking.editable ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                {lastMarking.editable ? "Editable" : "Locked"}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => enterStep2({ date: lastMarking.date, sessionKey: lastMarking.session, classes: [lastMarking.className] })}
                                disabled={!lastMarking.editable}
                                className="py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-slate-50 text-slate-800 border border-slate-200 active:scale-95 disabled:opacity-40"
                            >
                                ✏️ Edit
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={!lastMarking.editable}
                                className="py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-red-50 text-red-500 border border-red-100 active:scale-95 disabled:opacity-40"
                            >
                                🗑 Delete
                            </button>
                        </div>
                    </div>
                )}

                {step === 1 ? (
                    <>
                        {/* Date */}
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">1. Date</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value || getIstToday())}
                                className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-slate-600/10 transition-all text-gray-800"
                            />
                        </div>

                        {/* Session select (before class selection) */}
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">2. Select Session</label>
                            <div className="grid grid-cols-2 gap-2.5">
                                {sessions.map(s => {
                                    const isSelected = sessionKey === s.key;
                                    return (
                                        <button
                                            key={s.key}
                                            onClick={() => setSessionKey(s.key)}
                                            className={`p-4 rounded-2xl border text-left transition-all active:scale-95 ${isSelected ? "bg-slate-700 border-slate-700 shadow-lg shadow-slate-300" : "bg-white border-gray-100 hover:border-slate-300"}`}
                                        >
                                            <p className={`text-xs font-black leading-tight ${isSelected ? "text-white" : "text-gray-800"}`}>{s.label}</p>
                                            <p className={`text-[10px] font-bold mt-1 ${isSelected ? "text-slate-300" : "text-gray-400"}`}>×{s.power} attendance</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Step 1: class multi-select */}
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">3. Select Classes</label>

                            {selectedClasses.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedClasses.map(cls => (
                                        <span key={cls} className="inline-flex items-center gap-1 bg-slate-50 text-slate-800 px-3 py-1 rounded-xl text-xs font-bold border border-slate-200">
                                            {cls}
                                            <button onClick={() => setSelectedClasses(prev => prev.filter(x => x !== cls))} className="text-slate-400 hover:text-slate-800 font-bold ml-1">x</button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => { setClassSearch(""); setClassModalOpen(true); }}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-xs font-medium text-gray-500 flex items-center justify-between hover:border-slate-300 transition-all"
                            >
                                <span>Click to select classes...</span>
                                <span className="text-[10px] font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md">{selectedClasses.length} selected</span>
                            </button>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={() => enterStep2()}
                                disabled={!sessionKey || selectedClasses.length === 0}
                                className={`w-full py-5 rounded-[2rem] text-lg font-black shadow-2xl transition-all active:scale-[0.98] ${!sessionKey || selectedClasses.length === 0 ? "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed" : "bg-slate-700 text-white shadow-slate-300 hover:bg-slate-800"}`}
                            >
                                {!sessionKey ? "Select a session" : selectedClasses.length === 0 ? "Select at least one class" : `Continue — ${selectedClasses.length} class${selectedClasses.length > 1 ? "es" : ""}`}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Session summary */}
                        <div className="bg-slate-700 rounded-[2rem] p-5 shadow-xl shadow-slate-300 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-white font-black text-sm">{sessionLabel}</p>
                                <p className="text-slate-300 text-[10px] font-bold mt-0.5">{formatDisplayDate(date)} • ×{power} attendance per mark</p>
                            </div>
                            <button
                                onClick={() => setStep(1)}
                                className="px-4 py-2.5 rounded-2xl bg-white/15 text-white text-[10px] font-black uppercase tracking-widest active:scale-95"
                            >
                                Change
                            </button>
                        </div>

                        {/* Per-class sections */}
                        {selectedClasses.map(cls => {
                            const entry = classStatus[cls] || {};
                            const counts = countsFor(cls);
                            const locked = entry.marked && !entry.editable;
                            const isEditing = entry.marked && entry.editable;
                            const list = studentsByClass[cls] || [];

                            return (
                                <div key={cls} className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                                    {/* Class header */}
                                    <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="font-black text-gray-900">{cls}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">P {counts.present}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">A {counts.absent + counts.sick + counts.leave}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">SL {counts.special_leave}</span>
                                            </div>
                                        </div>
                                        {entry.marked ? (
                                            <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border text-center ${locked ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                {locked ? `Marked by ${entry.teacherName || 'Admin'}` : "Editing"}
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border bg-slate-50 text-slate-700 border-slate-200">Not marked</span>
                                        )}
                                    </div>

                                    {/* Student list */}
                                    <div className="divide-y divide-gray-50">
                                        {list.map((student) => {
                                            const isHealth = student.healthStatus === 'S' || student.healthStatus === 'L';
                                            const st = isHealth ? (student.healthStatus === 'S' ? 'sick' : 'leave') : (attendanceByClass[cls]?.[String(student.id)] || "present");
                                            const cfg = statusConfig[st] || statusConfig.present;
                                            const disabled = isHealth || locked;

                                            return (
                                                <div key={student.id} className={`p-4 flex items-center justify-between transition-colors ${st === "absent" ? "bg-red-50/10" : isHealth ? "bg-gray-50/30" : ""}`}>
                                                    <div className="flex items-center space-x-4">
                                                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black ${cfg.bg} ${cfg.text}`}>
                                                            {student.rollNo}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-gray-800 leading-tight">{student.name}</p>
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${isHealth ? 'animate-pulse' : ''}`} />
                                                                <p className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {disabled ? (
                                                        <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border ${cfg.bg} ${cfg.text} ${cfg.border} flex items-center gap-1.5`}>
                                                            {isHealth ? (
                                                                <>
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                                                    </svg>
                                                                    Locked
                                                                </>
                                                            ) : "🔒 Marked"}
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => toggleStatus(cls, student.id)}
                                                            className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${cfg.bg} ${cfg.text} ${cfg.border} border active:scale-95`}
                                                        >
                                                            {cfg.label}
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {list.length === 0 && (
                                            <p className="p-6 text-center text-xs font-bold text-gray-400">No students found.</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Submit */}
                        <div className="pt-2 space-y-2">
                            <p className="text-[10px] font-bold text-gray-400 text-center uppercase tracking-widest">
                                Each mark records {power} attendance • Present → Absent → Special Leave
                            </p>
                            <button
                                onClick={() => setShowConfirm(true)}
                                disabled={submitting || nothingEditable}
                                className={`w-full py-5 rounded-[2rem] text-lg font-black shadow-2xl transition-all active:scale-[0.98] ${submitting || nothingEditable ? "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed" : "bg-slate-700 text-white shadow-slate-300 hover:bg-slate-800"}`}
                            >
                                {submitting ? "Processing..." : nothingEditable ? "Already marked by others" : allMarked ? "Update Attendance" : "Submit Attendance"}
                            </button>
                        </div>
                    </>
                )}
            </main>

            {/* Class selection modal */}
            {classModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/40 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setClassModalOpen(false)} />
                    <div className="relative bg-white rounded-[2rem] w-full max-w-md max-h-[85vh] flex flex-col p-6 shadow-2xl overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-gray-50 pb-3 mb-4">
                            <div>
                                <h4 className="text-sm font-black text-gray-900 uppercase tracking-wider">Select Classes</h4>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">Pick every class to mark</p>
                            </div>
                            <button onClick={() => setClassModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-xs font-bold w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center">✕</button>
                        </div>

                        <div className="mb-3">
                            <input
                                type="text"
                                placeholder="Search class..."
                                value={classSearch}
                                onChange={(e) => setClassSearch(e.target.value)}
                                className="w-full px-4 py-2.5 text-xs border border-gray-100 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-slate-600/20 font-medium"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-1 pr-1 max-h-[45vh]">
                            {classOptions.filter(c => c.toLowerCase().includes(classSearch.toLowerCase())).length === 0 ? (
                                <p className="py-8 text-center text-xs font-bold text-gray-400 uppercase">No classes found.</p>
                            ) : (
                                classOptions.filter(c => c.toLowerCase().includes(classSearch.toLowerCase())).map(cls => {
                                    const isSelected = selectedClasses.includes(cls);
                                    return (
                                        <button
                                            key={cls}
                                            type="button"
                                            onClick={() => setSelectedClasses(prev => (isSelected ? prev.filter(x => x !== cls) : [...prev, cls]))}
                                            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left group ${isSelected ? 'bg-slate-50 text-slate-800 font-black' : 'hover:bg-gray-50 text-gray-600'}`}
                                        >
                                            <span>{cls}</span>
                                            {isSelected ? (
                                                <span className="text-slate-700 font-extrabold text-[10px] uppercase tracking-wider bg-slate-200/60 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                                    <span>Selected</span>
                                                    <span className="text-xs">✓</span>
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">Select</span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        <div className="border-t border-gray-50 pt-4 mt-2">
                            <button type="button" onClick={() => setClassModalOpen(false)} className="w-full py-3 bg-slate-700 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-slate-600/20">
                                Done ({selectedClasses.length} selected)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation modal */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
                    <div className="bg-white w-full sm:max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-slate-700 p-6 flex-shrink-0 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 blur-2xl" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-lg">✅</div>
                                    <span className="text-white font-black text-sm uppercase tracking-widest">Study Leave Attendance</span>
                                </div>
                                <h2 className="text-white text-xl font-black">{sessionLabel}</h2>
                                <p className="text-slate-200 text-xs font-bold mt-0.5">{formatDisplayDate(date)} • ×{power} attendance per mark</p>
                            </div>
                        </div>

                        <div className="overflow-y-auto flex-1 p-5 space-y-3 pb-6">
                            {selectedClasses.map(cls => {
                                const counts = countsFor(cls);
                                const entry = classStatus[cls] || {};
                                const action = entry.marked ? (entry.editable ? "Update" : "Skip") : "Mark";
                                return (
                                    <div key={cls} className={`${action === "Skip" ? "bg-gray-50 border-gray-100" : "bg-slate-50 border-slate-200"} border rounded-[1.5rem] p-4 flex items-center justify-between gap-3`}>
                                        <div>
                                            <p className="font-black text-gray-900 text-sm">{cls}</p>
                                            <p className="text-[10px] font-bold text-gray-500 mt-0.5">
                                                {counts.present} present • {counts.absent + counts.sick + counts.leave} absent • {counts.special_leave} special leave
                                            </p>
                                        </div>
                                        <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${action === "Skip" ? 'bg-white text-gray-500 border-gray-200' : 'bg-white text-slate-800 border-slate-300'}`}>
                                            {action}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="px-5 pb-8 pt-3 flex-shrink-0 border-t border-gray-50 grid grid-cols-2 gap-3">
                            <button onClick={() => setShowConfirm(false)} className="w-full py-5 rounded-[2rem] font-black text-base bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95">
                                Cancel
                            </button>
                            <button onClick={handleSubmit} disabled={submitting} className={`w-full py-5 rounded-[2rem] font-black text-base transition-all active:scale-95 ${submitting ? "bg-gray-200 text-gray-400" : "bg-slate-700 text-white hover:bg-slate-800 shadow-xl shadow-slate-300"}`}>
                                {submitting ? "Saving..." : "Confirm"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
