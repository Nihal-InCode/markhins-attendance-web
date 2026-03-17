"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { markHealthStatus, getClasses, getStudents, getSickList, getLeaveList } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { useLoading } from "@/context/LoadingContext";

const HEALTH_ACTIONS = [
    { id: 'sick', label: 'Mark Sick', emoji: '💊', color: 'bg-orange-500', desc: 'Unwell' },
    { id: 'leave', label: 'Mark Leave', emoji: '🏠', color: 'bg-purple-500', desc: 'Planned' },
    { id: 'cure', label: 'Mark Cure', emoji: '💊', color: 'bg-green-500', desc: 'Recovered' },
    { id: 'return', label: 'Mark Return', emoji: '🎒', color: 'bg-blue-600', desc: 'Returned' },
];

export default function HealthPage() {
    const [classes, setClasses] = useState([]);
    const [students, setStudents] = useState([]);
    const [selectedClass, setSelectedClass] = useState("");
    const [selectedStudents, setSelectedStudents] = useState([]); // Array of student objects
    const [searchQuery, setSearchQuery] = useState("");
    const [filterTab, setFilterTab] = useState("all");
    const [selectedAction, setSelectedAction] = useState(null);

    const [loading, setLoading] = useState(false);
    const [studentsLoading, setStudentsLoading] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [viewingHealthList, setViewingHealthList] = useState(null); // 'sick' or 'leave' or null
    const [healthListData, setHealthListData] = useState(null);
    const [healthListLoading, setHealthListLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const studentListRef = useRef(null);

    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    // Role-based logic
    const isPrincipal = user?.role === 'Principal' || user?.role === 'Vice Principal';
    const isClassTeacher = user?.role === 'Class Teacher';
    const assignedClass = user?.class_teacher_of;

    // Initial load: Classes
    useEffect(() => {
        // If Class Teacher, auto-select their class and stop
        if (isClassTeacher && assignedClass && !isPrincipal) {
            setSelectedClass(assignedClass);
            return;
        }

        async function fetchClasses() {
            showLoader("Loading classes...");
            try {
                const data = await getClasses();
                setClasses(data);
            } catch (err) {
                setError("Failed to load classes.");
            } finally {
                hideLoader();
            }
        }
        fetchClasses();
    }, [isClassTeacher, assignedClass, isPrincipal]);

    const fetchStudents = async () => {
        if (!selectedClass) {
            setStudents([]);
            setSelectedStudents([]);
            return;
        }
        setStudentsLoading(true);
        showLoader("Loading students...");
        try {
            const data = await getStudents(selectedClass);
            setStudents(data);
        } catch (err) {
            setError("Failed to load students.");
        } finally {
            setStudentsLoading(false);
            hideLoader();
        }
    };

    // Load students when class changes
    useEffect(() => {
        if (!selectedClass) {
            setStudents([]);
            setSelectedStudents([]);
            return;
        }
        setSelectedStudents([]);
        setSearchQuery("");
        fetchStudents();
    }, [selectedClass]);

    // Filter students by search and tab
    const filteredStudents = useMemo(() => {
        let list = students;

        if (filterTab === 'sick') list = list.filter(s => s.health_status === 'S');
        if (filterTab === 'leave') list = list.filter(s => s.health_status === 'L');

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.rollNo.toString().includes(q)
            );
        }
        return list;
    }, [students, searchQuery, filterTab]);

    const toggleStudent = (student) => {
        setSelectedStudents(prev => {
            const exists = prev.find(s => s.id === student.id);
            if (exists) return prev.filter(s => s.id !== student.id);
            return [...prev, student];
        });
    };

    const handleSubmit = async () => {
        if (selectedStudents.length === 0 || !selectedAction) return;

        // ── CROSS-MARKING VALIDATION ──
        let validationError = null;
        for (const student of selectedStudents) {
            const status = student.health_status;

            if (selectedAction.id === 'cure' && status === 'L') {
                validationError = `Student ${student.name} is on LEAVE, not SICK. Use 'Mark Return' instead.`;
                break;
            }
            if (selectedAction.id === 'return' && status === 'S') {
                validationError = `Student ${student.name} is SICK, not on LEAVE. Use 'Mark Cure' instead.`;
                break;
            }
            if (selectedAction.id === 'cure' && !status) {
                validationError = `Student ${student.name} is not marked as Sick. Cannot perform 'Cure'.`;
                break;
            }
            if (selectedAction.id === 'return' && !status) {
                validationError = `Student ${student.name} is not marked as on Leave. Cannot perform 'Return'.`;
                break;
            }
            // Block marking sick if already leave, etc.
            if (selectedAction.id === 'sick' && status === 'L') {
                validationError = `${student.name} is already marked as Leave. Clear Leave status first.`;
                break;
            }
            if (selectedAction.id === 'leave' && status === 'S') {
                validationError = `${student.name} is already marked as Sick. Clear Sick status first.`;
                break;
            }
        }

        if (validationError) {
            playSound('error');
            setError(validationError);
            return;
        }

        setLoading(true);
        showLoader("Updating status...", { vibrate: true });
        setError(null);
        setShowConfirm(false);

        try {
            const rollNos = selectedStudents.map(s => s.rollNo);
            const result = await markHealthStatus(selectedAction.id, rollNos, selectedClass);

            if (result.success) {
                playSound('attendanceSuccess');
                setLastResult({
                    action: selectedAction,
                    students: selectedStudents,
                    reply: result.reply || result.message
                });
                setShowSuccess(true);
                setSelectedStudents([]);
                setSearchQuery("");
                setSelectedAction(null);
                fetchStudents(); // Refresh student statuses immediately
            } else {
                playSound('error');
                const errorMsg = result.error || result.reply || result.message || "Failed to update status.";
                setError(errorMsg);
            }
        } catch (err) {
            playSound('error');
            setError(err.message || "Network error. Please check if server is running.");
        } finally {
            setLoading(false);
            hideLoader();
        }
    };

    const handleViewHealthList = async (type) => {
        setHealthListLoading(true);
        showLoader(`Fetching ${type} list...`);
        setViewingHealthList(type);
        setHealthListData(null);
        try {
            const res = type === 'sick' ? await getSickList() : await getLeaveList();
            if (res.success) {
                setHealthListData(res);
            } else {
                setError(res.error || "Failed to fetch list.");
                setViewingHealthList(null);
            }
        } catch (err) {
            setError("Connectivity error.");
            setViewingHealthList(null);
        } finally {
            setHealthListLoading(false);
            hideLoader();
        }
    };

    // Auto-scroll logic for Cure/Return
    useEffect(() => {
        if (!selectedAction || !studentListRef.current) return;

        const targetStatus = selectedAction.id === 'cure' ? 'S' : (selectedAction.id === 'return' ? 'L' : null);
        if (!targetStatus) return;

        const firstStudent = filteredStudents.find(s => s.health_status === targetStatus);
        if (firstStudent) {
            const el = document.getElementById(`student-card-${firstStudent.id}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [selectedAction, filteredStudents]);

    return (
        <div className="h-screen bg-gray-50/50 flex flex-col font-sans overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-30 shadow-sm">
                <div className="max-w-md mx-auto flex justify-between items-center">
                    <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-700 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center">
                        <h1 className="text-lg font-black text-gray-800 tracking-tight">Leave Status</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500">
                            Status Management
                        </p>
                    </div>
                    <div className="w-6" />
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-6 py-8 space-y-8 animate-in fade-in duration-500 custom-scrollbar pb-32">
                <div className="max-w-md mx-auto space-y-8">
                    {error && (
                        <div className="p-5 rounded-[2rem] border bg-red-50 text-red-600 border-red-100 animate-in slide-in-from-top-2">
                            <div className="flex gap-3 items-center">
                                <span className="text-xl">⚠️</span>
                                <p className="text-sm font-bold">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* CAMPUS HEALTH OVERVIEW (ANALYTICS) - Only for Principal/CT */}
                    {(isPrincipal || isClassTeacher) && (
                        <section className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-2">
                                Campus Health Overview
                            </label>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => handleViewHealthList('sick')}
                                    className="relative p-6 bg-gradient-to-br from-orange-50 to-white border border-orange-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 overflow-hidden group"
                                >
                                    <div className="absolute -top-4 -right-4 opacity-[0.05] text-7xl group-hover:scale-110 transition-transform duration-300">💊</div>
                                    <div className="relative flex flex-col items-start gap-1 z-10">
                                        <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-500 flex items-center justify-center text-xl mb-2 shadow-sm">💊</div>
                                        <span className="font-black text-sm text-gray-800">Sick List</span>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-orange-500">View Active</span>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleViewHealthList('leave')}
                                    className="relative p-6 bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 overflow-hidden group"
                                >
                                    <div className="absolute -top-4 -right-4 opacity-[0.05] text-7xl group-hover:scale-110 transition-transform duration-300">🏠</div>
                                    <div className="relative flex flex-col items-start gap-1 z-10">
                                        <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center text-xl mb-2 shadow-sm">🏠</div>
                                        <span className="font-black text-sm text-gray-800">Leave List</span>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-purple-500">Planned Absence</span>
                                    </div>
                                </button>
                            </div>
                        </section>
                    )}

                    {/* 1. SELECT CLASS */}
                    {(isPrincipal || !isClassTeacher) ? (
                        <section className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-2">
                                Step 1: Select Class {isPrincipal && "(Admin View)"}
                            </label>
                            <select
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full p-6 bg-white border border-gray-100 rounded-[2.5rem] text-lg font-black text-gray-800 shadow-sm focus:ring-4 focus:ring-red-50 outline-none transition-all"
                            >
                                <option value="">Select a class...</option>
                                {classes.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </section>
                    ) : (
                        <section className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-2">
                                Managing Class
                            </label>
                            <div className="w-full p-6 bg-red-50 border border-red-100 rounded-[2.5rem] flex items-center justify-between">
                                <span className="text-xl font-black text-red-600">{selectedClass}</span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Class Teacher</span>
                            </div>
                        </section>
                    )}

                    {/* 2. SELECT STUDENTS */}
                    {selectedClass && (
                        <section className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                            <div className="flex justify-between items-end px-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                    Step 2: Select Students
                                </label>
                            </div>

                            <div className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur-md pt-2 pb-3 -mx-2 px-2 space-y-3">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Search students..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full p-4 pl-12 bg-white border border-gray-100 rounded-[2rem] text-sm font-bold text-gray-800 shadow-sm focus:ring-4 focus:ring-red-50 outline-none transition-all placeholder:text-gray-300"
                                    />
                                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                    </div>
                                </div>

                                {/* Filter Tabs */}
                                <div className="flex gap-1 p-1 bg-white border border-gray-100 rounded-full shadow-sm">
                                    {['all', 'sick', 'leave'].map(tab => (
                                        <button
                                            key={tab}
                                            onClick={() => setFilterTab(tab)}
                                            className={`flex-1 py-2 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${filterTab === tab ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                                        >
                                            {tab === 'all' ? `All (${students.length})` :
                                                tab === 'sick' ? `Sick (${students.filter(s => s.health_status === 'S').length})` :
                                                    `Leave (${students.filter(s => s.health_status === 'L').length})`}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2 grid grid-cols-1 gap-2 p-1 relative z-10 pb-40">
                                {studentsLoading ? null : filteredStudents.length > 0 ? (
                                    filteredStudents.map(student => {
                                        const isSelected = selectedStudents.some(s => s.id === student.id);
                                        const isSick = student.health_status === 'S';
                                        const isLeave = student.health_status === 'L';

                                        let bgClass = 'bg-white border-gray-50 hover:border-gray-200';
                                        if (isSelected) bgClass = 'bg-red-50 border-red-200 scale-[0.98] shadow-sm ring-2 ring-red-100';
                                        else if (isSick) bgClass = 'bg-red-50/50 border-red-100 shadow-sm';
                                        else if (isLeave) bgClass = 'bg-orange-50/50 border-orange-100 shadow-sm';

                                        return (
                                            <button
                                                key={student.id}
                                                id={`student-card-${student.id}`}
                                                onClick={() => toggleStudent(student)}
                                                className={`flex items-center gap-4 p-4 rounded-3xl border transition-all text-left group ${bgClass}`}
                                            >
                                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs transition-colors ${isSelected ? 'bg-red-500 text-white shadow-lg' :
                                                    isSick ? 'bg-red-100 text-red-600' :
                                                        isLeave ? 'bg-orange-100 text-orange-600' :
                                                            'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    {student.rollNo}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-bold text-sm text-gray-800">{student.name}</p>
                                                        {isSick && <span className="px-2 py-0.5 bg-red-100 text-[8px] font-black text-red-600 rounded-lg uppercase tracking-widest animate-pulse">Sick</span>}
                                                        {isLeave && <span className="px-2 py-0.5 bg-orange-100 text-[8px] font-black text-orange-600 rounded-lg uppercase tracking-widest animate-pulse">On Leave</span>}
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 uppercase font-black">Roll {student.rollNo}</p>
                                                </div>
                                                {isSelected && (
                                                    <div className="text-red-500 mr-2 animate-in zoom-in duration-200">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="p-8 text-center text-gray-400 font-bold">No results.</div>
                                )}
                            </div>
                        </section>
                    )}

                </div>
            </main>

            {/* FLOATING ACTION BOTTOM BAR */}
            {selectedStudents.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 shadow-[0_-20px_40px_-15px_rgba(0,0,0,0.1)] z-40 rounded-t-[2.5rem] animate-in slide-in-from-bottom-full duration-300">
                    <div className="max-w-md mx-auto p-5 pb-8 space-y-4">
                        <div className="flex justify-between items-center px-2">
                            <h3 className="font-black text-gray-800 text-lg flex items-center">
                                <span className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-[11px] mr-2 shadow-sm">{selectedStudents.length}</span>
                                Selected
                            </h3>
                            <button onClick={() => setSelectedStudents([])} className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors">
                                Clear Selection
                            </button>
                        </div>

                        {/* Selected Chips */}
                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2 no-scrollbar px-2 -mx-2">
                            {selectedStudents.map(s => (
                                <div key={s.id} className="flex-none bg-white border border-gray-200 shadow-sm text-gray-700 pl-4 pr-1 py-1.5 rounded-full text-xs font-bold flex items-center gap-2">
                                    {s.name}
                                    <button onClick={(e) => { e.stopPropagation(); toggleStudent(s); }} className="w-6 h-6 rounded-full bg-gray-50 hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-gray-400 transition-colors">
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Quick Actions Grid */}
                        <div className="grid grid-cols-4 gap-2 bg-gray-50/50 p-2 rounded-[2rem] border border-gray-100">
                            {HEALTH_ACTIONS.map(action => {
                                const isTargeted = (action.id === 'cure' && selectedStudents.some(s => s.health_status === 'S')) ||
                                    (action.id === 'return' && selectedStudents.some(s => s.health_status === 'L')) ||
                                    (action.id === 'sick' && selectedStudents.every(s => !s.health_status)) ||
                                    (action.id === 'leave' && selectedStudents.every(s => !s.health_status));

                                return (
                                    <button
                                        key={action.id}
                                        onClick={() => {
                                            setSelectedAction(action);
                                            setTimeout(() => setShowConfirm(true), 100);
                                        }}
                                        className="relative flex flex-col items-center justify-center gap-2 p-3 rounded-[1.5rem] hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition-all active:scale-95 group"
                                    >
                                        {isTargeted && (
                                            <div className="absolute top-2 right-3 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping z-10" />
                                        )}
                                        <div className={`w-12 h-12 rounded-[1.25rem] flex items-center justify-center text-2xl shadow-sm group-hover:shadow-md transition-shadow ${action.color} text-white`}>
                                            {action.emoji}
                                        </div>
                                        <span className="text-[9px] font-black text-gray-600 uppercase tracking-wide leading-tight text-center">
                                            {action.label.replace('Mark ', '')}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* CONFIRMATION MODAL */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-sm rounded-[3rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="text-center space-y-4">
                            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl shadow-xl ${selectedAction.color} text-white`}>
                                {selectedAction.emoji}
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-gray-800">Final Confirmation</h3>
                                <p className="text-sm text-gray-400 font-bold mt-2 leading-relaxed px-4">
                                    Marking <span className="text-red-500">{selectedStudents.length} students</span> as <span className="text-gray-800 font-black">{selectedAction.label}</span>?
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-col items-center gap-4 mt-8 pb-4">
                            <button
                                onClick={handleSubmit}
                                disabled={loading}
                                className={`w-full py-5 rounded-[2rem] text-white font-black text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${selectedAction.color} hover:brightness-110`}
                            >
                                {loading ? 'Processing...' : 'Confirm Action'}
                            </button>

                            <button
                                onClick={() => setShowConfirm(false)}
                                disabled={loading}
                                className="w-full py-4 rounded-[2rem] bg-gray-50 text-gray-500 font-bold text-xs uppercase tracking-widest hover:bg-gray-100 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SUCCESS MODAL */}
            {showSuccess && lastResult && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-sm rounded-[3rem] p-10 shadow-2xl animate-in slide-in-from-bottom-10 duration-500">
                        <div className="text-center space-y-6">
                            <div className="w-24 h-24 mx-auto rounded-full bg-green-500 flex items-center justify-center text-5xl shadow-2xl shadow-green-100 text-white animate-bounce-short">
                                ✅
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-black text-gray-800">Recording Success!</h2>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{lastResult.action.label} Marked</p>
                            </div>
                            <div className="bg-gray-50 rounded-[2rem] p-6 max-h-40 overflow-y-auto border border-gray-100 text-left space-y-2">
                                {lastResult.students.map(s => (
                                    <div key={s.id} className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-lg bg-green-500 flex items-center justify-center text-[8px] font-black text-white">{s.rollNo}</div>
                                        <span className="text-sm font-bold text-gray-700">{s.name}</span>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => setShowSuccess(false)}
                                className="w-full py-5 rounded-[2rem] bg-gray-900 text-white font-black shadow-xl hover:bg-black transition-all active:scale-95"
                            >
                                Nice! Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* HEALTH LIST MODAL */}
            {viewingHealthList && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-2xl font-black text-gray-800">
                                    {viewingHealthList === 'sick' ? 'Sick Students' : 'Students on Leave'}
                                </h3>
                                {healthListData && (
                                    <p className="text-[10px] font-black uppercase tracking-widest text-red-500 mt-1">
                                        Total Active: {healthListData.total_count}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => { setViewingHealthList(null); setHealthListData(null); }}
                                className="p-2 hover:bg-gray-50 rounded-full transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                            {healthListLoading ? null : healthListData?.health_list?.length > 0 ? (
                                healthListData.health_list.map(group => (
                                    <div key={group.class} className="space-y-3">
                                        <div className="flex items-center gap-3 px-2">
                                            <div className="h-[2px] flex-1 bg-gray-50" />
                                            <span className="text-sm font-black text-gray-800">{group.class}</span>
                                            <div className="h-[2px] flex-1 bg-gray-50" />
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            {group.students.map(student => (
                                                <div key={student.roll_no} className="flex items-center gap-3 p-4 bg-gray-50/50 rounded-2xl border border-gray-50">
                                                    <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center text-[10px] font-black text-gray-500 border border-gray-100">
                                                        {student.roll_no}
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-800">{student.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-12 text-center space-y-4">
                                    <div className="text-5xl opacity-20">🍃</div>
                                    <p className="text-sm font-bold text-gray-400">
                                        No active {viewingHealthList} students found.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="mt-8">
                            <button
                                onClick={() => { setViewingHealthList(null); setHealthListData(null); }}
                                className="w-full py-5 rounded-[2rem] bg-gray-900 text-white font-black hover:bg-black transition-all shadow-xl active:scale-95"
                            >
                                Close Overview
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #eee; border-radius: 10px; }
                .animate-bounce-short { animation: bounce-short 1s infinite ease-in-out; }
            `}</style>
        </div>
    );
}
