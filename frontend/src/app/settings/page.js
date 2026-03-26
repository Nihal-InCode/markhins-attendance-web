"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";

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
    const { showLoader, hideLoader } = useLoading();

    useEffect(() => {
        if (!user || user.role !== 'admin') {
            router.push("/");
            return;
        }
        fetchData();
    }, [user]);

    async function fetchData() {
        setLoading(true);
        setMsg("");
        setError("");
        showLoader("Fetching system settings...");
        try {
            const [sessRes, infoRes] = await Promise.all([
                apiRequest("/admin/sessions"),
                apiRequest("/admin/system-info")
            ]);

            // apiRequest already unwraps .data if it exists
            setSessions(sessRes.sessions || []);
            setSystemInfo(infoRes || null);
        } catch (err) {
            console.error(err);
            setError("Failed to load admin data: " + err.message);
        } finally {
            setLoading(false);
            hideLoader();
        }
    }

    async function handleRevoke(teacherId) {
        if (!confirm("Are you sure you want to log out this teacher?")) return;
        showLoader("Revoking session...");
        try {
            await apiRequest("/admin/revoke-session", {
                method: "POST",
                body: JSON.stringify({ teacherId })
            });
            fetchData();
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
                fetchData();
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

    if (loading) return <PencilLoader />;

    return (
        <div className="min-h-screen bg-gray-50 p-6 font-sans">
            <div className="max-w-4xl mx-auto space-y-8">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-black text-gray-900">Admin Settings</h1>
                    <button onClick={() => router.push("/")} className="text-blue-600 font-bold">← Back to Dashboard</button>
                </div>

                {msg && <div className="p-4 bg-green-100 text-green-700 rounded-2xl font-bold anim-fade-in">{msg}</div>}
                {error && <div className="p-4 bg-red-100 text-red-700 rounded-2xl font-bold anim-fade-in">{error}</div>}

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
            </div>
        </div>
    );
}
