"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { markHealthStatus, getClasses, getStudents, getSickList, getLeaveList } from "@/lib/api";

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
            try {
                const data = await getClasses();
                setClasses(data);
            } catch (err) {
                setError("Failed to load classes.");
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
        try {
            const data = await getStudents(selectedClass);
            setStudents(data);
        } catch (err) {
            setError("Failed to load students.");
        } finally {
            setStudentsLoading(false);
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

    // Filter students by search
    const filteredStudents = useMemo(() => {
        if (!searchQuery) return students;
        const q = searchQuery.toLowerCase();
        return students.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.rollNo.toString().includes(q)
        );
    }, [students, searchQuery]);

    const toggleStudent = (student) => {
        setSelectedStudents(prev => {
            const exists = prev.find(s => s.id === student.id);
            if (exists) return prev.filter(s => s.id !== student.id);
            return [...prev, student];
        });
    };

    const handleSubmit = async () => {
        if (selectedStudents.length === 0 || !selectedAction) return;

        setLoading(true);
        setError(null);
        setShowConfirm(false);

        try {
            const rollNos = selectedStudents.map(s => s.rollNo);
            const result = await markHealthStatus(selectedAction.id, rollNos, selectedClass);

            if (result.success) {
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
                const errorMsg = result.error || result.reply || result.message || "Failed to update status.";
                setError(errorMsg);
            }
        } catch (err) {
            setError(err.message || "Network error. Please check if server is running.");
        } finally {
            setLoading(false);
        }
    };

    const handleViewHealthList = async (type) => {
        setHealthListLoading(true);
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
        <div className="min-h-screen bg-gray-50/50 pb-12 font-sans overflow-x-hidden">
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

            <main className="max-w-md mx-auto px-6 py-8 space-y-8 animate-in fade-in duration-500">
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
                                className="p-6 bg-white border border-orange-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 group"
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-2xl group-hover:scale-110 transition-transform w-fit">💊</span>
                                    <span className="font-black text-sm text-gray-800">Sick List</span>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-orange-400">View Active</span>
                                </div>
                            </button>
                            <button
                                onClick={() => handleViewHealthList('leave')}
                                className="p-6 bg-white border border-purple-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 group"
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-2xl group-hover:scale-110 transition-transform w-fit">🏠</span>
                                    <span className="font-black text-sm text-gray-800">Leave List</span>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-purple-400">Planned absence</span>
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
                                Step 2: Select Students ({selectedStudents.length})
                            </label>
                            {selectedStudents.length > 0 && (
                                <button
                                    onClick={() => setSelectedStudents([])}
                                    className="text-[10px] font-black text-red-500 uppercase tracking-widest"
                                >
                                    Clear All
                                </button>
                            )}
                        </div>

                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search students..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full p-6 pl-14 bg-white border border-gray-100 rounded-[2.5rem] text-lg font-bold text-gray-800 shadow-sm focus:ring-4 focus:ring-red-50 outline-none transition-all"
                            />
                            <div className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>

                        <div
                            ref={studentListRef}
                            className="max-h-64 overflow-y-auto pr-2 space-y-2 grid grid-cols-1 gap-2 custom-scrollbar"
                        >
                            {studentsLoading ? (
                                <div className="p-8 text-center text-gray-300 font-bold animate-pulse">Loading list...</div>
                            ) : filteredStudents.length > 0 ? (
                                filteredStudents.map(student => {
                                    const isSelected = selectedStudents.some(s => s.id === student.id);
                                    const isSick = student.health_status === 'S';
                                    const isLeave = student.health_status === 'L';

                                    let bgClass = 'bg-white border-gray-50 hover:border-gray-200';
                                    if (isSelected) {
                                        bgClass = 'bg-red-50 border-red-200 scale-[0.98] shadow-sm ring-2 ring-red-100/50';
                                    } else if (isSick) {
                                        bgClass = 'bg-red-50/50 border-red-100 shadow-sm'; // Soft red for sick
                                    } else if (isLeave) {
                                        bgClass = 'bg-orange-50/50 border-orange-100 shadow-sm'; // Soft yellow/orange for leave
                                    }

                                    return (
                                        <button
                                            key={student.id}
                                            id={`student-card-${student.id}`}
                                            onClick={() => toggleStudent(student)}
                                            className={`flex items-center gap-4 p-4 rounded-3xl border transition-all text-left group ${bgClass}`}
                                        >
                                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs transition-all ${isSelected ? 'bg-red-500 text-white shadow-lg shadow-red-100' :
                                                isSick ? 'bg-red-100 text-red-600' :
                                                    isLeave ? 'bg-orange-100 text-orange-600' :
                                                        'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                                                }`}>
                                                {student.rollNo}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-sm text-gray-800">{student.name}</p>
                                                    {isSick && (
                                                        <span className="px-2 py-0.5 bg-red-100 text-[8px] font-black text-red-600 rounded-lg uppercase tracking-widest animate-pulse">Sick</span>
                                                    )}
                                                    {isLeave && (
                                                        <span className="px-2 py-0.5 bg-orange-100 text-[8px] font-black text-orange-600 rounded-lg uppercase tracking-widest animate-pulse">On Leave</span>
                                                    )}
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

                {/* 3. SELECT ACTION */}
                {selectedStudents.length > 0 && (
                    <section className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-2">
                            Step 3: Choose Action
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            {HEALTH_ACTIONS.map((action) => (
                                <button
                                    key={action.id}
                                    onClick={() => setSelectedAction(action)}
                                    className={`p-6 rounded-[2.5rem] border transition-all text-left flex flex-col gap-3 ${selectedAction?.id === action.id
                                        ? `bg-white border-2 border-red-500 shadow-xl shadow-red-100 scale-[1.02]`
                                        : 'bg-white border-gray-100 shadow-sm hover:border-gray-200 active:scale-95'
                                        }`}
                                >
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${selectedAction?.id === action.id ? action.color : 'bg-gray-50'
                                        } transition-colors`}>
                                        <span className={selectedAction?.id === action.id ? "text-white" : ""}>{action.emoji}</span>
                                    </div>
                                    <div>
                                        <p className={`font-black text-sm ${selectedAction?.id === action.id ? 'text-gray-900' : 'text-gray-800'}`}>
                                            {action.label}
                                        </p>
                                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-1">
                                            {action.desc}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {/* 4. SUBMIT */}
                <div className="pt-4 flex justify-center">
                    <button
                        onClick={() => {
                            if (selectedStudents.length === 0 || !selectedAction || loading) return;
                            setTimeout(() => setShowConfirm(true), 1300);
                        }}
                        disabled={selectedStudents.length === 0 || !selectedAction || loading}
                        className={`btn-submit-premium group ${selectedStudents.length === 0 || !selectedAction || loading ? 'opacity-30 grayscale' : ''}`}
                    >
                        <span className="txt">Apply Status</span>
                        <span className="txt2">Preparing Confirmation...</span>
                        <div className="loader-container">
                            <div className="loader"></div>
                        </div>
                    </button>
                </div>
            </main>

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
                        <div className="flex flex-col items-center gap-6 mt-12 pb-4 scale-90">
                            <button onClick={handleSubmit} disabled={loading} className="button group/ubtn">
                                <div className="bg"></div>
                                <div className="wrap">
                                    <div className="outline"></div>
                                    <div className="content">
                                        <div className="char">
                                            <span data-label="تأكيد" className="text-3xl" style={{ "--i": 1 }}>تأكيد</span>
                                        </div>
                                        <div className="icon">
                                            <div></div>
                                        </div>
                                    </div>
                                </div>
                                <svg viewBox="0 0 220 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="path">
                                    <path d="M213 18C213 18 206 6 186.5 6C167 6 33.5 6 33.5 6C14 6 7 18 7 18C7 18 7 31 7 40C7 49 7 62 7 62C7 62 14 74 33.5 74C53 74 186.5 74 186.5 74C206 74 213 62 213 62C213 62 213 49 213 40C213 31 213 18 213 18Z" stroke="white" strokeWidth="3"></path>
                                </svg>
                                <svg viewBox="0 0 220 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="splash">
                                    <path d="M100.5 6C100.5 6 81.5 6 62 6C42.5 6 23.5 6 23.5 6C10.5 6 7 18 7 18C7 18 7 31 7 40" stroke="white" strokeWidth="3"></path>
                                    <path d="M7 62C7 62 10.5 74 23.5 74C36.5 74 100.5 74 100.5 74" stroke="white" strokeWidth="3"></path>
                                </svg>
                            </button>

                            <button onClick={() => setShowConfirm(false)} className="text-xs font-black text-gray-400 uppercase tracking-widest hover:text-red-500 transition-colors">
                                Wait, Go Back
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
                            {healthListLoading ? (
                                <div className="p-12 text-center">
                                    <div className="animate-spin h-10 w-10 border-4 border-red-100 border-t-red-500 rounded-full mx-auto" />
                                    <p className="text-xs font-black text-gray-300 uppercase tracking-widest mt-4">Fetching Records...</p>
                                </div>
                            ) : healthListData?.health_list?.length > 0 ? (
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

                /* Premium Uiverse Button Styles */
                .button {
                    --white: #ffe7ff;
                    --purple-100: #f4b1fd;
                    --purple-200: #d190ff;
                    --purple-300: #c389f2;
                    --purple-400: #8e26e2;
                    --purple-500: #5e2b83;
                    --radius: 24px;
                    border-radius: var(--radius);
                    outline: none;
                    cursor: pointer;
                    font-size: 23px;
                    background: transparent;
                    letter-spacing: -1px;
                    border: 0;
                    position: relative;
                    width: 200px;
                    height: 70px;
                    transform: rotate(353deg) skewX(4deg);
                    transition: all 0.3s ease;
                }

                .bg {
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    filter: blur(1px);
                }
                .bg::before,
                .bg::after {
                    content: "";
                    position: absolute;
                    inset: 0;
                    border-radius: calc(var(--radius) * 1.1);
                    background: var(--purple-500);
                }
                .bg::before {
                    filter: blur(5px);
                    transition: all 0.3s ease;
                    box-shadow:
                        -7px 6px 0 0 rgb(115 75 155 / 40%),
                        -14px 12px 0 0 rgb(115 75 155 / 30%),
                        -21px 18px 4px 0 rgb(115 75 155 / 25%),
                        -28px 24px 8px 0 rgb(115 75 155 / 15%),
                        -35px 30px 12px 0 rgb(115 75 155 / 12%),
                        -42px 36px 16px 0 rgb(115 75 155 / 8%),
                        -56px 42px 20px 0 rgb(115 75 155 / 5%);
                }

                .wrap {
                    border-radius: inherit;
                    overflow: hidden;
                    height: 100%;
                    transform: translate(6px, -6px);
                    padding: 3px;
                    background: linear-gradient(
                        to bottom,
                        var(--purple-100) 0%,
                        var(--purple-400) 100%
                    );
                    position: relative;
                    transition: all 0.3s ease;
                }

                .outline {
                    position: absolute;
                    overflow: hidden;
                    inset: 0;
                    opacity: 0;
                    outline: none;
                    border-radius: inherit;
                    transition: all 0.4s ease;
                }
                .outline::before {
                    content: "";
                    position: absolute;
                    inset: 2px;
                    width: 120px;
                    height: 300px;
                    margin: auto;
                    background: linear-gradient(
                        to right,
                        transparent 0%,
                        white 50%,
                        transparent 100%
                    );
                    animation: spin 3s linear infinite;
                    animation-play-state: paused;
                }

                .content {
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1;
                    position: relative;
                    height: 100%;
                    gap: 12px;
                    border-radius: calc(var(--radius) * 0.85);
                    font-weight: 800;
                    transition: all 0.3s ease;
                    background: linear-gradient(
                        to bottom,
                        var(--purple-300) 0%,
                        var(--purple-400) 100%
                    );
                    box-shadow:
                        inset -2px 12px 11px -5px var(--purple-200),
                        inset 1px -3px 11px 0px rgb(0 0 0 / 35%);
                }

                .char {
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .char span {
                    display: block;
                    color: transparent;
                    position: relative;
                }
                .char span::before,
                .char span::after {
                    content: attr(data-label);
                    position: absolute;
                    color: var(--white);
                    text-shadow: -1px 1px 2px var(--purple-500);
                    left: 0;
                    right: 0;
                    text-align: center;
                }
                .char span::before {
                    opacity: 0;
                }
                .char {
                    position: relative;
                    margin-left: 10px;
                }

                .icon {
                    animation: resetArrow 0.8s cubic-bezier(0.7, -0.5, 0.3, 1.2) forwards;
                    z-index: 10;
                }
                .icon div {
                    position: relative;
                    width: 20px;
                    height: 3px;
                    border-radius: 1px;
                    background-color: var(--white);
                    box-shadow: -2px 2px 5px var(--purple-400);
                    transform: scale(0.9);
                    background: linear-gradient(to bottom, var(--white), var(--purple-100));
                    animation: swingArrow 1s ease-in-out infinite;
                    animation-play-state: paused;
                }
                .icon div::before,
                .icon div::after {
                    content: "";
                    position: absolute;
                    right: 0;
                    height: 3px;
                    width: 12px;
                    border-radius: 1px;
                    background-color: var(--white);
                    transform-origin: center right;
                    transition: all 0.3s ease;
                }
                .icon div::before { transform: rotate(44deg); top: 1px; }
                .icon div::after { bottom: 1px; transform: rotate(316deg); }

                .path {
                    position: absolute;
                    inset: 0;
                    z-index: 12;
                    stroke-dasharray: 150 480;
                    stroke-dashoffset: 150;
                    pointer-events: none;
                }

                .splash {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    stroke-dasharray: 60 60;
                    stroke-dashoffset: 60;
                    transform: translate(-17%, -31%);
                    stroke: var(--purple-300);
                }

                .button:hover .wrap { transform: translate(8px, -8px); }
                .button:hover .outline { opacity: 1; }
                .button:hover .outline::before { animation-play-state: running; }
                .button:active .wrap { transform: translate(3px, -3px); }

                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                @keyframes swingArrow { 50% { transform: translateX(5px) scale(0.9); } }
                @keyframes resetArrow { 0% { transform: translateX(-128px); } 100% { transform: translateX(0); } }
                @keyframes charAppear {
                    0% { transform: translateY(50%); opacity: 0; filter: blur(20px); }
                    100% { transform: translateY(0); opacity: 1; filter: blur(0); }
                }

                /* KINGFRESS Style Button - Submit Attendance */
                .btn-submit-premium {
                    background-color: transparent;
                    width: 100%;
                    max-width: 18rem;
                    height: 4.5rem;
                    border: 3px solid #1abc9c;
                    border-radius: 2.25rem;
                    font-weight: 900;
                    text-transform: uppercase;
                    color: #1abc9c;
                    padding: 2px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    position: relative;
                    overflow: hidden;
                    cursor: pointer;
                    transition: all .4s ease-in-out;
                    outline: none;
                }

                .btn-submit-premium .txt {
                    transition: .4s ease-in-out;
                    position: absolute;
                    font-size: 1.1rem;
                    letter-spacing: 0.05em;
                }

                .btn-submit-premium .txt2 {
                    transform: translateY(2rem) scale(0);
                    color: white;
                    position: absolute;
                    font-size: 0.9rem;
                    font-weight: 900;
                }

                .btn-submit-premium .loader-container {
                    height: 100%;
                    width: 100%;
                    background-color: transparent;
                    border-radius: inherit;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: -1;
                    overflow: hidden;
                }

                .btn-submit-premium .loader-container .loader {
                    height: 100%;
                    width: 100%;
                    background-color: #1abc9c;
                    border-radius: inherit;
                    transform: translateX(-20rem);
                }

                .btn-submit-premium:focus {
                    transition: .4s ease-in-out .4s;
                    animation: scaling 1.5s ease-in-out 0s 1 both;
                    border-color: #1abc9c;
                }

                .btn-submit-premium:focus .txt {
                    position: absolute;
                    transform: translateY(-5rem);
                    transition: .4s ease-in-out;
                }

                .btn-submit-premium:focus .txt2 {
                    transform: translateY(0) scale(1);
                    transition: .3s ease-in-out 1.2s;
                }

                .btn-submit-premium:focus .loader {
                    display: block;
                    transform: translate(0);
                    transition: .8s cubic-bezier(0,.4,1,.28) .4s;
                    animation: loading;
                }

                @keyframes scaling {
                    20% { height: 2rem; }
                    80% { height: 2rem; }
                    100% { height: 4.5rem; }
                }

                @keyframes loading {
                    0% { transform: translateX(-20rem); }
                    100% { transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
