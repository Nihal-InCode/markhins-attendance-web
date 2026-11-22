"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getStudents, getStudentHistory, markAttendance, editLastAttendance, markHealthStatus, trackEvent } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";


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

// ─────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────
const STATUS_CYCLE = ["present", "absent", "special_leave"];


const statusConfig = {
    present: { label: "Present", color: "bg-green-500", text: "text-green-600", bg: "bg-green-50", border: "border-green-100", dot: "bg-green-500" },
    absent: { label: "Absent", color: "bg-red-500", text: "text-red-500", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500" },
    special_leave: { label: "Special Leave", color: "bg-blue-500", text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100", dot: "bg-blue-500" },
    sick: { label: "Sick", color: "bg-orange-500", text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100", dot: "bg-orange-500" },
    leave: { label: "On Leave", color: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", dot: "bg-amber-500" },
};

// ─────────────────────────────────────────────
// CONFIRMATION MODAL
// ─────────────────────────────────────────────
function ConfirmationModal({ params, students, attendance, onGoHome }) {
    const groups = { present: [], absent: [], special_leave: [], sick: [], leave: [] };

    students.forEach((s) => {
        const health = s.healthStatus;
        if (health === 'S') groups.sick.push(s);
        else if (health === 'L') groups.leave.push(s);
        else {
            const st = attendance[s.id] || "present";
            if (groups[st]) groups[st].push(s);
        }
    });

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
            <div className="bg-white w-full sm:max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="bg-green-600 p-6 rounded-t-[2.5rem] sm:rounded-t-[2.5rem] flex-shrink-0 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 blur-2xl" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-lg">✅</div>
                            <span className="text-white font-black text-sm uppercase tracking-widest">Attendance Recorded</span>
                        </div>
                        <h2 className="text-white text-xl font-black">{params?.className}</h2>
                        <p className="text-green-100 text-xs font-bold mt-0.5">
                            {params?.subjectName} • {params?.multiMode ? `Periods: ${params?.periods?.join(', ')}` : `Period ${params?.period?.replace("P", "")}`} • {params?.date}
                        </p>
                    </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-5 space-y-4 pb-6">
                    {[
                        { key: "sick", ...statusConfig.sick },
                        { key: "leave", ...statusConfig.leave },
                        { key: "absent", ...statusConfig.absent },
                        { key: "special_leave", ...statusConfig.special_leave },
                        { key: "present", ...statusConfig.present },
                    ].map(({ key, label, bg, text, border, dot }) =>
                        groups[key].length > 0 ? (
                            <div key={key} className="space-y-2">
                                <div className="flex items-center gap-2 px-1">
                                    <div className={`w-2 h-2 rounded-full ${dot}`} />
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${text}`}>{label} ({groups[key].length})</span>
                                </div>
                                <div className={`${bg} ${border} border rounded-[2rem] overflow-hidden divide-y divide-white/50`}>
                                    {groups[key].map((s, i) => (
                                        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black bg-white ${text}`}>
                                                {s.rollNo}
                                            </div>
                                            <p className="font-bold text-gray-800 text-sm">{s.name}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-8 pt-3 flex-shrink-0 border-t border-gray-50">
                    <button
                        onClick={onGoHome}
                        className="w-full py-5 rounded-[2rem] font-black text-base bg-green-600 text-white hover:bg-green-700 transition-all active:scale-95 shadow-xl shadow-green-100"
                    >
                        🏠 Go To Home
                    </button>
                </div>
            </div>
        </div>
    );
}


// ─────────────────────────────────────────────
// MAIN ATTENDANCE PAGE
// ─────────────────────────────────────────────
import { useAuth } from "@/context/AuthContext";
function StudentLast30Attendance({ student }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [entries, setEntries] = useState([]);
    const requestIdRef = useRef(0);

    const openHistory = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        setLoading(true);
        setError("");
        setEntries([]);
        const requestId = ++requestIdRef.current;
        try {
            const history = await getStudentHistory(student.rollNo);
            if (history?.success === false) throw new Error(history.message || "Student attendance history was not found.");
            if (!Array.isArray(history?.log)) throw new Error("Student attendance history is incomplete.");
            const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
            const parts = formatter.formatToParts(new Date());
            const today = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
            const fromDate = new Date(`${today}T00:00:00Z`);
            fromDate.setUTCDate(fromDate.getUTCDate() - 29);
            const start = fromDate.toISOString().slice(0, 10);
            const labels = { P: "Present", A: "Absent", S: "Sick", L: "Leave", SL: "Special Leave" };
            setEntries(history.log
                .filter((entry) => entry.date >= start && entry.date <= today && labels[String(entry.status).toUpperCase()])
                .map((entry) => ({ ...entry, statusLabel: labels[String(entry.status).toUpperCase()] }))
                .sort((a, b) => String(b.date).localeCompare(String(a.date))));
        } catch (err) {
            setError(err.message || "Could not load attendance history.");
        } finally {
            setLoading(false);
        }
    };

    const counts = entries.reduce((result, entry) => {
        const code = String(entry.status).toUpperCase();
        const key = code === "SL" ? "special_leave" : ({ P: "present", A: "absent", S: "sick", L: "leave" }[code]);
        if (key) {
            if (key === "sick" || key === "leave") {
                result[`${key}Dates`] ||= new Set();
                result[`${key}Dates`].add(entry.date);
                result[key] = result[`${key}Dates`].size;
            } else {
                result[key] = (result[key] || 0) + 1;
            }
        }
        return result;
    }, {});
    const close = () => { requestIdRef.current += 1; setOpen(false); setLoading(false); };

    return <>
        <button type="button" onClick={openHistory} onContextMenu={(event) => event.preventDefault()} title={`View ${student.name}'s last 30 days attendance`} aria-label={`View ${student.name}'s last 30 days attendance`} className="relative z-10 w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black cursor-pointer select-none touch-manipulation hover:ring-2 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {student.rollNo}
        </button>
        {open && typeof document !== "undefined" && createPortal(
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={close}>
                <section role="dialog" aria-modal="true" aria-label="Last 30 days attendance" className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-start justify-between border-b border-gray-100 bg-gray-50/70 p-5"><div><h3 className="text-base font-black text-gray-900">{student.name}</h3><p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Roll {student.rollNo} · Last 30 days</p></div><button type="button" onClick={close} aria-label="Close attendance history" className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-500 hover:bg-gray-100">×</button></div>
                    <div className="space-y-4 overflow-y-auto p-5">{loading ? <p className="py-8 text-center text-xs font-bold text-gray-400">Loading attendance history…</p> : error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ key: "present", label: "Present", color: "text-emerald-600 bg-emerald-50" }, { key: "absent", label: "Absent", color: "text-red-600 bg-red-50" }, { key: "sick", label: "Sick Days", color: "text-orange-600 bg-orange-50" }, { key: "leave", label: "Leave Days", color: "text-purple-600 bg-purple-50" }].map((item) => <div key={item.key} className={`rounded-xl p-3 text-center ${item.color}`}><p className="text-xl font-black">{counts[item.key] || 0}</p><p className="text-[9px] font-black uppercase tracking-wider">{item.label}</p></div>)}</div>
                        {counts.special_leave > 0 && <p className="text-[10px] font-bold text-violet-600">Special leave: {counts.special_leave}</p>}
                        <p className="text-[10px] font-medium text-gray-400">Only days on which classes were conducted are counted. Days without a class session are excluded from the count.</p>
                        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">{entries.map((entry, index) => <div key={`${entry.date}-${entry.period}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[11px]"><span className="font-bold text-gray-700">{entry.date} · {entry.period}</span><span className="font-black text-gray-500">{entry.statusLabel}</span></div>)}{entries.length === 0 && <p className="px-3 py-6 text-center text-xs font-bold text-gray-400">No attendance records in the last 30 days.</p>}</div>
                    </>}</div>
                </section>
            </div>, document.body
        )}
    </>;
}

export default function AttendancePage() {
    const { user } = useAuth();
    const [params, setParams] = useState(null);
    const [students, setStudents] = useState([]);
    const [attendance, setAttendance] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showConfirm, setShowConfirm] = useState(false);
    const [currentLessonPage, setCurrentLessonPage] = useState("");
    const [playingClassAudio, setPlayingClassAudio] = useState(false);
    const [classAudioError, setClassAudioError] = useState("");
    const [healthActionStudent, setHealthActionStudent] = useState(null);
    const [healthStatusOverrides, setHealthStatusOverrides] = useState({});
    const [healthActionBusy, setHealthActionBusy] = useState(false);
    const classAudioRef = useRef(null);
    const longPressTimerRef = useRef(null);
    const longPressTriggeredRef = useRef(false);
    const { showLoader, hideLoader } = useLoading();
    const router = useRouter();
    const canManageHealth = ["admin", "principal", "vice principal"].includes(String(user?.role || "").trim().toLowerCase());

    const startHealthLongPress = (student) => {
        if (!canManageHealth) return;
        longPressTriggeredRef.current = false;
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            setHealthActionStudent(student);
        }, 550);
    };

    const cancelHealthLongPress = () => clearTimeout(longPressTimerRef.current);

    const chooseHealthStatus = async (status) => {
        if (!healthActionStudent) return;
        const student = healthActionStudent;
        const id = student.id;
        const currentHealthStatus = Object.prototype.hasOwnProperty.call(healthStatusOverrides, id)
            ? healthStatusOverrides[id]
            : student.healthStatus;
        const action = status === "unlock"
            ? (currentHealthStatus === "S" ? "cure" : "return")
            : status;

        setHealthActionBusy(true);
        setError("");
        try {
            const result = await markHealthStatus(action, [student.rollNo], params?.className || params?.classId);
            if (!result?.success) throw new Error(result?.error || result?.message || "Could not update the student’s health status.");

            const nextHealthStatus = status === "unlock" ? null : (status === "sick" ? "S" : "L");
            setHealthStatusOverrides((prev) => ({ ...prev, [id]: nextHealthStatus }));
            setAttendance((prev) => ({ ...prev, [id]: status === "unlock" ? "present" : "absent" }));
            setHealthActionStudent(null);
        } catch (err) {
            setError(err.message || "Could not update the student’s health status.");
        } finally {
            setHealthActionBusy(false);
        }
    };

    useEffect(() => {
        const stopClassAudio = () => {
            const audio = classAudioRef.current;
            if (!audio) return;
            audio.pause();
            audio.currentTime = 0;
            classAudioRef.current = null;
            setPlayingClassAudio(false);
        };
        const stopWhenHidden = () => {
            if (document.visibilityState === "hidden") stopClassAudio();
        };
        document.addEventListener("visibilitychange", stopWhenHidden);
        window.addEventListener("pagehide", stopClassAudio);
        return () => {
            document.removeEventListener("visibilitychange", stopWhenHidden);
            window.removeEventListener("pagehide", stopClassAudio);
            stopClassAudio();
        };
    }, []);

    const playClassAudio = async () => {
        setClassAudioError("");
        setPlayingClassAudio(true);
        try {
            if (classAudioRef.current) {
                classAudioRef.current.pause();
                classAudioRef.current.currentTime = 0;
            }
            const className = String(params?.className || "").trim();
            const audioPath = `/sounds/${encodeURIComponent(`${className} NAMES .mp3`)}`;
            const audio = new Audio(audioPath);
            classAudioRef.current = audio;
            audio.onended = () => {
                if (classAudioRef.current === audio) classAudioRef.current = null;
                setPlayingClassAudio(false);
            };
            audio.onerror = () => {
                if (classAudioRef.current === audio) classAudioRef.current = null;
                setPlayingClassAudio(false);
                setClassAudioError("File not found");
            };
            await audio.play();
        } catch {
            setPlayingClassAudio(false);
            setClassAudioError("File not found");
        }
    };

    useEffect(() => {
        if (user && user.role !== 'admin' && (user.is_teacher === 0 || user.is_teacher === false)) {
            router.replace("/?tab=reports");
            return;
        }
    }, [user, router]);

    useEffect(() => {
        // Start each new attendance visit at the top; don't interfere with
        // scrolling after the teacher begins taking attendance.
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        const stored = sessionStorage.getItem("attendance_params");
        if (!stored) { router.push("/"); return; }
        const parsed = JSON.parse(stored);
        setParams(parsed);
        trackEvent('Opened attendance page', parsed.classId || '');
        fetchStudents(parsed.classId, parsed.isEdit ? parsed : null, parsed.subjectId, parsed.date);
    }, [router]);

    async function fetchStudents(classId, editParams = null, subjectId = null, date = null) {
        showLoader("Loading students...");
        try {
            const data = await getStudents(classId, subjectId, date);
            setStudents(data);
            const initial = {};

            data.forEach((s) => {
                // PART 2: Auto-Absent for Sick (S) or Leave (L)
                if (s.healthStatus === 'S' || s.healthStatus === 'L') {
                    initial[s.id] = "absent";
                } else {
                    initial[s.id] = "present";
                }
            });

            // Edit mode: try to fetch existing statuses
            if (editParams) {
                try {
                    const { getPeriodSummary } = await import('@/lib/api');
                    const summary = await getPeriodSummary(editParams.classId, editParams.period, editParams.date);
                    if (summary?.records?.length) {
                        summary.records.forEach((r) => {
                            const student = data.find(s => String(s.id) === String(r.id) || s.rollNo === r.rollNo);
                            if (student) {
                                // Don't override S or L even in edit mode
                                if (student.healthStatus !== 'S' && student.healthStatus !== 'L') {
                                    // The API returns full labels like 'present', 'absent', 'sick', 'leave'
                                    // So we can use r.status directly if it's a valid DASHBOARD status.
                                    if (r.status === 'present' || r.status === 'absent' || r.status === 'special_leave') {
                                        initial[student.id] = r.status;
                                    }
                                }
                            }
                        });
                    }
                } catch (_) { }
            }

            setAttendance(initial);
        } catch (err) {
            setError("Failed to load students. Please try again.");
        } finally {
            setLoading(false);
            hideLoader();
        }
    }

    const toggleStatus = (studentId) => {
        const student = students.find(s => s.id === studentId);
        const healthStatus = Object.prototype.hasOwnProperty.call(healthStatusOverrides, studentId)
            ? healthStatusOverrides[studentId]
            : student?.healthStatus;
        // PART 2: Disable override for Sick/Leave
        if (healthStatus === 'S' || healthStatus === 'L') return;

        setAttendance((prev) => {
            const current = prev[studentId];
            const nextIndex = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
            return { ...prev, [studentId]: STATUS_CYCLE[nextIndex] };
        });
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        showLoader(params?.isEdit ? "Updating records..." : "Submitting attendance...", { vibrate: true });
        setError("");
        try {
            const records = students.map((s) => ({
                studentId: s.id,
                status: attendance[s.id],
            }));

            if (params?.isEdit) {
                const result = await editLastAttendance(records, {
                    classId: params.classId,
                    period: params.period,
                    date: params.date,
                });
                if (result.success) {
                    trackEvent('Edited attendance', `${params.classId} ${params.period}`);
                    playSound('attendanceSuccess');
                    setShowConfirm(true);
                } else {
                    playSound('attendanceError');
                    setError(result.error || 'Failed to update attendance.');
                }
            } else {
                const result = await markAttendance({
                    classId: params.classId,
                    period: params.period,
                    periods: params.periods,
                    date: params.date,
                    records,
                    currentLessonPage: currentLessonPage ? Number(currentLessonPage) : undefined,
                });

                if (result.duplicate) {
                    playSound('attendanceError');
                    setError(`⚠️ Attendance already marked. Use Edit on Home screen.`);
                    return;
                }

                if (result.success) {
                    trackEvent('Marked attendance', `${params.classId} ${params.period}`);
                    playSound('attendanceSuccess');
                    try {
                        const sessionInfo = {
                            classId: params.classId,
                            className: params.className || params.classId,
                            period: params.multiMode ? (params.periods || []).join(', ') : params.period,
                            subjectName: params.subjectName || 'General',
                            date: params.date || getIstToday(),
                            markedAt: Date.now(),
                        };
                        localStorage.setItem('recent_marked_session_info', JSON.stringify(sessionInfo));
                    } catch (e) {
                        console.error('Failed to save recent session info to localStorage:', e);
                    }
                    setShowConfirm(true);
                } else {
                    playSound('attendanceError');
                    setError(result.error || result.message || 'Failed to mark attendance.');
                }
            }
        } catch (err) {
            setError("Error: " + err.message);
        } finally {
            setSubmitting(false);
            hideLoader();
        }
    };


    // Summary counts
    const counts = { present: 0, absent: 0, special_leave: 0, sick: 0, leave: 0 };
    students.forEach((s) => {
        const healthStatus = Object.prototype.hasOwnProperty.call(healthStatusOverrides, s.id)
            ? healthStatusOverrides[s.id]
            : s.healthStatus;
        if (healthStatus === 'S' || healthStatus === 'L') {
            if (healthStatus === 'S') counts.sick++;
            else counts.leave++;
        }
        else {
            const st = attendance[s.id] || "present";
            if (counts[st] !== undefined) counts[st]++;
        }
    });

    if (loading) return <PencilLoader />;

    return (
        <div className="min-h-screen bg-gray-50/50 pb-24 font-sans">
            <header className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10 shadow-sm">
                <div className="max-w-md mx-auto flex justify-between items-center">
                    <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-700 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center">
                        <h1 className="text-lg font-black">{params?.isEdit ? '✏️ Edit Attendance' : params?.className}</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">
                            {params?.subjectName} • {params?.multiMode ? `Periods: ${params?.periods?.join(', ')}` : `Period ${params?.period?.replace("P", "")}`}
                        </p>
                        {params?.date && (
                            <div className="flex items-center justify-center gap-1.5 mt-1.5">
                                <span className="text-[10px] font-bold text-gray-400">{formatDisplayDate(params.date)}</span>
                                {params.date === getIstToday() && (
                                    <span className="text-[9px] font-black uppercase tracking-widest bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full">Today</span>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="w-6" />
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 py-6 space-y-4">
                {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100">{error}</div>}

                <div className="flex flex-col items-center gap-1.5">
                    <button
                        type="button"
                        onClick={playClassAudio}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95"
                    >
                        <span aria-hidden="true">🔊</span>
                        {playingClassAudio ? "PLAYING…" : "READ ALOUD"}
                    </button>
                    {classAudioError && <p role="alert" className="text-center text-xs font-bold text-red-600">{classAudioError}</p>}
                </div>

                {/* Counts bar */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 border border-green-100 rounded-3xl py-4 text-center">
                        <p className="text-2xl font-black text-green-600">{counts.present}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-600 opacity-70">Present</p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-3xl py-4 text-center">
                        <p className="text-2xl font-black text-red-500">{counts.absent + counts.sick + counts.leave}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500 opacity-70">Total Absent</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-100 rounded-3xl py-4 text-center">
                        <p className="text-2xl font-black text-blue-600">{counts.special_leave}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 opacity-70">Special Leave</p>
                    </div>
                </div>

                {/* Student list */}
                <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
                    {students.map((student) => {
                        const registerNumber = student.registerNo;
                        const healthStatus = Object.prototype.hasOwnProperty.call(healthStatusOverrides, student.id)
                            ? healthStatusOverrides[student.id]
                            : student.healthStatus;
                        const isHealthLocked = healthStatus === 'S' || healthStatus === 'L';
                        const st = isHealthLocked ? (healthStatus === 'S' ? 'sick' : 'leave') : (attendance[student.id] || "present");
                        const cfg = statusConfig[st] || statusConfig.present;

                        return (
                            <div
                                key={student.id}
                                className={`p-4 flex items-center justify-between transition-colors ${st === "absent" ? "bg-red-50/10" : isHealthLocked ? "bg-gray-50/30" : ""}`}
                            >
                                <div className="flex items-center space-x-4">
                                    <StudentLast30Attendance student={student} />
                                    <div>
                                        <p className="font-bold text-gray-800 leading-tight">{student.name}</p>
                                        {registerNumber ? (
                                            <p className="mt-0.5 text-[10px] font-semibold leading-tight tracking-wide text-gray-400">{registerNumber}</p>
                                        ) : (
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${isHealthLocked ? 'animate-pulse' : ''}`} />
                                                <p className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>
                                                    {cfg.label}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {isHealthLocked ? (
                                    <button
                                        type="button"
                                        onPointerDown={() => startHealthLongPress(student)}
                                        onPointerUp={cancelHealthLongPress}
                                        onPointerLeave={cancelHealthLongPress}
                                        onPointerCancel={cancelHealthLongPress}
                                        onContextMenu={(e) => { e.preventDefault(); if (canManageHealth) setHealthActionStudent(student); }}
                                        onClick={() => { if (longPressTriggeredRef.current) { longPressTriggeredRef.current = false; return; } }}
                                        className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border ${cfg.bg} ${cfg.text} ${cfg.border} flex items-center gap-1.5`}
                                        aria-label={`${student.name}, locked. Long press for options.`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                        Locked
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onPointerDown={() => startHealthLongPress(student)}
                                        onPointerUp={cancelHealthLongPress}
                                        onPointerLeave={cancelHealthLongPress}
                                        onPointerCancel={cancelHealthLongPress}
                                        onContextMenu={(e) => { e.preventDefault(); if (canManageHealth) setHealthActionStudent(student); }}
                                        onClick={() => { if (longPressTriggeredRef.current) { longPressTriggeredRef.current = false; return; } toggleStatus(student.id); }}
                                        className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${cfg.bg} ${cfg.text} ${cfg.border} border active:scale-95`}
                                    >
                                        {cfg.label}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {healthActionStudent && canManageHealth && (
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" onClick={() => setHealthActionStudent(null)}>
                        <div role="dialog" aria-modal="true" aria-label="Student health status options" className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                            <p className="mb-3 text-sm font-black text-gray-800">{healthActionStudent.name}</p>
                            {(Object.prototype.hasOwnProperty.call(healthStatusOverrides, healthActionStudent.id)
                                ? healthStatusOverrides[healthActionStudent.id]
                                : healthActionStudent.healthStatus) === 'S' || (Object.prototype.hasOwnProperty.call(healthStatusOverrides, healthActionStudent.id)
                                ? healthStatusOverrides[healthActionStudent.id]
                                : healthActionStudent.healthStatus) === 'L' ? (
                                <>
                                    <button type="button" disabled={healthActionBusy} onClick={() => chooseHealthStatus("unlock")} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{healthActionBusy ? "Updating…" : "Unlock"}</button>
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <button type="button" disabled={healthActionBusy} onClick={() => chooseHealthStatus("sick")} className="w-full rounded-xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 disabled:opacity-60">Mark sick</button>
                                    <button type="button" disabled={healthActionBusy} onClick={() => chooseHealthStatus("leave")} className="w-full rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 disabled:opacity-60">Mark leave</button>
                                </div>
                            )}
                            <button type="button" disabled={healthActionBusy} onClick={() => setHealthActionStudent(null)} className="mt-2 w-full rounded-xl px-4 py-2 text-xs font-bold text-gray-500 disabled:opacity-60">Cancel</button>
                        </div>
                    </div>
                )}

                {/* Optional Syllabus tracker lesson page */}
                {!params?.isEdit && (() => {
                    const isHadith = params?.subjectName && params.subjectName.includes('مِشْكَاةُ');
                    return (
                    <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-3">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">
                            Syllabus Progress (Optional)
                        </label>
                        <div>
                            <input
                                type="number"
                                placeholder={isHadith ? "Current Hadith Number (e.g. 500)" : "Current Lesson Page Number (e.g. 187)"}
                                className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all text-gray-800"
                                value={currentLessonPage}
                                onChange={(e) => setCurrentLessonPage(e.target.value)}
                            />
                            <p className="text-[9px] font-bold text-gray-400 px-1 mt-1.5 italic">
                                * Entering a number updates the syllabus completion stats automatically.
                            </p>
                        </div>
                    </div>
                    );
                })()}

                {/* Submit */}
                <div className="pt-4">
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className={`w-full py-5 rounded-[2rem] text-lg font-black shadow-2xl transition-all active:scale-[0.98] ${submitting ? "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed" : params?.isEdit ? "bg-amber-500 text-white shadow-amber-200 hover:bg-amber-600" : "bg-blue-600 text-white shadow-blue-200 hover:bg-blue-700"
                            }`}
                    >
                        {submitting ? "Processing..." : (params?.isEdit ? "Update Attendance" : "Submit Attendance")}
                    </button>
                </div>
            </main>

            {showConfirm && (
                <ConfirmationModal
                    params={params}
                    students={students}
                    attendance={attendance}
                    onGoHome={() => {
                        setShowConfirm(false);
                        router.push('/');
                    }}
                />
            )}
        </div>
    );
}
