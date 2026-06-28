"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getMyProfile, updateCredentials, getTeachingStats } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";

export default function ProfilePage() {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();
    const showLoaderRef = useRef(showLoader);
    const hideLoaderRef = useRef(hideLoader);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ username: "", password: "" });
    const [successMsg, setSuccessMsg] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        showLoaderRef.current = showLoader;
        hideLoaderRef.current = hideLoader;
    }, [showLoader, hideLoader]);

    useEffect(() => {
        async function fetchProfile() {
            showLoaderRef.current("Loading profile...");
            try {
                const data = await getMyProfile();
                setProfile(data);
                setFormData({ username: data.username || "", password: "" });
            } catch (err) { setError("Failed to load profile."); }
            finally { setLoading(false); hideLoaderRef.current(); }
        }
        async function fetchStats() {
            try { const data = await getTeachingStats(); setStats(data); }
            catch (err) { console.error(err); }
            finally { setStatsLoading(false); }
        }
        fetchProfile();
        fetchStats();
    }, []);

    const handleUpdate = async (e) => {
        e.preventDefault();
        setSuccessMsg(""); setError("");
        if (!formData.username || !formData.password) { setError("Both fields required."); return; }
        showLoader("Updating...");
        try {
            const res = await updateCredentials(formData);
            if (res.success) {
                setSuccessMsg("Credentials updated!"); playSound('uploadSuccess'); setShowModal(false);
                const data = await getMyProfile(); setProfile(data);
            } else throw new Error(res.error || "Failed");
        } catch (err) { setError(err.message); playSound('error'); }
        finally { hideLoader(); }
    };

    if (loading) return <PencilLoader />;

    return (
        <div className="min-h-screen font-sans" style={{ backgroundColor: 'rgba(55, 151, 169, 0.04)' }}>
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-b-[2.5rem] px-4 pt-6 pb-24 sm:px-6" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
                <div className="mx-auto max-w-3xl">
                    <div className="flex items-center justify-between mb-6">
                        <button onClick={() => router.push("/")} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-all">
                            ← Back
                        </button>
                    </div>
                    <div className="flex items-center gap-5">
                        <div className="shrink-0">
                            {profile?.imageUrl ? (
                                <img src={profile.imageUrl} alt="" className="h-20 w-20 rounded-2xl object-cover border-2 border-white/20 shadow-lg" />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black text-white border border-white/20">
                                    {profile?.name?.charAt(0) || "T"}
                                </div>
                            )}
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-2xl font-black text-white truncate">{profile?.name}</h1>
                            <p className="text-sm text-white/50 font-medium">@{profile?.username}</p>
                            <div className="mt-2 flex items-center gap-2">
                                <span className="rounded-full bg-[#5eead4] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#082231]">
                                    {profile?.role}
                                </span>
                                {profile?.class_teacher_of && (
                                    <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/80">
                                        {profile.class_teacher_of} Class Teacher
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="mx-auto max-w-3xl -mt-12 px-4 pb-8 sm:px-6 space-y-5">

                {/* Messages */}
                {successMsg && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700">{successMsg}</div>}
                {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">{error}</div>}

                {/* Profile Info */}
                <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-black text-gray-900 mb-4">Account Details</h2>
                    <div className="space-y-3">
                        {[
                            { label: "Full Name", value: profile?.name },
                            { label: "Username", value: profile?.username },
                            { label: "Main Subject", value: profile?.main_subject || "—" },
                            { label: "Class Assigned", value: profile?.class_teacher_of?.toUpperCase() || "Not assigned" },
                        ].map(item => (
                            <div key={item.label} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                                <span className="text-sm text-gray-400 font-medium">{item.label}</span>
                                <span className="text-sm font-bold text-gray-800">{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Teaching Assignments */}
                <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-black text-gray-900 mb-4">Teaching Assignments</h2>
                    {profile?.subjects?.length > 0 ? (
                        <div className="space-y-2">
                            {profile.subjects.map((s, idx) => (
                                <div key={idx} className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 hover:border-[#0d9488]/20 transition-all">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d9488]/10 text-xs font-black text-[#0d9488]">
                                            {s.class}
                                        </span>
                                        <span className="text-sm font-bold text-gray-700">{s.subject}</span>
                                    </div>
                                    <span className="text-[9px] font-bold text-gray-300 uppercase">Assigned</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                            <p className="text-xs font-bold text-gray-400 uppercase">No subjects assigned</p>
                        </div>
                    )}
                </div>

                {/* Teaching Stats */}
                <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-black text-gray-900 mb-4">Teaching Statistics</h2>
                    {statsLoading ? (
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-gray-100 animate-pulse" />)}
                        </div>
                    ) : !stats ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                            <p className="text-xs font-bold text-gray-400 uppercase">No data</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: "Today", value: stats.today, color: "bg-[#0d9488]" },
                                    { label: "This Week", value: stats.thisWeek, color: "bg-[#14b8a6]" },
                                    { label: "This Month", value: stats.thisMonth, color: "bg-[#0f766e]" },
                                    { label: "All Time", value: stats.allTime, color: "bg-gray-700" },
                                ].map(s => (
                                    <div key={s.label} className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 rounded-full ${s.color}`} />
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{s.label}</p>
                                        </div>
                                        <p className="mt-2 text-2xl font-black text-gray-800">{s.value}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Class Breakdown</p>
                                <div className="space-y-2">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-gray-600">Regular</span>
                                            <span className="text-xs font-black text-gray-800">{stats.regularClasses}</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-[#0d9488] rounded-full transition-all" style={{ width: stats.allTime > 0 ? `${(stats.regularClasses / stats.allTime) * 100}%` : '0%' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-gray-600">Extra</span>
                                            <span className="text-xs font-black text-gray-800">{stats.extraClasses}</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: stats.allTime > 0 ? `${(stats.extraClasses / stats.allTime) * 100}%` : '0%' }} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Top Class</p>
                                    <p className="mt-1.5 text-sm font-black text-gray-800 truncate">{stats.mostTaughtClass}</p>
                                </div>
                                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Active Day</p>
                                    <p className="mt-1.5 text-sm font-black text-gray-800 truncate">{stats.mostActiveDay}</p>
                                </div>
                            </div>

                            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Last Class</p>
                                    <p className="mt-1 text-sm font-bold text-gray-800">{stats.lastClassConducted}</p>
                                </div>
                                <span className="text-lg">⏱️</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Change Login Button */}
                <button onClick={() => setShowModal(true)}
                    className="w-full rounded-2xl border border-gray-100 bg-white py-4 text-sm font-bold text-gray-600 shadow-sm hover:bg-gray-50 transition-all">
                    🔑 Change Login Credentials
                </button>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
                    <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
                        <h3 className="text-lg font-black text-gray-900">Update Login</h3>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Set new credentials</p>
                        <form onSubmit={handleUpdate} className="mt-5 space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Username</label>
                                <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">New Password</label>
                                <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setShowModal(false)}
                                    className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">Cancel</button>
                                <button type="submit"
                                    className="flex-1 rounded-xl bg-[#0d9488] py-3 text-sm font-bold text-white hover:bg-[#0a7a70] transition-all">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
