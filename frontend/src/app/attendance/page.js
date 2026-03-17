"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStudents, markAttendance, editLastAttendance } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";


// ─────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────
const STATUS_CYCLE = ["present", "absent"];


const statusConfig = {
    present: { label: "Present", color: "bg-green-500", text: "text-green-600", bg: "bg-green-50", border: "border-green-100", dot: "bg-green-500" },
    absent: { label: "Absent", color: "bg-red-500", text: "text-red-500", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500" },
    sick: { label: "Sick", color: "bg-orange-500", text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100", dot: "bg-orange-500" },
    leave: { label: "On Leave", color: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", dot: "bg-amber-500" },
};


// ─────────────────────────────────────────────
// CONFIRMATION MODAL
// ─────────────────────────────────────────────
function ConfirmationModal({ params, students, attendance, onGoHome }) {
    const groups = { present: [], absent: [], sick: [], leave: [] };

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
                            {params?.subjectName} • {params?.period?.replace("P", "Period ")} • {params?.date}
                        </p>
                    </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-5 space-y-4 pb-6">
                    {[
                        { key: "sick", ...statusConfig.sick },
                        { key: "leave", ...statusConfig.leave },
                        { key: "absent", ...statusConfig.absent },
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
export default function AttendancePage() {
    const [params, setParams] = useState(null);
    const [students, setStudents] = useState([]);
    const [attendance, setAttendance] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showConfirm, setShowConfirm] = useState(false);
    const { showLoader, hideLoader } = useLoading();
    const router = useRouter();

    useEffect(() => {
        const stored = sessionStorage.getItem("attendance_params");
        if (!stored) { router.push("/"); return; }
        const parsed = JSON.parse(stored);
        setParams(parsed);
        fetchStudents(parsed.classId, parsed.isEdit ? parsed : null);
    }, [router]);

    async function fetchStudents(classId, editParams = null) {
        showLoader("Loading students...");
        try {
            const data = await getStudents(classId);
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
                                    if (r.status === 'present' || r.status === 'absent') {
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
        // PART 2: Disable override for Sick/Leave
        if (student?.healthStatus === 'S' || student?.healthStatus === 'L') return;

        setAttendance((prev) => {
            const current = prev[studentId];
            const nextIndex = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
            return { ...prev, [studentId]: STATUS_CYCLE[nextIndex] };
        });
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        showLoader(params?.isEdit ? "Updating records..." : "Submitting attendance...", { vibrate: true, playSuccessSound: true });
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
                    records,
                });

                if (result.duplicate) {
                    playSound('attendanceError');
                    setError(`⚠️ Attendance already marked. Use Edit on Home screen.`);
                    return;
                }

                if (result.success) {
                    playSound('attendanceSuccess');
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
    const counts = { present: 0, absent: 0, sick: 0, leave: 0 };
    students.forEach((s) => {
        if (s.healthStatus === 'S') counts.sick++;
        else if (s.healthStatus === 'L') counts.leave++;
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
                            {params?.subjectName} • Period {params?.period?.replace("P", "")}
                        </p>
                    </div>
                    <div className="w-6" />
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 py-6 space-y-4">
                {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100">{error}</div>}

                {/* Counts bar */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 border border-green-100 rounded-3xl py-4 text-center">
                        <p className="text-2xl font-black text-green-600">{counts.present}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-600 opacity-70">Present</p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-3xl py-4 text-center">
                        <p className="text-2xl font-black text-red-500">{counts.absent + counts.sick + counts.leave}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500 opacity-70">Total Absent</p>
                    </div>
                </div>

                {/* Student list */}
                <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
                    {students.map((student) => {
                        const isHealth = student.healthStatus === 'S' || student.healthStatus === 'L';
                        const st = isHealth ? (student.healthStatus === 'S' ? 'sick' : 'leave') : (attendance[student.id] || "present");
                        const cfg = statusConfig[st] || statusConfig.present;

                        return (
                            <div
                                key={student.id}
                                className={`p-4 flex items-center justify-between transition-colors ${st === "absent" ? "bg-red-50/10" : isHealth ? "bg-gray-50/30" : ""}`}
                            >
                                <div className="flex items-center space-x-4">
                                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black ${cfg.bg} ${cfg.text}`}>
                                        {student.rollNo}
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-800 leading-tight">{student.name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${isHealth ? 'animate-pulse' : ''}`} />
                                            <p className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>
                                                {cfg.label}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {isHealth ? (
                                    <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border ${cfg.bg} ${cfg.text} ${cfg.border} flex items-center gap-1.5`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                        Locked
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => toggleStatus(student.id)}
                                        className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${cfg.bg} ${cfg.text} ${cfg.border} border active:scale-95`}
                                    >
                                        {st === 'present' ? 'Present' : 'Absent'}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

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
