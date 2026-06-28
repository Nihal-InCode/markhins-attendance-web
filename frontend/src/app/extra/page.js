"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getClasses, getStudents, getExtraSubjects, markExtraAttendance } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import PencilLoader from "@/components/PencilLoader";

const STATUS_CYCLE = ["present", "absent"];
const statusConfig = {
    present: { label: "Present", color: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    absent: { label: "Absent", color: "bg-red-500", text: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
};

export default function ExtraAttendancePage() {
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();
    const [step, setStep] = useState("setup");
    const [classes, setClasses] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [selectedClass, setSelectedClass] = useState("");
    const [selectedSubject, setSelectedSubject] = useState("");
    const [customSubject, setCustomSubject] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [loadingSetup, setLoadingSetup] = useState(true);
    const [setupError, setSetupError] = useState("");
    const [students, setStudents] = useState([]);
    const [attendance, setAttendance] = useState({});
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [summary, setSummary] = useState(null);

    useEffect(() => {
        async function load() {
            showLoader("Loading...");
            try {
                const [clsData, subData] = await Promise.all([getClasses(), getExtraSubjects()]);
                setClasses(Array.isArray(clsData) ? clsData : []);
                setSubjects(Array.isArray(subData) ? subData : []);
            } catch (err) { setSetupError(err.message); }
            finally { setLoadingSetup(false); hideLoader(); }
        }
        load();
    }, []);

    const effectiveSubject = customSubject.trim() !== "" ? customSubject.trim() : selectedSubject;

    const handleStartMarking = async () => {
        if (!selectedClass) return setSetupError("Select a class.");
        if (!effectiveSubject) return setSetupError("Select or type a subject.");
        setSetupError("");
        setLoadingStudents(true);
        showLoader("Loading students...");
        try {
            const data = await getStudents(selectedClass);
            const list = Array.isArray(data) ? data : [];
            setStudents(list);
            const initial = {};
            list.forEach((s) => (initial[s.id] = "present"));
            setAttendance(initial);
            setStep("marking");
        } catch (err) { setSetupError(err.message); }
        finally { setLoadingStudents(false); hideLoader(); }
    };

    const toggleStatus = (id) => {
        setAttendance((prev) => {
            const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(prev[id]) + 1) % STATUS_CYCLE.length];
            return { ...prev, [id]: next };
        });
    };

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        showLoader("Submitting...");
        setSubmitError("");
        try {
            const records = students.map((s) => ({ studentId: s.id, rollNo: s.rollNo || s.roll_no, status: attendance[s.id] || "present" }));
            const result = await markExtraAttendance({ classId: selectedClass, subject: effectiveSubject, period: "Extra", date, records });
            if (result.success !== false) { setSummary(result.data || result); setStep("success"); }
            else throw new Error(result.message || "Failed");
        } catch (err) { setSubmitError(err.message); }
        finally { setSubmitting(false); hideLoader(); }
    };

    const presentCount = students.filter((s) => attendance[s.id] === "present").length;
    const absentCount = students.length - presentCount;

    return (
        <div className="min-h-screen font-sans" style={{ backgroundColor: 'rgba(55, 151, 169, 0.04)' }}>

            {/* Header */}
            <div className="rounded-b-3xl px-4 pt-6 pb-8 sm:px-6" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
                <div className="mx-auto max-w-md">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => step === "marking" ? setStep("setup") : router.push("/")}
                            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 transition-all">← Back</button>
                        <span className="rounded-full bg-amber-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">⚡ Extra</span>
                    </div>
                    <h1 className="text-xl font-black text-white">
                        {step === "setup" ? "New Extra Class" : step === "marking" ? `${selectedClass} • ${effectiveSubject}` : "Done!"}
                    </h1>
                </div>
            </div>

            {/* Setup Step */}
            {step === "setup" && (
                <main className="mx-auto max-w-md px-4 py-6 space-y-5">
                    <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm space-y-5">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Class</label>
                            <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                <option value="">Select class</option>
                                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Subject</label>
                            <select value={selectedSubject} onChange={(e) => { setSelectedSubject(e.target.value); setCustomSubject(""); }}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                <option value="">Select subject</option>
                                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <input type="text" placeholder="Or type custom subject"
                                className="mt-2 w-full rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20"
                                value={customSubject} onChange={(e) => { setCustomSubject(e.target.value); if (e.target.value) setSelectedSubject(""); }} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Date</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                        </div>
                        {setupError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{setupError}</div>}
                        <button onClick={handleStartMarking} disabled={loadingStudents}
                            className="w-full rounded-2xl bg-[#0d9488] py-4 text-sm font-bold text-white hover:bg-[#0a7a70] disabled:opacity-50 transition-all shadow-lg shadow-[#0d9488]/20">
                            {loadingStudents ? "Loading..." : "Start Marking"}
                        </button>
                    </div>
                </main>
            )}

            {/* Marking Step */}
            {step === "marking" && (
                <main className="mx-auto max-w-md px-4 py-5 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                            <p className="text-2xl font-black text-emerald-600">{presentCount}</p>
                            <p className="text-[9px] font-bold text-emerald-500 uppercase">Present</p>
                        </div>
                        <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-center">
                            <p className="text-2xl font-black text-red-500">{absentCount}</p>
                            <p className="text-[9px] font-bold text-red-400 uppercase">Absent</p>
                        </div>
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-center">
                            <p className="text-2xl font-black text-gray-600">{students.length}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase">Total</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5">
                        <span className="text-amber-500">⚡</span>
                        <p className="text-xs font-bold text-amber-700">{effectiveSubject} • {date}</p>
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
                        {students.map((student) => {
                            const status = attendance[student.id] || "present";
                            const cfg = statusConfig[status];
                            return (
                                <div key={student.id} className={`p-4 flex items-center justify-between ${status === "absent" ? "bg-red-50/30" : ""}`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-black ${cfg.bg} ${cfg.text}`}>
                                            {student.rollNo || student.roll_no}
                                        </div>
                                        <p className="text-sm font-bold text-gray-800">{student.name}</p>
                                    </div>
                                    <button onClick={() => toggleStatus(student.id)}
                                        className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase border transition-all active:scale-95 ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                                        {cfg.label}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{submitError}</div>}

                    <button onClick={handleSubmit} disabled={submitting}
                        className={`w-full rounded-2xl py-4 text-sm font-bold transition-all shadow-lg ${submitting ? "bg-gray-200 text-gray-400 shadow-none" : "bg-[#0d9488] text-white hover:bg-[#0a7a70] shadow-[#0d9488]/20"}`}>
                        {submitting ? "Saving..." : "Submit Attendance"}
                    </button>
                </main>
            )}

            {/* Success Step */}
            {step === "success" && (
                <main className="mx-auto max-w-md px-4 py-10 space-y-5 text-center">
                    <div className="mx-auto h-16 w-16 rounded-2xl bg-[#0d9488]/10 flex items-center justify-center text-3xl">✓</div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900">Recorded!</h2>
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
                                <div><p className="text-lg font-black text-emerald-600">{summary.present ?? presentCount}</p><p className="text-[9px] font-bold text-emerald-500 uppercase">Present</p></div>
                                <div><p className="text-lg font-black text-red-500">{summary.absent ?? absentCount}</p><p className="text-[9px] font-bold text-red-400 uppercase">Absent</p></div>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <button onClick={() => { setStep("setup"); setSummary(null); setStudents([]); setAttendance({}); setSelectedClass(""); setSelectedSubject(""); setCustomSubject(""); setDate(new Date().toISOString().split("T")[0]); }}
                            className="flex-1 rounded-2xl border border-gray-200 bg-white py-4 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">New Class</button>
                        <button onClick={() => router.push("/")}
                            className="flex-1 rounded-2xl bg-gray-900 py-4 text-sm font-bold text-white hover:bg-black transition-all">Home</button>
                    </div>
                </main>
            )}
        </div>
    );
}
