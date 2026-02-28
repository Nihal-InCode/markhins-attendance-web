"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  getClasses,
  getFullTimetable,
  getDailyReport,
  getStudentHistory,
  resolvePeriod,
  getBatchReport,
  getWeeklyReport,
  getSickLeaveOverview,
  getPeriodSummary,
  getLastAttendance,
  getMarkedPeriods
} from "@/lib/api";


export default function DashboardPage() {
  const regularFormRef = useRef(null);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [resolvedSubject, setResolvedSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("attendance");

  // Feature specific states
  const [fullTimetable, setFullTimetable] = useState(null);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 0 : new Date().getDay() - 1); // 0=Mon...
  const [dailyReportData, setDailyReportData] = useState(null);
  const getTodayLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [selectedDate, setSelectedDate] = useState(getTodayLocalDate());
  const [searchRollNo, setSearchRollNo] = useState("");
  const [studentHistory, setStudentHistory] = useState(null);
  const [loadingFeature, setLoadingFeature] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [batchReport, setBatchReport] = useState(null);
  const [selectedClassForBatch, setSelectedClassForBatch] = useState("");
  const [sickLeaveOverview, setSickLeaveOverview] = useState(null);
  const [timetableError, setTimetableError] = useState("");
  const [reportError, setReportError] = useState("");
  // Period detail modal
  const [periodModal, setPeriodModal] = useState(null);
  const [dailyRefreshTs, setDailyRefreshTs] = useState(Date.now());
  // Last attendance edit card
  const [lastAttendance, setLastAttendance] = useState(null);
  const [markedPeriods, setMarkedPeriods] = useState([]);


  const { logout, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Sync activeTab with URL (?tab=attendance) so back button works ──
  const switchTab = useCallback((tab) => {
    setActiveTab(tab);
    setTimetableError("");
    setReportError("");
    router.push(`/?tab=${tab}`, { scroll: false });
  }, [router]);

  // On mount (and URL change): read tab from URL
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && ['attendance', 'timetable', 'reports'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [searchParams]);

  // ── Close period modal on browser/phone back button ──
  useEffect(() => {
    const onPopState = () => {
      setPeriodModal(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const periods = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];

  useEffect(() => {
    async function fetchData() {
      try {
        const classesRes = await getClasses();
        setClasses(classesRes);
      } catch (err) {
        setError("Failed to load classes.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    // Feature 3: Fetch last attendance from API (teacher-specific & strict ownership)
    async function fetchLastAttendance() {
      try {
        const res = await getLastAttendance();
        if (res) {
          // apiRequest in lib/api.js already returns data.data if it exists.
          // The previous check (res && res.data) was double-unwrapping.
          setLastAttendance(res);
        } else {
          setLastAttendance(null);
        }
      } catch (err) {
        console.error("Failed to fetch last attendance", err);
      }
    }

    if (activeTab === 'attendance') {
      fetchLastAttendance();
    }

    // Refresh data when window is focused (e.g. returning from another tab or mobile focus)
    const onFocus = () => {
      if (activeTab === 'attendance') {
        fetchLastAttendance();
        fetchMarked();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeTab]);

  async function fetchMarked() {
    if (selectedClass && activeTab === 'attendance') {
      try {
        const res = await getMarkedPeriods(selectedClass, selectedDate);
        setMarkedPeriods(res?.marked_periods || []);
      } catch (err) {
        console.error("Failed to fetch marked periods", err);
      }
    } else if (!selectedClass) {
      setMarkedPeriods([]);
    }
  }

  // Fetch marked periods for the selected class
  useEffect(() => {
    fetchMarked();
  }, [selectedClass, activeTab, dailyRefreshTs]);

  // Auto-resolve subject when class or period changes
  useEffect(() => {
    if (selectedClass && selectedPeriod) {
      handleResolvePeriod(selectedClass, selectedPeriod);
    } else {
      setResolvedSubject(null);
    }
  }, [selectedClass, selectedPeriod]);

  const handleResolvePeriod = async (cls, prd) => {
    setResolving(true);
    setResolvedSubject(null);
    try {
      const res = await resolvePeriod(cls, prd);
      setResolvedSubject(res);
    } catch (err) {
      setResolvedSubject({ error: err.message || "No subject scheduled." });
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (activeTab === "timetable") {
      fetchFullTimetable(selectedDay);
    }
  }, [activeTab, selectedDay]);

  useEffect(() => {
    if (activeTab === "reports") {
      fetchDailyReport(selectedDate);
      fetchWeeklyReport();
      fetchSickLeaveOverview();
    }
  }, [activeTab, selectedDate, dailyRefreshTs]);

  // Auto-refresh daily report every 30 seconds when on reports tab
  useEffect(() => {
    if (activeTab !== "reports") return;
    const interval = setInterval(() => {
      setDailyRefreshTs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "reports" && selectedClassForBatch) {
      fetchBatchReport(selectedClassForBatch);
    }
  }, [selectedClassForBatch, activeTab]);

  const fetchFullTimetable = async (day) => {
    setLoadingFeature(true);
    setTimetableError("");
    try {
      const data = await getFullTimetable(day);
      setFullTimetable(data);
    } catch (err) {
      setTimetableError("Failed to load timetable. Is the backend running?");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchDailyReport = async (date) => {
    setLoadingFeature(true);
    try {
      const data = await getDailyReport(date);
      setDailyReportData(data);
    } catch (err) {
      setReportError("Failed to load daily report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const handleStudentSearch = async () => {
    if (!searchRollNo) return;
    setLoadingFeature(true);
    try {
      const data = await getStudentHistory(searchRollNo);
      setStudentHistory(data);
    } catch (err) {
      alert("Student not found or error loading history.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchBatchReport = async (classId) => {
    if (!classId) return;
    setLoadingFeature(true);
    try {
      const data = await getBatchReport(classId);
      setBatchReport(data);
    } catch (err) {
      setReportError("Failed to load batch report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchWeeklyReport = async () => {
    setLoadingFeature(true);
    try {
      const data = await getWeeklyReport();
      setWeeklyReport(data);
    } catch (err) {
      setReportError("Failed to load weekly report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchSickLeaveOverview = async () => {
    setLoadingFeature(true);
    try {
      const data = await getSickLeaveOverview();
      setSickLeaveOverview(data);
    } catch (err) {
      setReportError("Failed to load health report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const openPeriodModal = async (cls, period, date) => {
    // Push a history entry so the phone back button closes the modal
    history.pushState({ modal: 'period' }, '');
    setPeriodModal({ class: cls, period, date, data: null, loading: true });
    try {
      const data = await getPeriodSummary(cls, period, date);
      setPeriodModal({ class: cls, period, date, data, loading: false });
    } catch (err) {
      setPeriodModal({ class: cls, period, date, data: null, loading: false, error: err.message });
    }
  };

  // Close modal AND pop the history entry we pushed when opening it
  const closeModal = () => {
    setPeriodModal(null);
    if (history.state?.modal === 'period') history.back();
  };

  const handleLoadStudents = () => {
    if (!selectedClass || !selectedPeriod || !resolvedSubject || resolvedSubject.error) {
      alert("Please ensure Class and Period are selected and a subject is scheduled.");
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    sessionStorage.setItem("attendance_params", JSON.stringify({
      classId: selectedClass,
      period: selectedPeriod,
      subjectId: resolvedSubject.subject,
      date: today,
      className: classes.find(c => c.id === selectedClass)?.name,
      subjectName: resolvedSubject.subject,
    }));

    router.push("/attendance");
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen font-sans">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50/50 font-sans text-gray-900">

      {/* ── HEADER — scrolls away, not sticky ── */}
      <header className="anim-header px-6 py-4" style={{ background: 'linear-gradient(135deg, #0f1f2e 0%, #0d3347 50%, #0a4a4a 100%)', boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-1.5">
              <img
                src="/logo.png"
                alt="MARKHINS HUB Logo"
                className="anim-logo h-16 w-16 object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight leading-tight text-white">MARKHINS HUB</h1>
              <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#5eead4' }}>Hello, {user?.name || 'Teacher'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user?.role === 'admin' && (
              <button
                onClick={() => router.push("/settings")}
                className="p-2 text-white/70 hover:text-white transition-all bg-white/10 rounded-xl"
                title="System Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => router.push("/profile")}
              className="p-2 text-white/70 hover:text-white transition-all bg-white/10 rounded-xl"
              title="My Profile"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
            <button onClick={logout} className="p-2 text-white/50 hover:text-red-300 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className={`flex-1 ${activeTab === 'timetable' ? 'max-w-full px-4' : 'max-w-md px-6'} mx-auto w-full py-6 pb-28 space-y-6 transition-all duration-300`}>

        {error && (
          <div className="max-w-md mx-auto p-4 text-red-600 bg-red-50 rounded-xl border border-red-100 text-sm font-medium">
            {error}
          </div>
        )}

        {/* --- ATTENDANCE TAB (OVERHAULED) --- */}
        {activeTab === "attendance" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* ── MODE SELECTOR ── */}
            <div className="grid grid-cols-2 gap-4 anim-fade-up" style={{ animationDelay: '0.05s' }}>
              {/* Regular Attendance — click scrolls to form */}
              <button
                onClick={() => regularFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="anim-float-regular bg-blue-600 hover:bg-blue-700 p-6 rounded-[2.5rem] shadow-xl shadow-blue-100 flex flex-col gap-3 relative overflow-hidden text-left transition-all active:scale-95 group"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl" />
                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center text-xl">🟢</div>
                <div>
                  <p className="text-white font-black text-sm leading-tight">Regular</p>
                  <p className="text-blue-100 text-[10px] font-bold mt-0.5">Timetable-based</p>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <span className="text-white/70 text-[9px] font-black uppercase tracking-widest">Tap to mark</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white/60 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Extra Class — navigates to /extra */}
              <button
                onClick={() => router.push("/extra")}
                className="anim-float-extra bg-amber-400 hover:bg-amber-500 p-6 rounded-[2.5rem] shadow-xl shadow-amber-100 flex flex-col gap-3 relative overflow-hidden text-left transition-all active:scale-95 group"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl " />
                <div className="w-10 h-10 bg-white/30 rounded-2xl flex items-center justify-center text-xl">⚡</div>
                <div>
                  <p className="text-white font-black text-sm leading-tight">Extra Class</p>
                  <p className="text-amber-100 text-[10px] font-bold mt-0.5">Manual • No timetable</p>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <span className="text-white/70 text-[9px] font-black uppercase tracking-widest">Tap to start</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white/60 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>

            {/* ── REGULAR ATTENDANCE FORM ── */}
            <div ref={regularFormRef} className="anim-fade-up bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-8" style={{ animationDelay: '0.15s' }}>
              <div className="flex items-center gap-3 pb-2 border-b border-gray-50">
                <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center text-base">🟢</div>
                <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Regular Attendance</span>
              </div>
              <section>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">1. Select Class</label>
                <select
                  className="w-full px-6 py-5 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 outline-none text-xl font-bold transition-all appearance-none cursor-pointer"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="">Choose Class</option>
                  {classes.map((cls) => (<option key={cls.id} value={cls.id}>{cls.name}</option>))}
                </select>
              </section>

              <section>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">2. Select Period</label>
                  {markedPeriods.length > 0 && (
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100 italic">
                      Today: {markedPeriods.map(p => p.replace('P', '')).join(', ')} marked
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {periods.map((p) => {
                    const isMarked = markedPeriods.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => !isMarked && setSelectedPeriod(p)}
                        disabled={isMarked}
                        className={`py-4 rounded-2xl text-lg font-black transition-all relative overflow-hidden flex flex-col items-center justify-center gap-0.5 ${selectedPeriod === p
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : isMarked
                            ? 'bg-red-50 text-red-400 border border-red-100 cursor-not-allowed'
                            : 'bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100'
                          }`}
                      >
                        <span>{p.replace('P', '')}</span>
                        {isMarked && (
                          <span className="text-[7px] font-black uppercase tracking-tighter opacity-60">
                            Marked
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {periods.every(p => markedPeriods.includes(p)) && (
                  <div className="mt-4 p-3 bg-amber-50/50 rounded-2xl border border-amber-100 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                    <span className="text-lg">💡</span>
                    <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest leading-loose">
                      All periods marked for this class today. Use <span className="bg-amber-100 px-1.5 py-0.5 rounded-md">Extra Class</span> button above for manual marking.
                    </p>
                  </div>
                )}
              </section>

              <section className="pt-4 border-t border-gray-50">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">Detected Subject</label>
                <div className={`w-full px-6 py-6 rounded-3xl border animate-in fade-in duration-500 ${resolvedSubject?.error ? 'bg-red-50 border-red-100' : 'bg-blue-50/50 border-blue-100'}`}>
                  {resolving ? (
                    <div className="flex items-center space-x-3 text-blue-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                      <span className="text-sm font-bold uppercase tracking-widest">Resolving Timetable...</span>
                    </div>
                  ) : resolvedSubject ? (
                    resolvedSubject.error ? (
                      <div className="text-red-600">
                        <p className="text-lg font-bold">Class Not Scheduled</p>
                        <p className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-70">{resolvedSubject.error}</p>
                        <button
                          onClick={() => router.push("/extra")}
                          className="mt-3 flex items-center gap-2 bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-200 transition-all"
                        >
                          <span>⚡</span> Use Extra Class instead
                        </button>
                      </div>
                    ) : (
                      <div className="text-blue-900">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-50">Today's Schedule</p>
                        <p className="text-2xl font-black leading-tight">{resolvedSubject.subject}</p>
                        <p className="text-xs font-bold mt-1 text-blue-600 uppercase tracking-widest">Teacher: {resolvedSubject.teacher}</p>
                      </div>
                    )
                  ) : (
                    <p className="text-gray-300 text-sm font-bold uppercase tracking-widest italic">Wait for selection...</p>
                  )}
                </div>
              </section>
            </div>

            <button
              onClick={handleLoadStudents}
              disabled={!resolvedSubject || resolvedSubject.error || resolving}
              className={`anim-fade-up w-full py-6 rounded-[2rem] text-xl font-black shadow-2xl transition-all active:scale-[0.97] ${(!resolvedSubject || resolvedSubject.error || resolving)
                ? 'bg-gray-200 text-gray-400 shadow-none cursor-not-allowed'
                : 'anim-shimmer-btn anim-cta-glow text-white'
                }`}
              style={{ animationDelay: '0.25s' }}
            >
              {resolvedSubject?.error ? "Unavailable" : "Start Marking"}
            </button>
          </div>
        )}

        {/* ── Feature 3: Last Attendance Edit Card ── */}
        {activeTab === "attendance" && lastAttendance && lastAttendance.editable && (
          <div
            className="mx-auto max-w-md mt-2"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.3s' }}
          >
            <div
              className="flex items-center justify-between p-5 rounded-[2rem] border"
              style={{
                background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                borderColor: '#fde68a',
                boxShadow: '0 2px 12px rgba(251,191,36,0.12)'
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: '#fef08a' }}
                >
                  ✏️
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#92400e' }}>Last Attendance — Editable</p>
                  <p className="font-black text-gray-800 text-sm mt-0.5">{lastAttendance.className}</p>
                  <p className="text-[10px] font-bold" style={{ color: '#b45309' }}>
                    {lastAttendance.period} • {lastAttendance.date}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  sessionStorage.setItem('attendance_params', JSON.stringify({
                    classId: lastAttendance.classId,
                    className: lastAttendance.className,
                    period: lastAttendance.period,
                    date: lastAttendance.date,
                    isEdit: true,
                    subjectName: lastAttendance.subjectName || ''
                  }));
                  router.push('/attendance?edit=1');
                }}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all active:scale-95"
                style={{
                  background: '#f59e0b',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(245,158,11,0.3)'
                }}
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {/* ── Feature: Health & Leave Management ── */}
        {activeTab === "attendance" && user && (user.role === 'Principal' || user.role === 'Vice Principal' || user.role === 'Class Teacher') && (
          <div
            className="mx-auto max-w-md mt-6"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.4s' }}
          >
            <button
              onClick={() => router.push('/health')}
              className="w-full flex items-center justify-between p-6 rounded-[2.5rem] bg-white border border-gray-100 shadow-xl shadow-gray-100 hover:shadow-2xl hover:scale-[1.02] transition-all active:scale-95 group"
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-3xl bg-red-50 flex items-center justify-center text-2xl group-hover:bg-red-100 transition-colors">
                  🩺
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-black text-gray-800">Leave Status</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mt-1">Manage SICK / LEAVE / CURE</p>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-red-50 group-hover:text-red-400 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {/* ── Feature: Teachers List ── */}
        {activeTab === "attendance" && (
          <div
            className="mx-auto max-w-md mt-6"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.5s' }}
          >
            <button
              onClick={() => router.push('/teachers')}
              className="w-full flex items-center justify-between p-6 rounded-[2.5rem] bg-white border border-gray-100 shadow-xl shadow-gray-100 hover:shadow-2xl hover:scale-[1.02] transition-all active:scale-95 group"
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-3xl bg-blue-50 flex items-center justify-center text-2xl group-hover:bg-blue-100 transition-colors">
                  👨‍🏫
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-black text-gray-800">Teachers List</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mt-1">View Faculty & Roles</p>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-blue-50 group-hover:text-blue-400 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {/* --- TIMETABLE TAB --- */}
        {activeTab === "timetable" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 max-w-md mx-auto">
              {days.map((day, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedDay(idx)}
                  className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${selectedDay === idx ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-400 border border-gray-100 hover:border-blue-200'}`}
                >
                  {day}
                </button>
              ))}
            </div>

            {loadingFeature ? (
              <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
            ) : Array.isArray(fullTimetable) && fullTimetable.length > 0 ? (
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-blue-50/30 border-b border-gray-100">
                        <th className="px-6 py-5 text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] sticky left-0 bg-white z-10 border-r border-gray-100 min-w-[100px]">Class</th>
                        {periods.map(p => (
                          <th key={p} className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-center min-w-[180px]">Period {p}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {fullTimetable.map((row, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/20 transition-colors">
                          <td className="px-6 py-6 font-black text-gray-900 sticky left-0 bg-white z-10 border-r border-gray-100 text-center shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                            {row.class}
                          </td>
                          {periods.map(p => {
                            const item = row.periods[p];
                            return (
                              <td key={p} className="px-5 py-5 text-center transition-all">
                                {item ? (
                                  <div className="space-y-1">
                                    <p className="font-bold text-gray-800 text-[13px] leading-tight break-words">{item.subject}</p>
                                    <p className="text-[10px] text-gray-400 font-semibold leading-tight uppercase tracking-wide">({item.teacher})</p>
                                  </div>
                                ) : (
                                  <span className="text-gray-200 text-lg font-black">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : timetableError ? (
              <div className="bg-red-50 border border-red-100 p-6 rounded-3xl text-center max-w-md mx-auto">
                <p className="text-red-600 font-bold text-sm">{timetableError}</p>
                <p className="text-red-400 text-xs mt-1 font-medium">Make sure the backend server is running on port 8080.</p>
              </div>
            ) : (
              <div className="bg-white p-20 rounded-3xl border border-gray-100 text-center max-w-md mx-auto">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No data available</p>
              </div>
            )}
          </div>
        )}

        {/* --- REPORTS TAB --- */}
        {activeTab === "reports" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-10">
            {reportError && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-bold flex items-center gap-3">
                <span className="text-lg">⚠️</span>
                <span>{reportError}</span>
              </div>
            )}
            {/* 1. Student Search */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-4">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block px-1">Student Search (Roll No)</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Enter Roll No"
                  className="flex-1 bg-gray-50 border-none rounded-3xl px-6 py-4 focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                  value={searchRollNo}
                  onChange={(e) => setSearchRollNo(e.target.value)}
                />
                <button
                  onClick={handleStudentSearch}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-3xl font-bold transition-all active:scale-95 shadow-lg shadow-blue-100"
                >
                  Search
                </button>
              </div>
            </div>

            {studentHistory && (
              <div className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-2xl shadow-blue-200 animate-in zoom-in-95 duration-300 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-2xl font-black tracking-tight">{studentHistory.name}</h3>
                      <p className="text-blue-100 text-sm font-bold opacity-80 mt-1">
                        Roll: {studentHistory.rollNo} • Class {studentHistory.class}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-4xl font-black tracking-tighter">{studentHistory.stats?.percent}%</p>
                      <p className="text-[10px] text-blue-200 uppercase font-black tracking-widest mt-1">Attendance</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white/10 backdrop-blur-md p-4 rounded-3xl border border-white/10">
                      <p className="text-xl font-black">{studentHistory.stats?.total}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Total</p>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md p-4 rounded-3xl border border-white/10">
                      <p className="text-xl font-black">{studentHistory.stats?.attended}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Present</p>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md p-4 rounded-3xl border border-white/10">
                      <p className="text-xl font-black">{(studentHistory.stats?.total || 0) - (studentHistory.stats?.attended || 0)}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Absent</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Active Health Status (Combined Sick/Leave) */}
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <h3 className="font-black text-gray-800 tracking-tight text-lg">Active Health & Leave</h3>
                <span className="bg-purple-50 text-purple-600 text-[10px] font-black px-3 py-1 rounded-full border border-purple-100 uppercase tracking-wider">
                  {sickLeaveOverview?.length || 0} active
                </span>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar px-1">
                {sickLeaveOverview?.length > 0 ? (
                  sickLeaveOverview.map((item, idx) => (
                    <div key={idx} className="min-w-[200px] bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col gap-3 relative">
                      <span className={`absolute top-4 right-4 text-lg p-2 rounded-2xl ${item.type === 'Sick' ? 'bg-red-50' : 'bg-orange-50'}`}>
                        {item.type === 'Sick' ? '💊' : '🏠'}
                      </span>
                      <div>
                        <p className="font-black text-gray-800 line-clamp-1 pr-6">{item.name}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-0.5">Roll: {item.rollNo} • {item.class}</p>
                      </div>
                      <div className="mt-2 pt-3 border-t border-gray-50">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Since {item.since}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="w-full bg-gray-50/50 p-10 rounded-[2.5rem] border border-dashed border-gray-200 text-center">
                    <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">All students normal</p>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Weekly Activity */}
            <div className="space-y-4">
              <h3 className="font-black text-gray-800 tracking-tight text-lg px-1">Weekly Activity Overview</h3>
              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                      <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Class</th>
                      <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Period</th>
                      <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {weeklyReport?.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="text-sm">
                        <td className="py-5 font-bold text-gray-600">{row.date}</td>
                        <td className="py-5"><span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-xl font-black text-[10px]">{row.class}</span></td>
                        <td className="py-5 font-bold text-gray-800">{row.period}</td>
                        <td className="py-5 text-right"><span className="text-green-600 font-black text-[10px] uppercase tracking-wider">✅ Taken</span></td>
                      </tr>
                    ))}
                    {(!weeklyReport || weeklyReport.length === 0) && (
                      <tr><td colSpan="4" className="py-10 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">No activity records</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Batch-wise Report */}
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <h3 className="font-black text-gray-800 tracking-tight text-lg">Batch-wise Analysis</h3>
                <select
                  className="bg-gray-100 px-4 py-2 rounded-2xl border-none text-[10px] font-black text-blue-600 uppercase tracking-wider cursor-pointer focus:ring-2 focus:ring-blue-100"
                  value={selectedClassForBatch}
                  onChange={(e) => setSelectedClassForBatch(e.target.value)}
                >
                  <option value="">Select Class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {batchReport ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {batchReport.map((student, idx) => (
                    <div key={idx} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex items-center gap-5 transition-all hover:scale-[1.02] hover:shadow-md">
                      <div className={`w-16 h-16 rounded-3xl flex items-center justify-center font-black text-sm shadow-inner ${student.percent > 75 ? 'bg-green-50 text-green-600' : student.percent > 50 ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'}`}>
                        {Math.round(student.percent)}%
                      </div>
                      <div className="flex-1">
                        <p className="font-black text-gray-800 text-sm leading-tight">{student.name}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-0.5">Roll: {student.rollNo}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-gray-600">{student.attended}/{student.total}</p>
                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Sessions</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50/50 p-12 rounded-[2.5rem] border border-dashed border-gray-200 text-center">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">📊</div>
                  <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Select a class to view batch percentages</p>
                </div>
              )}
            </div>

            {/* 5. Live Daily Monitoring */}
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1 pt-6 border-t border-gray-100">
                <div>
                  <h3 className="font-black text-gray-800 tracking-tight text-lg">Live Daily Monitoring</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Tap any period for details</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setDailyRefreshTs(Date.now())}
                    className="p-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition-all border border-blue-100 shadow-sm active:scale-95"
                    title="Refresh"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <input
                    type="date"
                    className="text-[10px] font-black text-blue-600 bg-gray-50 px-4 py-2 rounded-2xl border-none uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-blue-100"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
              </div>

              {loadingFeature && !dailyReportData ? (
                <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-blue-600 border-t-transparent shadow-sm"></div></div>
              ) : dailyReportData ? (
                <div className="grid grid-cols-1 gap-4">
                  {dailyReportData.map((item, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-[2rem] border border-gray-100 shadow-sm transition-all hover:shadow-lg hover:border-blue-100 group">
                      <div className="flex justify-between mb-3 border-b border-gray-50 pb-2">
                        <span className="font-black text-xs text-gray-800 bg-gray-50 px-3 py-1 rounded-full group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{item.class}</span>
                        <span className="text-[8px] text-gray-400 font-black uppercase tracking-[0.2em] self-center">Daily Status</span>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar px-1">
                        {item.periods.map((p, pIdx) => {
                          const isClickable = p.scheduled || p.taken;
                          return (
                            <button
                              key={pIdx}
                              onClick={() => isClickable && openPeriodModal(item.class, p.period, selectedDate)}
                              className={`min-w-[55px] h-16 rounded-2xl flex flex-col items-center justify-center border transition-all ${isClickable
                                ? 'active:scale-95 cursor-pointer hover:shadow-md'
                                : 'cursor-default opacity-50 bg-gray-100 border-gray-100 pointer-events-none'
                                } group/cell ${p.taken
                                  ? 'bg-green-50 border-green-200'
                                  : p.scheduled
                                    ? 'bg-red-50 border-red-100'
                                    : ''
                                }`}
                            >
                              <span className={`text-[8px] font-black uppercase tracking-widest ${p.taken ? 'text-green-700' : p.scheduled ? 'text-red-400' : 'text-gray-400'}`}>{p.period}</span>
                              <span className="text-xl mt-0.5 select-none text-gray-300">
                                {p.taken ? '✅' : p.scheduled ? '⏳' : '—'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-gray-50/30 rounded-[2.5rem] border border-dashed border-gray-200">
                  <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">No records found for this date</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <div className="h-20"></div>

      {/* ══════════════════════════════════════════════
          PERIOD DETAIL MODAL
      ══════════════════════════════════════════════ */}
      {periodModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white w-full sm:max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            {/* Modal Header */}
            <div className="flex justify-between items-start p-6 pb-4 border-b border-gray-50 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">{periodModal.class}</span>
                  <span className="bg-gray-100 text-gray-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">{periodModal.period}</span>
                  {periodModal.data?.isSubstitute && (
                    <span className="bg-orange-100 text-orange-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">🔄 Substitute</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 font-bold">{periodModal.date}</p>
              </div>
              <button
                onClick={() => closeModal()}
                className="w-9 h-9 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-all active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {periodModal.loading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-blue-600 border-t-transparent" />
                </div>
              ) : periodModal.error ? (
                <div className="p-5 bg-red-50 rounded-2xl text-red-600 font-bold text-sm">{periodModal.error}</div>
              ) : periodModal.data ? (
                <>
                  {/* Subject & Teacher Info */}
                  <div className="bg-blue-50/60 rounded-3xl p-5 space-y-4 border border-blue-100">
                    {periodModal.data.subject && (
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Subject</span>
                        <span className="font-black text-blue-900 text-sm">{periodModal.data.subject}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Scheduled By</span>
                      <span className="font-black text-gray-700 text-sm">{periodModal.data.scheduledTeacher || '—'}</span>
                    </div>
                    {periodModal.data.isSubstitute ? (
                      <div className="mt-2 pt-3 border-t border-blue-100 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">🔄 Substitute Took</span>
                          <span className="font-black text-orange-700 text-sm bg-orange-50 px-3 py-1 rounded-xl">
                            {periodModal.data.substituteInfo?.substitute || periodModal.data.actualTeacher || '—'}
                          </span>
                        </div>
                        {periodModal.data.substituteInfo?.scheduled && (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Was Assigned To</span>
                            <span className="font-bold text-gray-500 text-sm line-through">{periodModal.data.substituteInfo.scheduled}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      periodModal.data.actualTeacher && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Took Class</span>
                          <span className="font-black text-green-700 text-sm bg-green-50 px-3 py-1 rounded-xl">{periodModal.data.actualTeacher}</span>
                        </div>
                      )
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Status</span>
                      <span className={`font-black text-sm px-3 py-1 rounded-xl ${periodModal.data.isTaken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {periodModal.data.isTaken ? '✅ Taken' : '⏳ Not Taken'}
                      </span>
                    </div>
                  </div>

                  {/* Count Summary */}
                  {periodModal.data.counts && (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Present', count: periodModal.data.counts.present, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100' },
                        { label: 'Absent', count: periodModal.data.counts.absent, bg: 'bg-red-50', text: 'text-red-500', border: 'border-red-100' },
                        { label: 'Sick', count: periodModal.data.counts.sick, bg: 'bg-orange-50', text: 'text-orange-500', border: 'border-orange-100' },
                        { label: 'Leave', count: periodModal.data.counts.leave, bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
                      ].map(({ label, count, bg, text, border }) => (
                        <div key={label} className={`${bg} ${border} border rounded-3xl p-3 text-center`}>
                          <p className={`text-xl font-black ${text}`}>{count || 0}</p>
                          <p className={`text-[8px] font-black uppercase tracking-widest mt-0.5 ${text} opacity-70`}>{label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Student Roster */}
                  {periodModal.data.records?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Student Roster</p>
                      <div className="bg-white border border-gray-100 rounded-[2rem] overflow-hidden divide-y divide-gray-50">
                        {periodModal.data.records.map((s, i) => {
                          const statusMap = {
                            present: { label: 'Present', bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
                            absent: { label: 'Absent', bg: 'bg-red-50', text: 'text-red-500', dot: 'bg-red-500' },
                            sick: { label: 'Sick 💊', bg: 'bg-orange-50', text: 'text-orange-500', dot: 'bg-orange-400' },
                            leave: { label: 'Leave 🏠', bg: 'bg-purple-50', text: 'text-purple-600', dot: 'bg-purple-400' },
                            not_marked: { label: 'N/A', bg: 'bg-gray-50', text: 'text-gray-400', dot: 'bg-gray-300' },
                          };
                          const cfg = statusMap[s.status] || statusMap.not_marked;
                          return (
                            <div key={i} className={`flex items-center justify-between px-5 py-4 ${s.status === 'absent' ? 'bg-red-50/30' : ''}`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-2xl flex items-center justify-center text-[10px] font-black ${cfg.bg} ${cfg.text}`}>
                                  {s.rollNo}
                                </div>
                                <p className="font-bold text-gray-800 text-sm">{s.name}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                                <span className={`text-[10px] font-black uppercase tracking-wider ${cfg.text}`}>{cfg.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!periodModal.data.isTaken && (
                    <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 text-center">
                      <p className="text-amber-700 font-black text-sm">⏳ Attendance not marked yet for this period</p>
                      <p className="text-amber-500 text-[10px] font-bold mt-1 uppercase tracking-wider">No records found in database</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM NAV BAR */}
      <nav
        className="anim-tab-bar fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto"
        style={{
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)'
        }}
      >
        <div className="flex items-center justify-around px-4 pt-2 pb-1">
          {[
            {
              id: 'attendance', label: 'Attendance',
              icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>)
            },
            {
              id: 'timetable', label: 'Timetable',
              icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>)
            },
            {
              id: 'reports', label: 'Reports',
              icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
            }
          ].map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className="flex flex-col items-center gap-1 px-5 py-1 rounded-2xl transition-all active:scale-90"
              style={{ color: activeTab === id ? '#0d3347' : '#9ca3af' }}
            >
              <div className={`transition-all duration-200 ${activeTab === id ? 'scale-110' : 'scale-100'}`}>
                {icon}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
              {activeTab === id && (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#0a4a4a' }} />
              )}
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}