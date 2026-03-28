"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
    apiRequest,
    createAdminTeacher,
    deleteAdminTeacher,
    getAdminTeachers,
    getAdminTimetable,
    getTeacherSubjectOptions,
    updateAdminTeacher,
    updateTimetablePeriod,
} from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PERIODS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];

export default function SettingsPage() {
    const { user, token } = useAuth();
    const router = useRouter();
    const [sessions, setSessions] = useState([]);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);
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
    const [selectedWeekday, setSelectedWeekday] = useState(new Date().getDay() === 0 ? 0 : new Date().getDay() - 1);
    const [timetableRows, setTimetableRows] = useState([]);
    const [editingCell, setEditingCell] = useState(null);
    const [timetableBusy, setTimetableBusy] = useState(false);
    const [subjectOptions, setSubjectOptions] = useState([]);
    const [timetableEditor, setTimetableEditor] = useState({ classId: "", period: "", teacherId: "", subject: "" });
    const { showLoader, hideLoader } = useLoading();

    const fetchData = useCallback(async () => {
        setLoading(true);
        setMsg("");
        setError("");
        showLoader("Fetching system settings...");
        try {
            const [sessRes, infoRes, teacherRes, timetableRes] = await Promise.all([
                apiRequest("/admin/sessions"),
                apiRequest("/admin/system-info"),
                getAdminTeachers(),
                getAdminTimetable(selectedWeekday)
            ]);

            // apiRequest already unwraps .data if it exists
            setSessions(sessRes.sessions || []);
            setSystemInfo(infoRes || null);
            setTeachers(Array.isArray(teacherRes) ? teacherRes : []);
            setTimetableRows(Array.isArray(timetableRes) ? timetableRes : []);
        } catch (err) {
            console.error(err);
            setError("Failed to load admin data: " + err.message);
        } finally {
            setLoading(false);
            hideLoader();
        }
    }, [hideLoader, selectedWeekday, showLoader]);

    useEffect(() => {
        if (!user || user.role !== 'admin') {
            router.push("/");
            return;
        }
        fetchData();
    }, [fetchData, router, user]);

    async function refreshTeachers() {
        const teacherRes = await getAdminTeachers();
        setTeachers(Array.isArray(teacherRes) ? teacherRes : []);
    }

    async function refreshTimetable() {
        const timetableRes = await getAdminTimetable(selectedWeekday);
        setTimetableRows(Array.isArray(timetableRes) ? timetableRes : []);
    }

    async function refreshSessions() {
        const sessRes = await apiRequest("/admin/sessions");
        setSessions(sessRes.sessions || []);
    }

    async function handleRevoke(teacherId) {
        if (!confirm("Are you sure you want to log out this teacher?")) return;
        showLoader("Revoking session...");
        try {
            await apiRequest("/admin/revoke-session", {
                method: "POST",
                body: JSON.stringify({ teacherId })
            });
            await refreshSessions();
            setMsg("Session revoked successfully.");
        } catch (err) {
            setError(err.message);
        } finally {
            hideLoader();
        }
    }

    async function handleUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm("This will REPLACE the web database. Are you sure?")) return;

        setUploading(true);
        setError("");
        showLoader("Uploading system database...", { showProgress: true, progress: 45 });
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/admin/upload-db`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                playSound('uploadSuccess');
                setMsg("Database uploaded successfully!");
                await fetchData();
            } else {
                playSound('error');
                throw new Error(data.message || "Upload failed");
            }
        } catch (err) {
            playSound('error');
            setError("Upload Error: " + err.message);
        } finally {
            setUploading(false);
            hideLoader();
        }
    }

    function handleDownload() {
        const url = `${process.env.NEXT_PUBLIC_API_URL || ""}/admin/download-db`;
        const a = document.createElement('a');
        a.href = url + `?token=${token}`; // Some browsers might need this if they don't support fetch-based download easily
        // Better: use fetch with auth and create blob
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
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
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        if (newPassword.length < 6) {
            setError("Password must be at least 6 characters.");
            return;
        }

        setUpdatingPassword(true);
        setError("");
        showLoader("Updating admin password...");

        try {
            const res = await apiRequest("/admin/update-password", {
                method: "POST",
                body: JSON.stringify({ password: newPassword })
            });

            if (res.success) {
                playSound('success');
                setMsg("Admin password updated successfully! Please note this down securely.");
                setNewPassword("");
                setConfirmPassword("");
            } else {
                throw new Error(res.message || "Failed to update password");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setUpdatingPassword(false);
            hideLoader();
        }
    }

    function openCreateTeacherModal() {
        setTeacherForm({ id: null, name: "", username: "", password: "" });
        setTeacherModalOpen(true);
    }

    function openEditTeacherModal(teacher) {
        setTeacherForm({
            id: teacher.id,
            name: teacher.name || "",
            username: teacher.username || "",
            password: "",
        });
        setTeacherModalOpen(true);
    }

    async function submitTeacherForm(e) {
        e.preventDefault();
        setTeachersBusy(true);
        setError("");
        setMsg("");
        try {
            if (teacherForm.id) {
                await updateAdminTeacher(teacherForm.id, teacherForm);
                setMsg("Teacher updated successfully.");
            } else {
                await createAdminTeacher(teacherForm);
                setMsg("Teacher added successfully.");
            }
            playSound('success');
            setTeacherModalOpen(false);
            await Promise.all([refreshTeachers(), refreshSessions()]);
        } catch (err) {
            playSound('error');
            setError(err.message);
        } finally {
            setTeachersBusy(false);
        }
    }

    async function handleTeacherDelete(teacher) {
        if (!confirm(`Delete teacher "${teacher.name}"? This will remove current timetable assignments.`)) return;
        setTeachersBusy(true);
        setError("");
        setMsg("");
        try {
            await deleteAdminTeacher(teacher.id);
            playSound('success');
            setMsg("Teacher deleted successfully.");
            await Promise.all([refreshTeachers(), refreshSessions(), refreshTimetable()]);
        } catch (err) {
            playSound('error');
            setError(err.message);
        } finally {
            setTeachersBusy(false);
        }
    }

    async function openTimetableEditor(classId, period, cell) {
        setEditingCell({ classId, period });
        const teacherId = cell?.teacherId ? String(cell.teacherId) : "";
        setTimetableEditor({
            classId,
            period,
            teacherId,
            subject: cell?.subject || "",
        });
        if (!teacherId) {
            setSubjectOptions([]);
            return;
        }
        try {
            const options = await getTeacherSubjectOptions(teacherId);
            setSubjectOptions(Array.isArray(options) ? options : []);
        } catch (err) {
            setSubjectOptions([]);
            setError(err.message);
        }
    }

    async function handleTeacherChangeForCell(teacherId) {
        setTimetableEditor((prev) => ({ ...prev, teacherId, subject: "" }));
        if (!teacherId) {
            setSubjectOptions([]);
            return;
        }
        try {
            const options = await getTeacherSubjectOptions(teacherId);
            setSubjectOptions(Array.isArray(options) ? options : []);
        } catch (err) {
            setSubjectOptions([]);
            setError(err.message);
        }
    }

    async function saveTimetableCell() {
        if (!editingCell) return;
        setTimetableBusy(true);
        setError("");
        setMsg("");
        try {
            await updateTimetablePeriod({
                classId: timetableEditor.classId,
                weekday: selectedWeekday,
                period: timetableEditor.period,
                teacherId: timetableEditor.teacherId || null,
                subject: timetableEditor.subject,
            });
            playSound('success');
            setMsg("Timetable updated successfully.");
            setEditingCell(null);
            setTimetableEditor({ classId: "", period: "", teacherId: "", subject: "" });
            setSubjectOptions([]);
            await refreshTimetable();
        } catch (err) {
            playSound('error');
            setError(err.message);
        } finally {
            setTimetableBusy(false);
        }
    }

    const filteredTeachers = useMemo(() => {
        const query = teacherSearch.trim().toLowerCase();
        if (!query) return teachers;
        return teachers.filter((teacher) =>
            [teacher.name, teacher.username, teacher.passwordStatus, teacher.classTeacherOf]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query))
        );
    }, [teacherSearch, teachers]);

    if (loading) return <PencilLoader />;

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-6 font-sans sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-8">
                <div className="flex flex-col gap-4 rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Administration</p>
                        <h1 className="mt-2 text-3xl font-black text-gray-900">Admin Settings</h1>
                        <p className="mt-2 text-sm font-medium text-gray-500">Manage teacher accounts, timetable assignments and system access from one place.</p>
                    </div>
                    <button
                        onClick={() => router.push("/")}
                        className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 px-5 py-3 text-sm font-black text-gray-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                        Back to Dashboard
                    </button>
                </div>

                {msg && <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm font-bold text-green-700 anim-fade-in">{msg}</div>}
                {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700 anim-fade-in">{error}</div>}

                {/* System Info */}
                <section className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <h2 className="text-xl font-black mb-6 flex items-center gap-2"><span>🖥️</span> System Overview</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="bg-blue-50 p-4 rounded-3xl">
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Database Students</p>
                            <p className="text-2xl font-black text-blue-900">{systemInfo?.totalStudents}</p>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-3xl">
                            <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Total Teachers</p>
                            <p className="text-2xl font-black text-purple-900">{systemInfo?.totalTeachers}</p>
                        </div>
                        <div className="bg-amber-50 p-4 rounded-3xl">
                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Periods Marked</p>
                            <p className="text-2xl font-black text-amber-900">{systemInfo?.totalClasses}</p>
                        </div>
                        <div className="bg-green-50 p-4 rounded-3xl">
                            <p className="text-[10px] font-black text-green-500 uppercase tracking-widest">Uptime</p>
                            <p className="text-lg font-black text-green-900">{systemInfo?.serverUptime}</p>
                        </div>
                    </div>
                    <p className="mt-4 text-[10px] font-bold text-gray-400">DB PATH: {systemInfo?.dbPath}</p>
                </section>

                {/* Database Management */}
                <section className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <h2 className="text-xl font-black mb-6 flex items-center gap-2"><span>💾</span> Database Management</h2>
                    <div className="flex flex-col md:flex-row gap-4">
                        <button
                            onClick={handleDownload}
                            className="flex-1 bg-gray-900 text-white py-4 rounded-3xl font-black hover:bg-black transition-all"
                        >
                            Download Database (.db)
                        </button>
                        <div className="flex-1 relative">
                            <input
                                type="file"
                                accept=".db"
                                onChange={handleUpload}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                disabled={uploading}
                            />
                            <div className="bg-blue-600 text-white py-4 rounded-3xl font-black text-center hover:bg-blue-700 transition-all">
                                {uploading ? "Uploading..." : "Upload & Replace DB"}
                            </div>
                        </div>
                    </div>
                </section>

                {/* System Security */}
                <section className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <h2 className="text-xl font-black mb-6 flex items-center gap-2"><span>🔐</span> System Security</h2>
                    <p className="text-xs text-gray-400 mb-6 font-bold uppercase tracking-wider">Change System Administrative Password</p>
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">New Password</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-6 py-4 rounded-2xl border border-gray-50 bg-gray-50/50 outline-none focus:ring-4 focus:ring-blue-100/50 focus:bg-white font-bold transition-all text-sm"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Confirm Password</label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-6 py-4 rounded-2xl border border-gray-50 bg-gray-50/50 outline-none focus:ring-4 focus:ring-blue-100/50 focus:bg-white font-bold transition-all text-sm"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={updatingPassword}
                            className="bg-blue-600 text-white px-8 py-4 rounded-3xl font-black hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-50"
                        >
                            Update Security Password
                        </button>
                    </form>
                </section>

                <section className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h2 className="text-xl font-black text-gray-900">Manage Teachers</h2>
                            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-400">Create, edit and delete teacher accounts</p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <input
                                type="text"
                                value={teacherSearch}
                                onChange={(e) => setTeacherSearch(e.target.value)}
                                placeholder="Search teachers"
                                className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100"
                            />
                            <button
                                onClick={openCreateTeacherModal}
                                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black uppercase tracking-wider text-white hover:bg-blue-700 transition-all"
                            >
                                Add Teacher
                            </button>
                        </div>
                    </div>
                    <div className="mt-6 overflow-hidden rounded-[2rem] border border-gray-100">
                        <div className="max-h-[28rem] overflow-auto">
                            <table className="w-full min-w-[720px] text-left">
                                <thead className="bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Name</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Username</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Class</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {filteredTeachers.map((teacher) => (
                                        <tr key={teacher.id}>
                                            <td className="px-6 py-4">
                                                <p className="font-black text-gray-800">{teacher.name}</p>
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">
                                                    {teacher.sessionActive ? "Session active" : "No active session"}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4 font-mono text-sm font-bold text-blue-700">{teacher.username}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${teacher.hasPassword ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                                    {teacher.passwordStatus}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-semibold text-gray-500">{teacher.classTeacherOf || "-"}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => openEditTeacherModal(teacher)}
                                                        className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-black uppercase tracking-wider text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleTeacherDelete(teacher)}
                                                        disabled={teachersBusy}
                                                        className="px-3 py-2 rounded-xl border border-red-200 text-xs font-black uppercase tracking-wider text-red-600 hover:bg-red-50 disabled:opacity-50"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredTeachers.length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-10 text-center text-xs font-bold uppercase tracking-widest text-gray-400">
                                                No teachers found
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <section className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-xl font-black text-gray-900">Editable Timetable</h2>
                            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-400">Click any period cell to edit teacher and subject</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {DAYS.map((day, idx) => (
                                <button
                                    key={day}
                                    onClick={() => setSelectedWeekday(idx)}
                                    className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider transition-all ${selectedWeekday === idx ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : "bg-white border border-gray-100 text-gray-500 hover:bg-gray-50"}`}
                                >
                                    {day.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mt-6 overflow-hidden rounded-[2rem] border border-gray-100">
                        <div className="overflow-auto">
                            <table className="w-full min-w-[980px] text-left">
                                <thead className="bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Class</th>
                                        {PERIODS.map((period) => (
                                            <th key={period} className="px-4 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">{period}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {timetableRows.map((row) => (
                                        <tr key={row.class}>
                                            <td className="px-6 py-4 font-black text-gray-800">{row.class}</td>
                                            {PERIODS.map((period) => {
                                                const cell = row.periods?.[period] || {};
                                                const isEditing = editingCell?.classId === row.class && editingCell?.period === period;
                                                return (
                                                    <td key={period} className="px-4 py-4 align-top">
                                                        <button
                                                            onClick={() => openTimetableEditor(row.class, period, cell)}
                                                            className={`w-full rounded-[1.5rem] border p-4 text-left transition-all ${isEditing ? "border-blue-300 bg-blue-50" : "border-gray-100 bg-gray-50 hover:bg-white hover:border-blue-200"}`}
                                                        >
                                                            <p className="text-sm font-black text-gray-800">{cell.subject || "No subject assigned"}</p>
                                                            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{cell.teacher || "Select teacher"}</p>
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {editingCell && (
                        <div className="mt-6 rounded-[2rem] border border-blue-100 bg-blue-50/60 p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-blue-500">Editing Cell</p>
                                    <h3 className="mt-2 text-xl font-black text-gray-900">{editingCell.classId} • {editingCell.period} • {DAYS[selectedWeekday]}</h3>
                                </div>
                                <button
                                    onClick={() => {
                                        setEditingCell(null);
                                        setSubjectOptions([]);
                                        setTimetableEditor({ classId: "", period: "", teacherId: "", subject: "" });
                                    }}
                                    className="px-4 py-3 rounded-2xl bg-white border border-gray-100 text-xs font-black uppercase tracking-wider text-gray-500"
                                >
                                    Close Editor
                                </button>
                            </div>
                            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
                                <div>
                                    <label className="block mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Teacher</label>
                                    <select
                                        value={timetableEditor.teacherId}
                                        onChange={(e) => handleTeacherChangeForCell(e.target.value)}
                                        className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-4 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100"
                                    >
                                        <option value="">Clear assignment</option>
                                        {teachers.map((teacher) => (
                                            <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Subject</label>
                                    <select
                                        value={timetableEditor.subject}
                                        onChange={(e) => setTimetableEditor((prev) => ({ ...prev, subject: e.target.value }))}
                                        disabled={!timetableEditor.teacherId}
                                        className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-4 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    >
                                        <option value="">Select subject</option>
                                        {subjectOptions.map((subject) => (
                                            <option key={subject} value={subject}>{subject}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-3 lg:justify-end">
                                    <button
                                        onClick={() => setTimetableEditor((prev) => ({ ...prev, teacherId: "", subject: "" }))}
                                        className="px-4 py-4 rounded-2xl border border-gray-100 bg-white text-xs font-black uppercase tracking-wider text-gray-500"
                                    >
                                        Clear
                                    </button>
                                    <button
                                        onClick={saveTimetableCell}
                                        disabled={timetableBusy}
                                        className="px-5 py-4 rounded-2xl bg-blue-600 text-xs font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        Save Period
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* Teacher Sessions */}
                <section className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-8 border-b border-gray-50">
                        <h2 className="text-xl font-black flex items-center gap-2"><span>👥</span> Active Teacher Sessions</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Teacher</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Username</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Password</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Class</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Last Login (IST)</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                                    <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {sessions.map(s => (
                                    <tr key={s.id}>
                                        <td className="px-8 py-5 font-bold text-gray-800">{s.name}</td>
                                        <td className="px-8 py-5 text-blue-600 font-mono text-xs font-bold bg-blue-50/30">{s.username}</td>
                                        <td className="px-8 py-5 text-indigo-600 font-mono text-xs font-bold bg-indigo-50/20">{s.password}</td>
                                        <td className="px-8 py-5 text-gray-500 font-medium">{s.class || "-"}</td>
                                        <td className="px-8 py-5 text-gray-400 text-sm text-center">{s.last_login || "Never"}</td>
                                        <td className="px-8 py-5 text-center">
                                            {s.session_active ? (
                                                <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">Active</span>
                                            ) : (
                                                <span className="bg-gray-100 text-gray-400 px-3 py-1 rounded-full text-[10px] font-black uppercase">None</span>
                                            )}
                                        </td>
                                        <td className="px-8 py-5 text-right">
                                            {s.session_active && (
                                                <button
                                                    onClick={() => handleRevoke(s.id)}
                                                    className="text-red-500 font-black text-xs uppercase tracking-wider hover:underline"
                                                >
                                                    Revoke
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                {teacherModalOpen && (
                    <div
                        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setTeacherModalOpen(false);
                        }}
                    >
                        <div className="w-full max-w-lg rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-2xl">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Manage Teacher</p>
                                    <h3 className="mt-2 text-2xl font-black text-gray-900">{teacherForm.id ? "Edit Teacher" : "Add Teacher"}</h3>
                                </div>
                                <button
                                    onClick={() => setTeacherModalOpen(false)}
                                    className="px-3 py-2 rounded-2xl bg-gray-100 text-xs font-black uppercase tracking-wider text-gray-500"
                                >
                                    Close
                                </button>
                            </div>
                            <form onSubmit={submitTeacherForm} className="mt-6 space-y-4">
                                <input
                                    type="text"
                                    value={teacherForm.name}
                                    onChange={(e) => setTeacherForm((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="Teacher name"
                                    className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100"
                                    required
                                />
                                <input
                                    type="text"
                                    value={teacherForm.username}
                                    onChange={(e) => setTeacherForm((prev) => ({ ...prev, username: e.target.value }))}
                                    placeholder="Unique username"
                                    className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100"
                                    required
                                />
                                <input
                                    type="password"
                                    value={teacherForm.password}
                                    onChange={(e) => setTeacherForm((prev) => ({ ...prev, password: e.target.value }))}
                                    placeholder={teacherForm.id ? "Leave blank to keep current password" : "Leave blank to use default login"}
                                    className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100"
                                />
                                <button
                                    type="submit"
                                    disabled={teachersBusy}
                                    className="w-full px-5 py-4 rounded-2xl bg-blue-600 text-sm font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {teacherForm.id ? "Save Teacher" : "Create Teacher"}
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
