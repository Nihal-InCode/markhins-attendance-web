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
    getStudyLeavePlatforms,
    getStudyLeaveStatus,
    markStudyLeaveAttendance,
    editStudyLeaveAttendance,
    deleteStudyLeaveAttendance,
    getLastStudyLeave,
    getStudyLeaveDayHistory,
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

// Same text layout the namaz copy button uses (WhatsApp-formatted report)
const buildStudyLeaveReport = (snap) => {
    const totalAbsent = snap.classes.reduce((n, c) => n + (c.counts.absent || 0), 0);
    let text = `─── *📚 Study Leave — REPORT* ───\n\n`;
    text += `📅 *${formatDisplayDate(snap.date)}*\n`;
    text += `📊 *${snap.sessionLabel}* • *${totalAbsent} Absent*\n\n`;

    snap.classes.forEach((cls) => {
        const sl = cls.counts.special_leave || 0;
        const abs = cls.counts.absent || 0;
        text += `─── *${cls.name}* ───\n`;

        if (sl > 0) {
            text += `🟡 *${sl} Special Leave*\n`;
            cls.students.filter(s => s.status === "special_leave").forEach(s => {
                text += `• \`${s.rollNo ?? "-"}\` — _${s.name || "Student"}_ (Special Leave)\n`;
            });
            text += `\n`;
        }

        if (abs > 0) {
            text += `🔴 *${abs} Absent*\n\n`;
            cls.students.filter(s => s.status === "absent").forEach(s => {
                text += `• \`${s.rollNo ?? "-"}\` — _${s.name || "Student"}_\n`;
            });
        } else if (sl === 0) {
            text += `🟢 *All Present* 🎉\n`;
        }
        text += `\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━\n\n`;
    text += `*©️ MARKHINS CONNECT*`;
    return text;
};

const copyTextToClipboard = async (text) => {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { }
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        return true;
    } catch (_) {
        return false;
    }
};

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

    const [platforms, setPlatforms] = useState([]);
    const [platformKey, setPlatformKey] = useState("");

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

    // Success screen snapshot (for the Copy/Done popup after marking)
    const [submitResult, setSubmitResult] = useState(null);
    const [reportCopied, setReportCopied] = useState(false);

    // History views: wizard | history (day) | historyEvent | historyClass
    const [view, setView] = useState("wizard");
    const [historyDate, setHistoryDate] = useState(getIstToday());
    const [dayEvents, setDayEvents] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [activeEvent, setActiveEvent] = useState(null);
    const [activeClass, setActiveClass] = useState(null);
    const [historyEditOn, setHistoryEditOn] = useState(false);
    const [historyDraft, setHistoryDraft] = useState({});
    const [historySaving, setHistorySaving] = useState(false);

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
            try {
                const plat = await getStudyLeavePlatforms();
                if (!cancelled) setPlatforms(Array.isArray(plat?.platforms) ? plat.platforms : []);
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

    const hasPlatforms = platforms.length > 0;
    const allClassOptions = classes.map(classNameOf).filter(Boolean);
    const activePlatform = platforms.find(p => p.id === platformKey) || null;
    const classOptions = hasPlatforms && platformKey && platformKey !== "all" && activePlatform
        ? allClassOptions.filter(c => activePlatform.classes.includes(c))
        : allClassOptions;
    // Steps stay faded until the one before them is done (from step 2 onward)
    const platformLocked = !sessionKey;
    const classesLocked = hasPlatforms ? !platformKey : !sessionKey;

    const pickPlatform = (key) => {
        setPlatformKey(key);
        if (!key || key === "all") return;
        const picked = platforms.find(p => p.id === key);
        if (picked) setSelectedClasses(prev => prev.filter(c => picked.classes.includes(c)));
    };

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
                const succeeded = [...unmarked, ...editableMarked];
                setReportCopied(false);
                setSubmitResult(buildSubmitSnapshot(succeeded));
                setStep("success");
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

    // ── Success popup (after a full successful submit) ──
    const buildSubmitSnapshot = (classNames) => {
        const classList = classNames.map(cls => {
            const list = studentsByClass[cls] || [];
            const att = attendanceByClass[cls] || {};
            const students = list.map(s => {
                const isHealth = s.healthStatus === 'S' || s.healthStatus === 'L';
                const status = isHealth ? (s.healthStatus === 'S' ? 'sick' : 'leave') : (att[String(s.id)] || "present");
                return { studentId: s.id, rollNo: s.rollNo, name: s.name, status };
            });
            const counts = { present: 0, absent: 0, special_leave: 0, sick: 0, leave: 0 };
            students.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
            return { name: cls, students, counts };
        });
        return { date, session: sessionKey, sessionLabel, power, classes: classList };
    };

    const handleCopyReport = async () => {
        if (!submitResult) return;
        const ok = await copyTextToClipboard(buildStudyLeaveReport(submitResult));
        if (ok) {
            playSound('attendanceSuccess');
            setReportCopied(true);
            setTimeout(() => setReportCopied(false), 2500);
        }
    };

    const handleDoneSuccess = () => {
        setSubmitResult(null);
        setReportCopied(false);
        setSuccessMsg("");
        setError("");
        setSelectedClasses([]);
        setStudentsByClass({});
        setAttendanceByClass({});
        setClassStatus({});
        setSessionKey("");
        setPlatformKey("");
        setShowConfirm(false);
        setView("wizard");
        setStep(1);
    };

    // ── History (day → event → class) ──
    const openHistory = () => {
        const d = getIstToday();
        setHistoryDate(d);
        setView("history");
        setActiveEvent(null);
        setActiveClass(null);
        loadDayHistory(d);
    };

    const loadDayHistory = async (d) => {
        setHistoryLoading(true);
        try {
            const res = await getStudyLeaveDayHistory(d);
            setDayEvents(res?.events || []);
        } catch (_) {
            setDayEvents([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const openHistoryEvent = (ev) => {
        setActiveEvent(ev);
        setActiveClass(null);
        setHistoryEditOn(false);
        setView("historyEvent");
    };

    const openHistoryClass = (cls) => {
        setActiveClass(cls);
        const draft = {};
        (cls.students || []).forEach(s => { draft[String(s.studentId)] = s.status; });
        setHistoryDraft(draft);
        setHistoryEditOn(false);
        setView("historyClass");
    };

    const startHistoryEdit = () => {
        const draft = {};
        (activeClass?.students || []).forEach(s => { draft[String(s.studentId)] = s.status; });
        setHistoryDraft(draft);
        setHistoryEditOn(true);
    };

    const toggleHistoryDraft = (student) => {
        if (!historyEditOn) return;
        const sid = String(student.studentId);
        const health = student.status === 'sick' || student.status === 'leave';
        if (health) return;
        setHistoryDraft(prev => {
            const current = prev[sid] || "present";
            const idx = STATUS_CYCLE.indexOf(current);
            return { ...prev, [sid]: STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] };
        });
    };

    const saveHistoryClass = async () => {
        if (!activeEvent || !activeClass) return;
        setHistorySaving(true);
        showLoader("Updating study leave...");
        setError("");
        try {
            const res = await editStudyLeaveAttendance(activeEvent.session, activeEvent.date, activeClass.name, historyDraft);
            if (res?.success) {
                playSound('attendanceSuccess');
                setHistoryEditOn(false);
                const fresh = await getStudyLeaveDayHistory(historyDate);
                const events = fresh?.events || [];
                setDayEvents(events);
                const sameEvent = events.find(e => e.period === activeEvent.period && String(e.teacherId) === String(activeEvent.teacherId) && e.time === activeEvent.time)
                    || events.find(e => e.period === activeEvent.period && String(e.teacherId) === String(activeEvent.teacherId));
                if (sameEvent) {
                    setActiveEvent(sameEvent);
                    const sameClass = sameEvent.classes.find(c => c.name === activeClass.name);
                    if (sameClass) {
                        setActiveClass(sameClass);
                        const draft = {};
                        sameClass.students.forEach(s => { draft[String(s.studentId)] = s.status; });
                        setHistoryDraft(draft);
                    }
                }
            } else {
                playSound('attendanceError');
                setError(res?.error || "Failed to update attendance.");
            }
        } catch (err) {
            playSound('attendanceError');
            setError(err.message);
        } finally {
            setHistorySaving(false);
            hideLoader();
        }
    };

    const handleBack = () => {
        if (view === "historyClass") { setView("historyEvent"); setHistoryEditOn(false); return; }
        if (view === "historyEvent") { setView("history"); setActiveEvent(null); setActiveClass(null); return; }
        if (view === "history") { setView("wizard"); return; }
        if (step === "success") { router.push("/"); return; }
        if (step === 2) setStep(1);
        else router.push("/");
    };

    if (loading) return <PencilLoader />;

    const sessions = setting?.sessions || [];
    const headerSub = view === "history"
        ? "History • Day Summary"
        : view === "historyEvent"
            ? `${activeEvent?.sessionLabel || ""}${activeEvent?.time ? ` • ${activeEvent.time}` : ""}`
            : view === "historyClass"
                ? `Class • ${activeClass?.name || ""}`
                : step === "success"
                    ? "✅ Attendance Marked"
                    : step === 1 ? "Step 1 • Select Classes" : `Step 2 • ${sessionLabel}`;
    const snapTotals = submitResult
        ? submitResult.classes.reduce(
            (acc, c) => ({
                students: acc.students + c.students.length,
                present: acc.present + c.counts.present,
                absent: acc.absent + c.counts.absent,
            }),
            { students: 0, present: 0, absent: 0 }
        )
        : null;
    const allMarked = selectedClasses.length > 0 && selectedClasses.every(cls => classStatus[cls]?.marked);
    const nothingEditable = selectedClasses.length > 0 && selectedClasses.every(cls => classStatus[cls]?.marked && !classStatus[cls]?.editable);

    return (
        <div className="min-h-screen bg-gray-50/50 pb-24 font-sans">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10 shadow-sm">
                <div className="max-w-md mx-auto flex justify-between items-center">
                    <button onClick={handleBack} className="text-gray-400 hover:text-gray-700 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center">
                        <h1 className="text-lg font-black">📚 Study Leave</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">
                            {headerSub}
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
                {successMsg && step !== "success" && <div className="p-4 bg-green-50 text-green-700 rounded-2xl text-sm font-bold border border-green-100">{successMsg}</div>}

                {step === "success" ? (
                    /* ── Success popup: Copy absentees / Done ── */
                    <div className="text-center pt-2 space-y-4 animate-fade-in">
                        <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-3xl animate-bounce text-emerald-600">✓</div>
                        <div>
                            <h2 className="text-xl font-black text-gray-900">Marked!</h2>
                            <p className="text-sm text-gray-500">
                                Study leave attendance saved for {(submitResult?.classes?.length || 0)} class{((submitResult?.classes?.length || 0) > 1 ? "es" : "")}.
                            </p>
                        </div>
                        {submitResult && snapTotals && (
                            <div className="rounded-3xl border border-gray-100 bg-white p-5 text-left shadow-sm space-y-3">
                                {[["Session", submitResult.sessionLabel], ["Date", formatDisplayDate(submitResult.date)], ["Classes", submitResult.classes.map(c => c.name).join(", ")]].map(([l, v]) => (
                                    <div key={l} className="flex justify-between py-2 border-b border-gray-50 last:border-0 gap-3">
                                        <span className="text-xs font-bold text-gray-400 uppercase shrink-0">{l}</span>
                                        <span className="text-sm font-black text-gray-800 text-right">{v}</span>
                                    </div>
                                ))}
                                <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                                    <div><p className="text-lg font-black text-gray-700">{snapTotals.students}</p><p className="text-[9px] font-bold text-gray-400 uppercase">Total</p></div>
                                    <div><p className="text-lg font-black text-emerald-600">{snapTotals.present}</p><p className="text-[9px] font-bold text-emerald-500 uppercase">Present</p></div>
                                    <div><p className="text-lg font-black text-red-500">{snapTotals.absent}</p><p className="text-[9px] font-bold text-red-400 uppercase">Absent</p></div>
                                </div>
                            </div>
                        )}
                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={handleCopyReport}
                                className="flex-1 rounded-2xl border border-slate-200 bg-white py-4 text-sm font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 transition-all active:scale-[0.98]"
                            >
                                {reportCopied ? "✓ Copied!" : "📋 Copy Absentees"}
                            </button>
                            <button
                                onClick={handleDoneSuccess}
                                className="flex-1 rounded-2xl bg-slate-700 py-4 text-sm font-black uppercase tracking-wider text-white hover:bg-slate-800 transition-all active:scale-[0.98]"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : view !== "wizard" ? (
                    /* ── History: day summary → marking event → class detail ── */
                    <>
                        {view === "history" && (
                            <>
                                <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">Date</label>
                                    <input
                                        type="date"
                                        value={historyDate}
                                        onChange={(e) => { const d = e.target.value || getIstToday(); setHistoryDate(d); loadDayHistory(d); }}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-slate-600/10 transition-all text-gray-800"
                                    />
                                </div>

                                {historyLoading ? (
                                    <p className="py-8 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Loading history...</p>
                                ) : dayEvents.length === 0 ? (
                                    <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 text-center">
                                        <p className="text-2xl mb-2">🗂️</p>
                                        <p className="text-xs font-black uppercase tracking-widest text-gray-400">No study leave markings on this day.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {dayEvents.map((ev, i) => (
                                            <button
                                                key={`${ev.period}-${ev.time || ""}-${ev.teacherId || ""}-${i}`}
                                                onClick={() => openHistoryEvent(ev)}
                                                className="w-full bg-white rounded-[2rem] shadow-sm border border-gray-100 p-5 text-left transition-all active:scale-95"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">{ev.sessionLabel}</p>
                                                        <p className="text-sm font-black text-gray-900 mt-0.5">
                                                            {ev.time ? ev.time : "Time not recorded"} • {ev.classCount} class{ev.classCount > 1 ? "es" : ""}
                                                        </p>
                                                        <p className="text-[11px] font-bold text-gray-400 mt-0.5">
                                                            Marked by {ev.teacherName}{ev.isMine ? " (you)" : ""}
                                                        </p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-xl font-black text-red-500 leading-none">{ev.totalAbsent}</p>
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1">Absent</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 mt-3">
                                                    {ev.classes.map(c => (
                                                        <span key={c.name} className="text-[9px] font-black uppercase tracking-widest bg-slate-50 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full">{c.name}</span>
                                                    ))}
                                                </div>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-300 mt-2 text-right">Tap to open ›</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {view === "historyEvent" && activeEvent && (
                            <>
                                <div className="bg-slate-700 rounded-[2rem] p-5 shadow-xl shadow-slate-300 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-white font-black text-sm">{activeEvent.sessionLabel}</p>
                                        <p className="text-slate-300 text-[10px] font-bold mt-0.5">
                                            {formatDisplayDate(activeEvent.date)}{activeEvent.time ? ` • ${activeEvent.time}` : ""} • {activeEvent.classCount} class{activeEvent.classCount > 1 ? "es" : ""}
                                        </p>
                                        <p className="text-slate-300 text-[10px] font-bold mt-0.5">Marked by {activeEvent.teacherName}{activeEvent.isMine ? " (you)" : ""}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-xl font-black text-white leading-none">{activeEvent.totalAbsent}</p>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-300 mt-1">Absent</p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {activeEvent.classes.map(cls => (
                                        <button
                                            key={cls.name}
                                            onClick={() => openHistoryClass(cls)}
                                            className="w-full bg-white rounded-[2rem] shadow-sm border border-gray-100 p-5 text-left flex items-center justify-between gap-3 transition-all active:scale-95"
                                        >
                                            <div className="min-w-0">
                                                <p className="font-black text-gray-900">{cls.name}</p>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">P {cls.counts.present}</span>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">A {cls.counts.absent}</span>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">SL {cls.counts.special_leave}</span>
                                                </div>
                                            </div>
                                            <span className="text-gray-300 shrink-0">›</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {view === "historyClass" && activeEvent && activeClass && (
                            <>
                                <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="font-black text-gray-900">{activeClass.name}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">P {activeClass.counts.present}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">A {activeClass.counts.absent}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">SL {activeClass.counts.special_leave}</span>
                                            </div>
                                        </div>
                                        {activeEvent.isMine ? (
                                            <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${historyEditOn ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                                {historyEditOn ? "Editing" : "Editable"}
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border bg-gray-50 text-gray-500 border-gray-200">Read only</span>
                                        )}
                                    </div>

                                    <div className="divide-y divide-gray-50">
                                        {(activeClass.students || []).map((student) => {
                                            const isHealth = student.status === 'sick' || student.status === 'leave';
                                            const st = isHealth ? student.status : (historyDraft[String(student.studentId)] || student.status);
                                            const cfg = statusConfig[st] || statusConfig.present;
                                            const disabled = isHealth || !historyEditOn;
                                            return (
                                                <div key={student.studentId} className={`p-4 flex items-center justify-between transition-colors ${st === "absent" ? "bg-red-50/10" : ""}`}>
                                                    <div className="flex items-center space-x-4 min-w-0">
                                                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black shrink-0 ${cfg.bg} ${cfg.text}`}>
                                                            {student.rollNo}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-bold text-gray-800 leading-tight truncate">{student.name || `Student #${student.studentId}`}</p>
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                                                                <p className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => toggleHistoryDraft(student)}
                                                        disabled={disabled}
                                                        className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border} ${disabled ? "opacity-70 cursor-not-allowed" : "active:scale-95"}`}
                                                    >
                                                        {cfg.label}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {activeEvent.isMine && !historyEditOn && (
                                    <button
                                        onClick={startHistoryEdit}
                                        className="w-full py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-700 active:scale-95 hover:bg-slate-50 transition-all"
                                    >
                                        ✏️ Edit Attendance
                                    </button>
                                )}

                                {historyEditOn && (
                                    <div className="flex gap-3 pt-1">
                                        <button
                                            onClick={() => setHistoryEditOn(false)}
                                            disabled={historySaving}
                                            className="flex-1 py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest bg-gray-100 text-gray-600 active:scale-95 disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={saveHistoryClass}
                                            disabled={historySaving}
                                            className="flex-1 py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest bg-slate-700 text-white hover:bg-slate-800 active:scale-95 disabled:opacity-50 shadow-lg shadow-slate-300"
                                        >
                                            {historySaving ? "Saving..." : "Save Changes"}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                ) : (
                    <>

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

                {step === 1 && (
                    <button
                        onClick={openHistory}
                        className="w-full py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-700 active:scale-95 hover:bg-slate-50 transition-all"
                    >
                        🗂️ History
                    </button>
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

                        {/* Platform select — narrows the class list */}
                        {hasPlatforms && (
                            <div className={`bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-3 transition-all ${platformLocked ? "opacity-40 pointer-events-none select-none" : ""}`}>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">3. Select Platform</label>
                                <div className="grid grid-cols-2 gap-2.5">
                                    {[{ id: "all", name: "All Platforms", classes: allClassOptions }, ...platforms].map(p => {
                                        const isSelected = platformKey === p.id;
                                        const classCount = p.id === "all" ? allClassOptions.length : p.classes.length;
                                        return (
                                            <button
                                                key={p.id}
                                                onClick={() => pickPlatform(p.id)}
                                                className={`p-4 rounded-2xl border text-left transition-all active:scale-95 ${isSelected ? "bg-slate-700 border-slate-700 shadow-lg shadow-slate-300" : "bg-white border-gray-100 hover:border-slate-300"}`}
                                            >
                                                <p className={`text-xs font-black leading-tight ${isSelected ? "text-white" : "text-gray-800"}`}>{p.name}</p>
                                                <p className={`text-[10px] font-bold mt-1 ${isSelected ? "text-slate-300" : "text-gray-400"}`}>{classCount} class{classCount === 1 ? "" : "es"}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                                {platformLocked && <p className="text-[10px] font-bold text-gray-400">Select a session first</p>}
                            </div>
                        )}

                        {/* Class multi-select */}
                        <div className={`bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 space-y-3 transition-all ${classesLocked ? "opacity-40 pointer-events-none select-none" : ""}`}>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">{hasPlatforms ? "4. Select Classes" : "3. Select Classes"}</label>

                            {classesLocked && <p className="text-[10px] font-bold text-gray-400">{hasPlatforms ? "Select a platform first" : "Select a session first"}</p>}

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
                                disabled={!sessionKey || (hasPlatforms && !platformKey) || selectedClasses.length === 0}
                                className={`w-full py-5 rounded-[2rem] text-lg font-black shadow-2xl transition-all active:scale-[0.98] ${!sessionKey || (hasPlatforms && !platformKey) || selectedClasses.length === 0 ? "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed" : "bg-slate-700 text-white shadow-slate-300 hover:bg-slate-800"}`}
                            >
                                {!sessionKey
                                    ? "Select a session"
                                    : hasPlatforms && !platformKey
                                        ? "Select a platform"
                                        : selectedClasses.length === 0
                                            ? "Select at least one class"
                                            : `Continue — ${selectedClasses.length} class${selectedClasses.length > 1 ? "es" : ""}`}
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
