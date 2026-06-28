"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
    apiRequest,
    createAdminAnnouncement,
    createAdminTeacher,
    deleteAdminAnnouncement,
    deleteTeacherPhoto,
    deleteAdminTeacher,
    getAdminAnnouncements,
    getAdminActivityLog,
    getNamazApiMonitor,
    getAnnouncementViewers,
    getAdminTeachers,
    getAdminTimetable,
    getTeacherSubjectOptions,
    uploadTeacherPhoto,
    updateAdminAnnouncement,
    updateAdminTeacher,
    updateTimetablePeriod,
} from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const ACTIVITY_POLL_MS = 30000;

function getIstDateString() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
}

const TABS = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "teachers", label: "Teachers", icon: "👥" },
    { id: "timetable", label: "Timetable", icon: "📅" },
    { id: "broadcasts", label: "Broadcasts", icon: "📢" },
    { id: "system", label: "System", icon: "⚙️" },
];

export default function SettingsPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState("overview");
    const [sessions, setSessions] = useState([]);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [resetConfig, setResetConfig] = useState({ category: "all", className: "all", dateMode: "all", date: "all" });
    const [resettingData, setResettingData] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [msg, setMsg] = useState("");
    const [error, setError] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [updatingPassword, setUpdatingPassword] = useState(false);
    const [teachers, setTeachers] = useState([]);
    const [teachersBusy, setTeachersBusy] = useState(false);
    const [teacherSearch, setTeacherSearch] = useState("");
    const [teacherModalOpen, setTeacherModalOpen] = useState(false);
    const [teacherForm, setTeacherForm] = useState({ id: null, name: "", username: "", password: "" });
    const [photoBusyTeacherId, setPhotoBusyTeacherId] = useState(null);
    const [namazApiMonitor, setNamazApiMonitor] = useState(null);
    const [selectedWeekday, setSelectedWeekday] = useState(new Date().getDay() === 0 ? 0 : new Date().getDay() - 1);
    const [timetableRows, setTimetableRows] = useState([]);
    const [editingCell, setEditingCell] = useState(null);
    const [timetableBusy, setTimetableBusy] = useState(false);
    const [subjectOptions, setSubjectOptions] = useState([]);
    const [timetableEditor, setTimetableEditor] = useState({ classId: "", period: "", teacherId: "", subject: "" });
    const [manualSubjectEntry, setManualSubjectEntry] = useState(false);
    const [announcements, setAnnouncements] = useState([]);
    const [announcementBusy, setAnnouncementBusy] = useState(false);
    const [announcementForm, setAnnouncementForm] = useState({
        id: null,
        heading: "A fresh semester begins",
        content: "Respected {teacherName}, welcome to the new semester. Kindly review your class list, timetable and assigned periods once before taking attendance.",
        footer: "If anything goes wrong or does not work correctly, please inform the developer.",
        active: true,
    });
    const [viewersModal, setViewersModal] = useState({ open: false, key: null, heading: "", list: [], loading: false });
    const { showLoader, hideLoader } = useLoading();
    const showLoaderRef = useRef(showLoader);
    const hideLoaderRef = useRef(hideLoader);

    useEffect(() => {
        showLoaderRef.current = showLoader;
        hideLoaderRef.current = hideLoader;
    }, [showLoader, hideLoader]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setMsg("");
        setError("");
        showLoaderRef.current("Loading settings...");
        try {
            const [sessRes, infoRes, teacherRes, timetableRes, announcementRes, namazMonitorRes] = await Promise.all([
                apiRequest("/admin/sessions"),
                apiRequest("/admin/system-info"),
                getAdminTeachers(),
                getAdminTimetable(selectedWeekday),
                getAdminAnnouncements(),
                getNamazApiMonitor(),
            ]);
            setSessions(sessRes.sessions || []);
            setSystemInfo(infoRes || null);
            setTeachers(Array.isArray(teacherRes) ? teacherRes : []);
            setTimetableRows(Array.isArray(timetableRes) ? timetableRes : []);
            setAnnouncements(Array.isArray(announcementRes) ? announcementRes : []);
            setNamazApiMonitor(namazMonitorRes || null);
        } catch (err) {
            setError("Failed to load: " + err.message);
        } finally {
            setLoading(false);
            hideLoaderRef.current();
        }
    }, [selectedWeekday]);

    useEffect(() => {
        if (!user || user.role !== 'admin') { router.push("/"); return; }
        fetchData();
    }, [fetchData, router, user]);

    async function refreshTeachers() {
        const res = await getAdminTeachers();
        setTeachers(Array.isArray(res) ? res : []);
    }

    async function refreshTimetable() {
        const res = await getAdminTimetable(selectedWeekday);
        setTimetableRows(Array.isArray(res) ? res : []);
    }

    async function refreshSessions() {
        const res = await apiRequest("/admin/sessions");
        setSessions(res.sessions || []);
    }

    function getAuthToken() {
        return typeof window !== "undefined" ? localStorage.getItem("token") : null;
    }

    async function handleRevoke(teacherId) {
        if (!confirm("Log out this teacher?")) return;
        showLoader("Revoking session...");
        try {
            await apiRequest("/admin/revoke-session", { method: "POST", body: JSON.stringify({ teacherId }) });
            await refreshSessions();
            setMsg("Session revoked.");
        } catch (err) { setError(err.message); }
        finally { hideLoader(); }
    }

    async function handleUpload(e) {
        const file = e.target.files[0];
        if (!file || !confirm("REPLACE the database?")) return;
        setUploading(true);
        setError("");
        showLoader("Uploading...");
        const formData = new FormData();
        formData.append("file", file);
        const authToken = getAuthToken();
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/admin/upload-db`, {
                method: "POST",
                headers: authToken ? { "Authorization": `Bearer ${authToken}` } : {},
                body: formData
            });
            const data = await res.json();
            if (data.success) { playSound('uploadSuccess'); setMsg("Database uploaded!"); await fetchData(); }
            else { playSound('error'); throw new Error(data.message || "Upload failed"); }
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setUploading(false); hideLoader(); }
    }

    function handleDownload() {
        const url = `${process.env.NEXT_PUBLIC_API_URL || ""}/admin/download-db`;
        const authToken = getAuthToken();
        fetch(url, { headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {} })
            .then(res => res.blob())
            .then(blob => {
                const bUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = bUrl;
                link.setAttribute('download', 'attendance_export.db');
                document.body.appendChild(link);
                link.click();
                link.parentNode.removeChild(link);
                playSound('downloadSuccess');
            });
    }

    async function handlePasswordChange(e) {
        e.preventDefault();
        if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
        if (newPassword.length < 6) { setError("Min 6 characters."); return; }
        setUpdatingPassword(true);
        setError("");
        showLoader("Updating password...");
        try {
            const res = await apiRequest("/admin/update-password", { method: "POST", body: JSON.stringify({ password: newPassword }) });
            if (res.success) { playSound('success'); setMsg("Password updated!"); setNewPassword(""); setConfirmPassword(""); }
            else throw new Error(res.message || "Failed");
        } catch (err) { setError(err.message); }
        finally { setUpdatingPassword(false); hideLoader(); }
    }

    async function handleResetData() {
        if (!confirm(`Reset ${resetConfig.category.toUpperCase()} data for ${resetConfig.className.toUpperCase()}? This cannot be undone.`)) return;
        setResettingData(true);
        setError("");
        showLoader("Resetting...");
        try {
            const res = await apiRequest("/admin/reset-namaz-data", {
                method: "POST",
                body: JSON.stringify({ category: resetConfig.category, className: resetConfig.className, date: resetConfig.date })
            });
            if (res.success) { playSound('success'); setMsg(res.message || "Reset done."); await fetchData(); }
            else throw new Error(res.message || "Failed");
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setResettingData(false); hideLoader(); }
    }

    function openCreateTeacherModal() { setTeacherForm({ id: null, name: "", username: "", password: "" }); setTeacherModalOpen(true); }
    function openEditTeacherModal(teacher) { setTeacherForm({ id: teacher.id, name: teacher.name || "", username: teacher.username || "", password: "" }); setTeacherModalOpen(true); }

    async function submitTeacherForm(e) {
        e.preventDefault();
        setTeachersBusy(true);
        setError("");
        try {
            if (teacherForm.id) { await updateAdminTeacher(teacherForm.id, teacherForm); setMsg("Teacher updated."); }
            else { await createAdminTeacher(teacherForm); setMsg("Teacher created."); }
            playSound('success');
            setTeacherModalOpen(false);
            await Promise.all([refreshTeachers(), refreshSessions()]);
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setTeachersBusy(false); }
    }

    async function handleTeacherPhotoUpload(teacher, file) {
        if (!file) return;
        setPhotoBusyTeacherId(teacher.id);
        showLoader(`Uploading photo...`);
        try {
            await uploadTeacherPhoto(teacher.id, file, getAuthToken());
            playSound('uploadSuccess');
            setMsg(`Photo updated for ${teacher.name}.`);
            await refreshTeachers();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setPhotoBusyTeacherId(null); hideLoader(); }
    }

    async function handleTeacherPhotoRemove(teacher) {
        if (!confirm(`Remove photo for "${teacher.name}"?`)) return;
        setPhotoBusyTeacherId(teacher.id);
        showLoader(`Removing photo...`);
        try {
            await deleteTeacherPhoto(teacher.id);
            playSound('success');
            setMsg(`Photo removed.`);
            await refreshTeachers();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setPhotoBusyTeacherId(null); hideLoader(); }
    }

    async function handleTeacherDelete(teacher) {
        if (!confirm(`Delete "${teacher.name}"?`)) return;
        setTeachersBusy(true);
        try {
            await deleteAdminTeacher(teacher.id);
            playSound('success');
            setMsg("Teacher deleted.");
            await Promise.all([refreshTeachers(), refreshSessions(), refreshTimetable()]);
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setTeachersBusy(false); }
    }

    async function refreshAnnouncements() {
        const res = await getAdminAnnouncements();
        setAnnouncements(Array.isArray(res) ? res : []);
    }

    function resetAnnouncementForm() {
        setAnnouncementForm({ id: null, heading: "A fresh semester begins", content: "Respected {teacherName}, welcome to the new semester. Kindly review your class list, timetable and assigned periods once before taking attendance.", footer: "If anything goes wrong or does not work correctly, please inform the developer.", active: true });
    }

    async function handleSaveAnnouncement(e) {
        if (e) e.preventDefault();
        setAnnouncementBusy(true);
        try {
            if (announcementForm.id) { await updateAdminAnnouncement(announcementForm.id, announcementForm); setMsg("Broadcast updated."); }
            else { await createAdminAnnouncement(announcementForm); setMsg("Broadcast created."); }
            playSound('success');
            resetAnnouncementForm();
            await refreshAnnouncements();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setAnnouncementBusy(false); }
    }

    function handleEditAnnouncement(ann) {
        setAnnouncementForm({ id: ann.id, heading: ann.heading || "", content: ann.content || "", footer: ann.footer || "", active: ann.active ?? true });
    }

    async function handleDeleteAnnouncement(ann) {
        if (!confirm(`Delete "${ann.heading}"?`)) return;
        setAnnouncementBusy(true);
        try {
            await deleteAdminAnnouncement(ann.id);
            playSound('success');
            setMsg("Deleted.");
            if (announcementForm.id === ann.id) resetAnnouncementForm();
            await refreshAnnouncements();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setAnnouncementBusy(false); }
    }

    async function handleToggleAnnouncementActive(ann) {
        setAnnouncementBusy(true);
        try {
            const updated = !ann.active;
            await updateAdminAnnouncement(ann.id, { heading: ann.heading, content: ann.content, footer: ann.footer, active: updated });
            playSound('success');
            setMsg(`"${ann.heading}" is now ${updated ? 'active' : 'inactive'}.`);
            await refreshAnnouncements();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setAnnouncementBusy(false); }
    }

    async function handleOpenViewers(ann) {
        setViewersModal({ open: true, key: ann.announcementKey, heading: ann.heading, list: [], loading: true });
        try {
            const list = await getAnnouncementViewers(ann.announcementKey);
            setViewersModal(prev => ({ ...prev, list: Array.isArray(list) ? list : [], loading: false }));
        } catch (err) { setError(err.message); setViewersModal(prev => ({ ...prev, open: false, loading: false })); }
    }

    async function openTimetableEditor(classId, period, cell) {
        if (editingCell?.classId === classId && editingCell?.period === period) { setEditingCell(null); setSubjectOptions([]); setManualSubjectEntry(false); setTimetableEditor({ classId: "", period: "", teacherId: "", subject: "" }); return; }
        setEditingCell({ classId, period });
        setTimetableEditor({ classId, period, teacherId: cell?.teacherId ? String(cell.teacherId) : "", subject: cell?.subject || "" });
        setManualSubjectEntry(false);
        const teacherId = cell?.teacherId ? String(cell.teacherId) : "";
        if (!teacherId) { setSubjectOptions([]); return; }
        try {
            const options = await getTeacherSubjectOptions(teacherId);
            const normalized = Array.isArray(options) ? options : [];
            setSubjectOptions(normalized);
            if (cell?.subject && !normalized.includes(cell.subject)) setManualSubjectEntry(true);
        } catch (err) { setSubjectOptions([]); setError(err.message); }
    }

    async function handleTeacherChangeForCell(teacherId) {
        setTimetableEditor((prev) => ({ ...prev, teacherId, subject: "" }));
        setManualSubjectEntry(false);
        if (!teacherId) { setSubjectOptions([]); return; }
        try { const opts = await getTeacherSubjectOptions(teacherId); setSubjectOptions(Array.isArray(opts) ? opts : []); }
        catch (err) { setSubjectOptions([]); setError(err.message); }
    }

    async function saveTimetableCell() {
        if (!editingCell) return;
        setTimetableBusy(true);
        try {
            await updateTimetablePeriod({ classId: timetableEditor.classId, weekday: selectedWeekday, period: timetableEditor.period, teacherId: timetableEditor.teacherId || null, subject: timetableEditor.subject });
            playSound('success');
            setMsg("Timetable updated.");
            setEditingCell(null); setTimetableEditor({ classId: "", period: "", teacherId: "", subject: "" }); setSubjectOptions([]); setManualSubjectEntry(false);
            await refreshTimetable();
        } catch (err) { playSound('error'); setError(err.message); }
        finally { setTimetableBusy(false); }
    }

    const filteredTeachers = useMemo(() => {
        const q = teacherSearch.trim().toLowerCase();
        if (!q) return teachers;
        return teachers.filter(t => [t.name, t.username, t.passwordStatus, t.classTeacherOf].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
    }, [teacherSearch, teachers]);

    if (loading) return <PencilLoader />;

    return (
        <div className="min-h-screen bg-white/90 px-4 py-6 font-sans sm:px-6" style={{ backgroundColor: 'rgba(55, 151, 169, 0.04)' }}>
            <div className="mx-auto max-w-5xl space-y-6">

                {/* Header */}
                <div className="rounded-3xl p-6 sm:p-8" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#5eead4]">Administration</p>
                            <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">Settings</h1>
                            <p className="mt-2 text-sm text-white/60">Manage teachers, timetable & system</p>
                        </div>
                        <button onClick={() => router.push("/")} className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/20 transition-all">
                            Dashboard
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                    {TABS.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 whitespace-nowrap rounded-2xl px-5 py-3 text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-[#0d9488] text-white shadow-lg shadow-[#0d9488]/20' : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'}`}>
                            <span>{tab.icon}</span> {tab.label}
                        </button>
                    ))}
                </div>

                {/* Messages */}
                {msg && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700">{msg}</div>}
                {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">{error}</div>}

                {/* Overview Tab */}
                {activeTab === "overview" && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: "Students", value: systemInfo?.totalStudents, color: "teal" },
                                { label: "Teachers", value: systemInfo?.totalTeachers, color: "slate" },
                                { label: "Periods", value: systemInfo?.totalClasses, color: "cyan" },
                                { label: "Uptime", value: systemInfo?.serverUptime, color: "emerald" },
                            ].map(s => (
                                <div key={s.label} className={`rounded-2xl border border-${s.color}-100 bg-${s.color}-50/50 p-5`}>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{s.label}</p>
                                    <p className={`mt-2 text-2xl font-black text-${s.color}-900`}>{s.value || "—"}</p>
                                </div>
                            ))}
                        </div>

                        {/* Sessions */}
                        <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                            <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                                <h2 className="text-lg font-black text-gray-900">Active Sessions</h2>
                                <span className="text-xs font-bold text-gray-400">{sessions.length} teachers</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50/80">
                                        <tr>
                                            {["Teacher", "Username", "Class", "Last Login", "Status", ""].map(h => (
                                                <th key={h} className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {sessions.map(s => (
                                            <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-6 py-4 font-bold text-gray-800">{s.name}</td>
                                                <td className="px-6 py-4 font-mono text-xs font-bold text-[#0d9488]">{s.username}</td>
                                                <td className="px-6 py-4 text-sm text-gray-500">{s.class || "—"}</td>
                                                <td className="px-6 py-4 text-xs text-gray-400">{s.last_login || "Never"}</td>
                                                <td className="px-6 py-4">
                                                    {s.session_active ? (
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700 uppercase">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                                                        </span>
                                                    ) : (
                                                        <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black text-gray-400 uppercase">Offline</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {s.session_active && (
                                                        <button onClick={() => handleRevoke(s.id)} className="text-xs font-bold text-red-500 hover:text-red-700 transition-colors">Revoke</button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* Teachers Tab */}
                {activeTab === "teachers" && (
                    <div className="space-y-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <input type="text" value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)} placeholder="Search teachers..."
                                className="rounded-2xl border border-gray-100 bg-white px-5 py-3 text-sm font-medium outline-none focus:ring-4 focus:ring-[#0d9488]/10 flex-1 sm:max-w-xs" />
                            <button onClick={openCreateTeacherModal} className="rounded-2xl bg-[#0d9488] px-6 py-3 text-sm font-bold text-white hover:bg-[#0a7a70] transition-all shadow-lg shadow-[#0d9488]/20">
                                + Add Teacher
                            </button>
                        </div>
                        <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[800px] text-left">
                                    <thead className="bg-gray-50/80">
                                        <tr>
                                            {["Photo", "Name", "Username", "Status", "Class", "Actions"].map(h => (
                                                <th key={h} className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {filteredTeachers.map(teacher => (
                                            <tr key={teacher.id} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        {teacher.imageUrl ? (
                                                            <img src={teacher.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover border border-gray-100" />
                                                        ) : (
                                                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-sm font-black text-gray-400">
                                                                {teacher.name?.charAt(0) || "T"}
                                                            </div>
                                                        )}
                                                        <div className="flex flex-col gap-1">
                                                            <label className={`cursor-pointer rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white text-center transition-all ${photoBusyTeacherId === teacher.id ? "bg-gray-300" : "bg-[#0d9488] hover:bg-[#0a7a70]"}`}>
                                                                {photoBusyTeacherId === teacher.id ? "..." : "Photo"}
                                                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleTeacherPhotoUpload(teacher, f); }} />
                                                            </label>
                                                            <button onClick={() => handleTeacherPhotoRemove(teacher)} disabled={!teacher.imageUrl} className="rounded-lg border border-gray-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400 hover:text-red-500 disabled:opacity-30 transition-all">
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <p className="font-bold text-gray-800">{teacher.name}</p>
                                                    <p className="text-[10px] text-gray-400">ID {teacher.id}</p>
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs font-bold text-[#0d9488]">{teacher.username}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${teacher.hasPassword ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                                        {teacher.passwordStatus}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-500">{teacher.classTeacherOf || "—"}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex gap-2">
                                                        <button onClick={() => openEditTeacherModal(teacher)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-bold uppercase text-gray-600 hover:bg-gray-50 transition-all">Edit</button>
                                                        <button onClick={() => handleTeacherDelete(teacher)} disabled={teachersBusy} className="rounded-lg border border-red-100 px-3 py-1.5 text-[10px] font-bold uppercase text-red-500 hover:bg-red-50 disabled:opacity-50 transition-all">Delete</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* Timetable Tab */}
                {activeTab === "timetable" && (
                    <div className="space-y-6">
                        <div className="flex flex-wrap gap-2">
                            {DAYS.map((day, idx) => (
                                <button key={day} onClick={() => setSelectedWeekday(idx)}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${selectedWeekday === idx ? "bg-[#0d9488] text-white shadow-lg shadow-[#0d9488]/20" : "bg-white border border-gray-100 text-gray-500 hover:bg-gray-50"}`}>
                                    {day.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                        <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                            <div className="overflow-auto">
                                <table className="w-full min-w-[900px] text-left">
                                    <thead className="bg-gray-50/80">
                                        <tr>
                                            <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Class</th>
                                            {PERIODS.map(p => <th key={p} className="px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">{p}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {timetableRows.map(row => (
                                            <tr key={row.class}>
                                                <td className="px-6 py-4 font-bold text-gray-800">{row.class}</td>
                                                {PERIODS.map(period => {
                                                    const cell = row.periods?.[period] || {};
                                                    const isEditing = editingCell?.classId === row.class && editingCell?.period === period;
                                                    return (
                                                        <td key={period} className="px-4 py-3 align-top">
                                                            <div className={`rounded-2xl border p-3 transition-all cursor-pointer ${isEditing ? "border-[#0d9488]/30 bg-[#0d9488]/5 shadow-md" : "border-gray-100 bg-gray-50/50 hover:border-gray-200"}`}
                                                                onClick={() => openTimetableEditor(row.class, period, cell)}>
                                                                <p className="text-xs font-bold text-gray-700">{cell.subject || "—"}</p>
                                                                <p className="text-[10px] text-gray-400 mt-0.5">{cell.teacher || "Empty"}</p>
                                                            </div>
                                                            {isEditing && (
                                                                <div className="mt-2 space-y-2 rounded-xl border border-[#0d9488]/20 bg-white p-3 shadow-lg" onClick={e => e.stopPropagation()}>
                                                                    <select value={timetableEditor.teacherId} onChange={(e) => handleTeacherChangeForCell(e.target.value)}
                                                                        className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                                                        <option value="">Clear</option>
                                                                        {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                                    </select>
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[10px] font-bold text-gray-400 uppercase">Subject</label>
                                                                        <button onClick={() => setManualSubjectEntry(p => !p)} disabled={!timetableEditor.teacherId}
                                                                            className="text-[10px] font-bold text-[#0d9488] disabled:text-gray-300">{manualSubjectEntry ? "List" : "Type"}</button>
                                                                    </div>
                                                                    {manualSubjectEntry ? (
                                                                        <input list={`sub-${row.class}-${period}`} value={timetableEditor.subject} onChange={(e) => setTimetableEditor(p => ({ ...p, subject: e.target.value }))} disabled={!timetableEditor.teacherId}
                                                                            className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#0d9488]/20 disabled:bg-gray-100" />
                                                                    ) : (
                                                                        <select value={timetableEditor.subject} onChange={(e) => setTimetableEditor(p => ({ ...p, subject: e.target.value }))} disabled={!timetableEditor.teacherId}
                                                                            className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#0d9488]/20 disabled:bg-gray-100">
                                                                            <option value="">Select</option>
                                                                            {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                                                        </select>
                                                                    )}
                                                                    <div className="flex gap-2">
                                                                        <button onClick={() => { setEditingCell(null); setSubjectOptions([]); setManualSubjectEntry(false); setTimetableEditor({ classId: "", period: "", teacherId: "", subject: "" }); }}
                                                                            className="flex-1 rounded-xl border border-gray-100 py-2 text-[10px] font-bold uppercase text-gray-500">Cancel</button>
                                                                        <button onClick={saveTimetableCell} disabled={timetableBusy}
                                                                            className="flex-1 rounded-xl bg-[#0d9488] py-2 text-[10px] font-bold uppercase text-white hover:bg-[#0a7a70] disabled:opacity-50">Save</button>
                                                                    </div>
                                                                </div>
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
                    </div>
                )}

                {/* Broadcasts Tab */}
                {activeTab === "broadcasts" && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
                            <div className="rounded-3xl border border-gray-100 bg-white p-6 h-fit">
                                <h3 className="text-sm font-bold text-gray-900 mb-4">{announcementForm.id ? "Edit Broadcast" : "New Broadcast"}</h3>
                                <form onSubmit={handleSaveAnnouncement} className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Heading</label>
                                        <input type="text" value={announcementForm.heading} onChange={(e) => setAnnouncementForm(p => ({ ...p, heading: e.target.value }))}
                                            className="w-full rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" required />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Content</label>
                                        <textarea value={announcementForm.content} onChange={(e) => setAnnouncementForm(p => ({ ...p, content: e.target.value }))} rows={4}
                                            className="w-full rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20 resize-none" required />
                                        <p className="mt-1 text-[9px] font-bold text-[#0d9488] uppercase">Use {"{teacherName}"} for personalization</p>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Footer</label>
                                        <input type="text" value={announcementForm.footer} onChange={(e) => setAnnouncementForm(p => ({ ...p, footer: e.target.value }))}
                                            className="w-full rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                    </div>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input type="checkbox" checked={announcementForm.active} onChange={(e) => setAnnouncementForm(p => ({ ...p, active: e.target.checked }))}
                                            className="h-5 w-5 rounded border-gray-300 text-[#0d9488] focus:ring-[#0d9488]" />
                                        <span className="text-sm font-bold text-gray-600">Active</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <button type="submit" disabled={announcementBusy}
                                            className="flex-1 rounded-xl bg-[#0d9488] py-3 text-xs font-bold uppercase text-white hover:bg-[#0a7a70] disabled:opacity-50 transition-all">
                                            {announcementForm.id ? "Save" : "Publish"}
                                        </button>
                                        {announcementForm.id && (
                                            <button type="button" onClick={resetAnnouncementForm}
                                                className="rounded-xl border border-gray-200 px-4 py-3 text-xs font-bold uppercase text-gray-500 hover:bg-gray-50 transition-all">Cancel</button>
                                        )}
                                    </div>
                                </form>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-gray-900">History</h3>
                                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                                    {announcements.map(ann => (
                                        <div key={ann.id} className="rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-md transition-all">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${ann.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                                            {ann.active ? "Active" : "Off"}
                                                        </span>
                                                        <button onClick={() => handleOpenViewers(ann)} className="text-[9px] font-bold text-[#0d9488] hover:underline">
                                                            {ann.dismissedCount || 0} dismissed
                                                        </button>
                                                    </div>
                                                    <h4 className="mt-2 font-bold text-gray-900">{ann.heading}</h4>
                                                    <p className="mt-1 text-sm text-gray-500 line-clamp-2">{ann.content}</p>
                                                    <p className="mt-2 text-[9px] text-gray-300 uppercase">{ann.createdAt}</p>
                                                </div>
                                                <div className="flex gap-1.5 shrink-0">
                                                    <button onClick={() => handleEditAnnouncement(ann)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-bold uppercase text-gray-600 hover:bg-gray-50">Edit</button>
                                                    <button onClick={() => handleToggleAnnouncementActive(ann)}
                                                        className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase ${ann.active ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                                                        {ann.active ? "Disable" : "Enable"}
                                                    </button>
                                                    <button onClick={() => handleDeleteAnnouncement(ann)} className="rounded-lg border border-red-100 px-2.5 py-1.5 text-[10px] font-bold uppercase text-red-500 hover:bg-red-50">Del</button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* System Tab */}
                {activeTab === "system" && (
                    <div className="space-y-6">
                        {/* Namaz Monitor */}
                        <div className="rounded-3xl border border-gray-100 bg-white p-6">
                            <div className="flex items-center justify-between mb-5">
                                <h2 className="text-lg font-black text-gray-900">Namaz API</h2>
                                <button onClick={async () => { const m = await getNamazApiMonitor(); setNamazApiMonitor(m || null); }}
                                    className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-black transition-all">Refresh</button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="rounded-xl bg-emerald-50/50 border border-emerald-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Status</p>
                                    <p className="mt-1 text-lg font-black text-emerald-700">{namazApiMonitor?.apiStatus || "—"}</p>
                                </div>
                                <div className="rounded-xl bg-blue-50/50 border border-blue-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Sessions</p>
                                    <p className="mt-1 text-lg font-black text-blue-700">{namazApiMonitor?.sessionsReceivedToday ?? 0}</p>
                                </div>
                                <div className="rounded-xl bg-purple-50/50 border border-purple-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Last Sync</p>
                                    <p className="mt-1 text-xs font-bold text-purple-700 break-words">{namazApiMonitor?.lastSyncTime || "—"}</p>
                                </div>
                                <div className="rounded-xl bg-amber-50/50 border border-amber-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Last Session</p>
                                    <p className="mt-1 text-xs font-bold text-amber-700 break-words">
                                        {namazApiMonitor?.lastSessionReceived ? `${namazApiMonitor.lastSessionReceived.sessionName} ${namazApiMonitor.lastSessionReceived.className}` : "—"}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-5 rounded-2xl border border-gray-100 overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50/80">
                                        <tr>
                                            {["Time", "Status", "Session", "Source", "Message"].map(h => (
                                                <th key={h} className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {(namazApiMonitor?.recentEvents || []).map((e, i) => (
                                            <tr key={`${e.createdAt}-${i}`}>
                                                <td className="px-5 py-3 text-xs text-gray-500">{e.createdAt}</td>
                                                <td className="px-5 py-3">
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${e.status === "received" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{e.status}</span>
                                                </td>
                                                <td className="px-5 py-3 text-xs font-bold text-gray-700">{e.sessionId || "—"}</td>
                                                <td className="px-5 py-3 text-xs text-gray-500">{e.source || "—"}</td>
                                                <td className="px-5 py-3 text-xs text-gray-500">{e.message || "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Reset Data */}
                        <div className="rounded-3xl border border-gray-100 bg-white p-6">
                            <h2 className="text-lg font-black text-gray-900 mb-4">Reset Data</h2>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Category</label>
                                    <select value={resetConfig.category} onChange={(e) => setResetConfig(p => ({ ...p, category: e.target.value }))}
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                        <option value="all">All</option>
                                        <option value="namaz">Namaz</option>
                                        <option value="program">Events</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Class</label>
                                    <select value={resetConfig.className} onChange={(e) => setResetConfig(p => ({ ...p, className: e.target.value }))}
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                        <option value="all">All</option>
                                        {["HS1", "HSU1", "HS2", "HSU2", "BS1", "BS2", "BS3", "BS4", "BS5"].map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Date</label>
                                    <select value={resetConfig.dateMode} onChange={(e) => setResetConfig(p => ({ ...p, dateMode: e.target.value, date: e.target.value === "all" ? "all" : getIstDateString() }))}
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                        <option value="all">All Time</option>
                                        <option value="single">Specific</option>
                                    </select>
                                </div>
                                <button onClick={handleResetData} disabled={resettingData}
                                    className="rounded-xl bg-red-600 px-5 py-3 text-sm font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50 transition-all">
                                    {resettingData ? "..." : "Reset"}
                                </button>
                            </div>
                        </div>

                        {/* Password + DB */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="rounded-3xl border border-gray-100 bg-white p-6">
                                <h2 className="text-lg font-black text-gray-900 mb-4">Change Password</h2>
                                <form onSubmit={handlePasswordChange} className="space-y-3">
                                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password"
                                        className="w-full rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password"
                                        className="w-full rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                    <button type="submit" disabled={updatingPassword}
                                        className="w-full rounded-xl bg-[#0d9488] py-3 text-sm font-bold uppercase text-white hover:bg-[#0a7a70] disabled:opacity-50 transition-all">
                                        {updatingPassword ? "Updating..." : "Update Password"}
                                    </button>
                                </form>
                            </div>
                            <div className="rounded-3xl border border-gray-100 bg-white p-6">
                                <h2 className="text-lg font-black text-gray-900 mb-4">Database</h2>
                                <div className="space-y-3">
                                    <button onClick={handleDownload} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-100 transition-all">
                                        ⬇ Download DB
                                    </button>
                                    <label className={`block w-full rounded-xl px-5 py-3 text-center text-sm font-bold cursor-pointer transition-all ${uploading ? "bg-gray-200 text-gray-500" : "bg-[#0d9488] text-white hover:bg-[#0a7a70]"}`}>
                                        {uploading ? "Uploading..." : "⬆ Upload DB"}
                                        <input type="file" className="hidden" accept=".db" onChange={handleUpload} disabled={uploading} />
                                    </label>
                                    <p className="text-[10px] text-gray-400 text-center">{systemInfo?.dbPath}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Teacher Modal */}
                {teacherModalOpen && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setTeacherModalOpen(false); }}>
                        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl">
                            <h3 className="text-lg font-black text-gray-900">{teacherForm.id ? "Edit Teacher" : "Add Teacher"}</h3>
                            <form onSubmit={submitTeacherForm} className="mt-5 space-y-3">
                                <input type="text" value={teacherForm.name} onChange={(e) => setTeacherForm(p => ({ ...p, name: e.target.value }))} placeholder="Name" required
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                <input type="text" value={teacherForm.username} onChange={(e) => setTeacherForm(p => ({ ...p, username: e.target.value }))} placeholder="Username" required
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                <input type="password" value={teacherForm.password} onChange={(e) => setTeacherForm(p => ({ ...p, password: e.target.value }))}
                                    placeholder={teacherForm.id ? "Leave blank to keep" : "Default password"}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                <div className="flex gap-2 pt-2">
                                    <button type="button" onClick={() => setTeacherModalOpen(false)}
                                        className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">Cancel</button>
                                    <button type="submit" disabled={teachersBusy}
                                        className="flex-1 rounded-xl bg-[#0d9488] py-3 text-sm font-bold text-white hover:bg-[#0a7a70] disabled:opacity-50 transition-all">
                                        {teachersBusy ? "..." : (teacherForm.id ? "Save" : "Create")}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Viewers Modal */}
                {viewersModal.open && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setViewersModal(p => ({ ...p, open: false })); }}>
                        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-black text-gray-900 truncate">{viewersModal.heading}</h3>
                                <button onClick={() => setViewersModal(p => ({ ...p, open: false }))} className="text-gray-400 hover:text-gray-600">✕</button>
                            </div>
                            <div className="mt-5 max-h-[350px] overflow-y-auto space-y-2">
                                {viewersModal.loading ? (
                                    <div className="py-12 flex justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0d9488] border-t-transparent" /></div>
                                ) : (
                                    viewersModal.list.map(v => (
                                        <div key={v.id} className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 p-4">
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{v.name}</p>
                                                <p className="text-[10px] font-bold text-[#0d9488]">@{v.username}</p>
                                            </div>
                                            <p className="text-xs text-gray-500">{v.dismissedAt}</p>
                                        </div>
                                    ))
                                )}
                                {!viewersModal.loading && viewersModal.list.length === 0 && (
                                    <p className="py-12 text-center text-xs font-bold text-gray-400 uppercase">No viewers yet</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
