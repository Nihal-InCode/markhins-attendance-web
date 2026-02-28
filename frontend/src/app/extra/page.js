"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getClasses, getStudents, getExtraSubjects, markExtraAttendance } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";

// ──────────────────────────────────────────
// STATUS CONFIG
// ──────────────────────────────────────────
const STATUS_CYCLE = ["present", "absent"];

const statusConfig = {
    present: {
        label: "Present",
        color: "bg-green-500",
        text: "text-green-600",
        bg: "bg-green-50",
        border: "border-green-100",
        badge: "🟢",
    },
    absent: {
        label: "Absent",
        color: "bg-red-500",
        text: "text-red-600",
        bg: "bg-red-50",
        border: "border-red-100",
        badge: "🔴",
    },
};

// ──────────────────────────────────────────
// EXTRA CLASS ATTENDANCE PAGE
// ──────────────────────────────────────────
export default function ExtraAttendancePage() {
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    // Setup state
    const [step, setStep] = useState("setup"); // "setup" | "marking" | "success"

    // Setup form
    const [classes, setClasses] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [selectedClass, setSelectedClass] = useState("");
    const [selectedSubject, setSelectedSubject] = useState("");
    const [customSubject, setCustomSubject] = useState("");
    const [selectedPeriod, setSelectedPeriod] = useState("Extra");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [loadingSetup, setLoadingSetup] = useState(true);
    const [setupError, setSetupError] = useState("");

    // Marking state
    const [students, setStudents] = useState([]);
    const [attendance, setAttendance] = useState({});
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    // Success state
    const [summary, setSummary] = useState(null);

    // Load classes & subjects on mount
    useEffect(() => {
        async function load() {
            showLoader("Loading setup data...");
            try {
                const [clsData, subData] = await Promise.all([
                    getClasses(),
                    getExtraSubjects(),
                ]);
                setClasses(Array.isArray(clsData) ? clsData : []);
                setSubjects(Array.isArray(subData) ? subData : []);
            } catch (err) {
                setSetupError("Failed to load setup data: " + err.message);
            } finally {
                setLoadingSetup(false);
                hideLoader();
            }
        }
        load();
    }, []);

    // The final subject to use (custom overrides dropdown)
    const effectiveSubject =
        customSubject.trim() !== "" ? customSubject.trim() : selectedSubject;

    // ──────────────────────────────────────────
    // HANDLERS
    // ──────────────────────────────────────────
    const handleStartMarking = async () => {
        if (!selectedClass) return setSetupError("Please select a class.");
        if (!effectiveSubject) return setSetupError("Please select or enter a subject.");
        setSetupError("");
        setLoadingStudents(true);
        showLoader("Loading students...");

        try {
            const data = await getStudents(selectedClass);
            const studentList = Array.isArray(data) ? data : [];
            setStudents(studentList);
            // Default everyone to present
            const initial = {};
            studentList.forEach((s) => (initial[s.id] = "present"));
            setAttendance(initial);
            setStep("marking");
        } catch (err) {
            setSetupError("Failed to load students: " + err.message);
        } finally {
            setLoadingStudents(false);
            hideLoader();
        }
    };

    const toggleStatus = (studentId) => {
        setAttendance((prev) => {
            const current = prev[studentId];
            const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
            return { ...prev, [studentId]: next };
        });
    };

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        showLoader("Submitting attendance...", { vibrate: true, playSuccessSound: true });
        setSubmitError("");

        try {
            const records = students.map((s) => ({
                studentId: s.id,
                rollNo: s.rollNo || s.roll_no,
                status: attendance[s.id] || "present",
            }));

            const result = await markExtraAttendance({
                classId: selectedClass,
                subject: effectiveSubject,
                period: selectedPeriod,
                date,
                records,
            });

            if (result.success !== false) {
                setSummary(result.data || result);
                setStep("success");
            } else {
                throw new Error(result.message || "Unknown error");
            }
        } catch (err) {
            setSubmitError("Error: " + err.message);
        } finally {
            setSubmitting(false);
            hideLoader();
        }
    };

    const presentCount = students.filter(
        (s) => attendance[s.id] === "present"
    ).length;
    const absentCount = students.length - presentCount;

    // ──────────────────────────────────────────
    // RENDER
    // ──────────────────────────────────────────
    return (
        <div className="min-h-screen bg-amber-50/40 font-sans text-gray-900 pb-24">
            {/* Header */}
            <header className="bg-white border-b border-amber-100 px-6 py-6 sticky top-0 z-20 shadow-sm">
                <div className="max-w-md mx-auto flex justify-between items-center">
                    <button
                        onClick={() => (step === "marking" ? setStep("setup") : router.push("/"))}
                        className="p-2 text-gray-400 hover:text-gray-700 transition-all"
                        aria-label="Back"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-6 w-6"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 19l-7-7 7-7"
                            />
                        </svg>
                    </button>
                    <div className="text-center">
                        <div className="inline-flex items-center gap-2 bg-amber-100 px-4 py-1.5 rounded-full mb-1">
                            <span className="text-amber-600 text-sm">⚡</span>
                            <span className="text-amber-700 text-[11px] font-black uppercase tracking-widest">
                                Extra Class
                            </span>
                        </div>
                        <h1 className="text-lg font-black text-gray-800">
                            {step === "setup"
                                ? "Setup Extra Class"
                                : step === "marking"
                                    ? `${selectedClass} • ${effectiveSubject}`
                                    : "Done!"}
                        </h1>
                    </div>
                    <div className="w-10" />
                </div>
            </header>

            {/* ── STEP: SETUP ── */}
            {step === "setup" && (
                <main className="max-w-md mx-auto px-6 py-8 space-y-6">
                    {/* Info Banner */}
                    <div className="bg-amber-500/10 border border-amber-200 rounded-[2rem] p-5 flex gap-4">
                        <div className="text-3xl select-none">⚡</div>
                        <div>
                            <p className="font-black text-amber-800 text-sm mb-0.5">
                                Extra Class Mode
                            </p>
                            <p className="text-amber-700 text-xs leading-relaxed">
                                This is <strong>outside the regular timetable</strong>. Select
                                the class and subject manually — no schedule is required.
                            </p>
                        </div>
                    </div>

                    {loadingSetup ? null : (
                        <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 p-7 space-y-7">
                            {/* Class */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">
                                    1. Select Class
                                </label>
                                <select
                                    className="w-full px-6 py-5 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-amber-100 outline-none text-xl font-bold transition-all appearance-none cursor-pointer"
                                    value={selectedClass}
                                    onChange={(e) => setSelectedClass(e.target.value)}
                                >
                                    <option value="">Choose Class</option>
                                    {classes.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Subject */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">
                                    2. Select Subject
                                </label>
                                <select
                                    className="w-full px-6 py-4 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-amber-100 outline-none text-base font-bold appearance-none cursor-pointer"
                                    value={selectedSubject}
                                    onChange={(e) => {
                                        setSelectedSubject(e.target.value);
                                        setCustomSubject("");
                                    }}
                                >
                                    <option value="">Choose Subject</option>
                                    {subjects.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Or type custom subject…"
                                        className="w-full px-6 py-4 rounded-3xl border border-dashed border-amber-200 bg-amber-50/50 focus:ring-4 focus:ring-amber-100 outline-none text-base font-bold transition-all"
                                        value={customSubject}
                                        onChange={(e) => {
                                            setCustomSubject(e.target.value);
                                            if (e.target.value) setSelectedSubject("");
                                        }}
                                    />
                                    {customSubject && (
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-500 text-xs font-black uppercase tracking-wide">
                                            Custom
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Period */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">
                                    3. Period Label <span className="text-gray-300">(Optional)</span>
                                </label>
                                <div className="flex gap-2 flex-wrap">
                                    {["Extra", "P1", "P2", "P3", "P4", "P5", "P6", "P7"].map(
                                        (p) => (
                                            <button
                                                key={p}
                                                onClick={() => setSelectedPeriod(p)}
                                                className={`px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border ${selectedPeriod === p
                                                    ? "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-100"
                                                    : "bg-gray-50 text-gray-500 border-gray-100 hover:border-amber-200"
                                                    }`}
                                            >
                                                {p}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            {/* Date */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">
                                    4. Date <span className="text-gray-300">(Auto: today)</span>
                                </label>
                                <input
                                    type="date"
                                    className="w-full px-6 py-4 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-amber-100 outline-none text-base font-bold cursor-pointer"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                            </div>

                            {/* Error */}
                            {setupError && (
                                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100">
                                    {setupError}
                                </div>
                            )}

                            {/* Start Button */}
                            <button
                                onClick={handleStartMarking}
                                disabled={loadingStudents}
                                className="w-full py-5 rounded-[2rem] text-lg font-black bg-amber-500 hover:bg-amber-600 text-white shadow-2xl shadow-amber-100 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loadingStudents ? "Loading Students…" : "⚡ Start Marking"}
                            </button>
                        </div>
                    )}
                </main>
            )}

            {/* ── STEP: MARKING ── */}
            {step === "marking" && (
                <main className="max-w-md mx-auto px-4 py-6 space-y-4">
                    {/* Stats bar */}
                    <div className="flex gap-3">
                        <div className="flex-1 bg-green-50 border border-green-100 rounded-3xl p-4 text-center">
                            <p className="text-2xl font-black text-green-600">{presentCount}</p>
                            <p className="text-[9px] font-black text-green-500 uppercase tracking-widest mt-0.5">
                                Present
                            </p>
                        </div>
                        <div className="flex-1 bg-red-50 border border-red-100 rounded-3xl p-4 text-center">
                            <p className="text-2xl font-black text-red-500">{absentCount}</p>
                            <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mt-0.5">
                                Absent
                            </p>
                        </div>
                        <div className="flex-1 bg-gray-50 border border-gray-100 rounded-3xl p-4 text-center">
                            <p className="text-2xl font-black text-gray-600">{students.length}</p>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                                Total
                            </p>
                        </div>
                    </div>

                    {/* Extra class badge */}
                    <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 border border-amber-100 rounded-2xl">
                        <span className="text-amber-500 text-base">⚡</span>
                        <p className="text-amber-700 text-xs font-black uppercase tracking-wider">
                            {effectiveSubject} • {selectedPeriod} • {date}
                        </p>
                    </div>

                    {/* Student list */}
                    <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                        <div className="divide-y divide-gray-50">
                            {students.map((student) => {
                                const status = attendance[student.id] || "present";
                                const cfg = statusConfig[status];
                                return (
                                    <div
                                        key={student.id}
                                        className={`p-5 flex items-center justify-between transition-colors ${status === "absent" ? "bg-red-50/30" : ""
                                            }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div
                                                className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black ${cfg.bg} ${cfg.text}`}
                                            >
                                                {student.rollNo || student.roll_no}
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-800 leading-tight">
                                                    {student.name}
                                                </p>
                                                <p
                                                    className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${cfg.text}`}
                                                >
                                                    {cfg.badge} {cfg.label}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleStatus(student.id)}
                                            className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border active:scale-95 ${cfg.bg} ${cfg.text} ${cfg.border}`}
                                        >
                                            Toggle
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {submitError && (
                        <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100">
                            {submitError}
                        </div>
                    )}

                    {/* Submit */}
                    <div className="pt-2">
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className={`w-full py-5 rounded-[2rem] text-lg font-black shadow-2xl transition-all active:scale-[0.98] ${submitting
                                ? "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed"
                                : "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-100"
                                }`}
                        >
                            {submitting ? "Saving…" : "⚡ Submit Extra Class"}
                        </button>
                    </div>
                </main>
            )}

            {/* ── STEP: SUCCESS ── */}
            {step === "success" && (
                <main className="max-w-md mx-auto px-6 py-12 space-y-6 text-center">
                    <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center text-5xl mx-auto shadow-xl shadow-amber-100">
                        ⚡
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-800 mb-1">
                            Extra Class Recorded!
                        </h2>
                        <p className="text-gray-500 text-sm font-medium">
                            Attendance saved to the <strong>extra_classes</strong> table.
                        </p>
                    </div>

                    {summary && (
                        <div className="bg-white border border-gray-100 rounded-[2.5rem] p-7 shadow-sm text-left space-y-4">
                            <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    Summary
                                </span>
                                <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
                                    Extra Class
                                </span>
                            </div>
                            <div className="space-y-3 text-sm font-bold">
                                <Row label="Class" value={summary.class || selectedClass} />
                                <Row label="Subject" value={summary.subject || effectiveSubject} />
                                <Row label="Period" value={summary.period || selectedPeriod} />
                                <Row label="Date" value={summary.date || date} />
                                <div className="pt-3 border-t border-gray-50 grid grid-cols-3 gap-3 text-center">
                                    <Stat label="Total" value={summary.total ?? students.length} color="text-gray-700" />
                                    <Stat label="Present" value={summary.present ?? presentCount} color="text-green-600" />
                                    <Stat label="Absent" value={summary.absent ?? absentCount} color="text-red-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => {
                                setStep("setup");
                                setSummary(null);
                                setStudents([]);
                                setAttendance({});
                                setSelectedClass("");
                                setSelectedSubject("");
                                setCustomSubject("");
                                setSelectedPeriod("Extra");
                                setDate(new Date().toISOString().split("T")[0]);
                            }}
                            className="flex-1 py-4 rounded-[2rem] font-black text-sm bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all active:scale-95"
                        >
                            Mark Another
                        </button>
                        <button
                            onClick={() => router.push("/")}
                            className="flex-1 py-4 rounded-[2rem] font-black text-sm bg-gray-900 text-white hover:bg-gray-800 transition-all active:scale-95 shadow-xl shadow-gray-200"
                        >
                            Home
                        </button>
                    </div>
                </main>
            )}
        </div>
    );
}

// ──────────────────────────────────────────
// SMALL HELPERS
// ──────────────────────────────────────────
function Row({ label, value }) {
    return (
        <div className="flex justify-between">
            <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">
                {label}
            </span>
            <span className="text-gray-800 font-black text-sm">{value}</span>
        </div>
    );
}

function Stat({ label, value, color }) {
    return (
        <div>
            <p className={`text-xl font-black ${color}`}>{value}</p>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                {label}
            </p>
        </div>
    );
}
