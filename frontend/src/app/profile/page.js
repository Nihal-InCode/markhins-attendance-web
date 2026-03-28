"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getMyProfile, updateCredentials } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import PencilLoader from "@/components/PencilLoader";

export default function ProfilePage() {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
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
            } catch (err) {
                setError("Failed to load profile data.");
            } finally {
                setLoading(false);
                hideLoaderRef.current();
            }
        }
        fetchProfile();
    }, []);

    const handleUpdate = async (e) => {
        e.preventDefault();
        setSuccessMsg("");
        setError("");

        if (!formData.username || !formData.password) {
            setError("Both fields are required.");
            return;
        }

        showLoader("Updating credentials...");
        try {
            const res = await updateCredentials(formData);
            if (res.success) {
                setSuccessMsg("Credentials updated! Use your new password next time.");
                playSound('uploadSuccess');
                setShowModal(false);
                // Refresh profile to show new username
                const data = await getMyProfile();
                setProfile(data);
            } else {
                throw new Error(res.error || "Update failed");
            }
        } catch (err) {
            setError(err.message);
            playSound('error');
        } finally {
            hideLoader();
        }
    };

    if (loading) return <PencilLoader />;

    const getRoleColor = (role) => {
        switch (role?.toLowerCase()) {
            case 'principal': return 'bg-red-500';
            case 'vice principal': return 'bg-amber-500';
            case 'class teacher': return 'bg-blue-600';
            default: return 'bg-gray-400';
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-6 font-sans sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl space-y-8">
                <div className="flex flex-col gap-4 rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Faculty Account</p>
                        <h1 className="mt-2 text-3xl font-black text-gray-900">My Profile</h1>
                        <p className="mt-2 text-sm font-medium text-gray-500">Review your account details, teaching assignments, and login access.</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => setShowModal(true)}
                            className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white transition-all hover:bg-indigo-700"
                        >
                            Change Login
                        </button>
                        <button
                            onClick={() => router.push("/")}
                            className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-3 text-sm font-black text-gray-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="rounded-[2rem] bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 p-6 text-white">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200">Profile Card</p>
                                    <h2 className="mt-3 text-2xl font-black leading-tight">{profile?.name}</h2>
                                    <p className="mt-2 text-xs font-bold uppercase tracking-widest text-white/70">@{profile?.username || "username"}</p>
                                </div>
                                <span className={`${getRoleColor(profile?.role)} rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-lg`}>
                                    {profile?.role}
                                </span>
                            </div>

                            <div className="mt-6 rounded-[2rem] border border-white/10 bg-white/5 p-4">
                                {profile?.imageUrl ? (
                                    <img
                                        src={profile.imageUrl}
                                        alt={`${profile?.name} profile`}
                                        className="h-56 w-full rounded-[1.5rem] object-cover"
                                    />
                                ) : (
                                    <div className="flex h-56 w-full flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 bg-white/5 text-center">
                                        <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-white/10 text-3xl font-black text-white">
                                            {profile?.name?.charAt(0)}
                                        </div>
                                        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-100">Teacher Photo Space</p>
                                        <p className="mt-2 max-w-[220px] text-xs font-medium text-white/60">Reserved area for teacher image when photo upload is enabled.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="rounded-[1.75rem] border border-gray-100 bg-gray-50 p-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Main Subject</p>
                                <p className="mt-2 text-sm font-black text-gray-800">{profile?.main_subject || "Faculty"}</p>
                            </div>
                            <div className="rounded-[1.75rem] border border-gray-100 bg-gray-50 p-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Class Responsibility</p>
                                <p className="mt-2 text-sm font-black text-gray-800">{profile?.class_teacher_of?.toUpperCase() || "Not assigned"}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="rounded-[2rem] border border-blue-100 bg-blue-50 p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Role</p>
                                <p className="mt-3 text-lg font-black text-blue-900">{profile?.role}</p>
                            </div>
                            <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Timetable Subjects</p>
                                <p className="mt-3 text-lg font-black text-emerald-900">{profile?.subjects?.length || 0}</p>
                            </div>
                            <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Login Username</p>
                                <p className="mt-3 truncate text-lg font-black text-amber-900">{profile?.username || "-"}</p>
                            </div>
                        </div>

                        <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
                            <div>
                                <h3 className="text-lg font-black text-gray-900">Teaching Assignments</h3>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Subjects and classes from timetable</p>
                            </div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                {profile?.subjects?.map((s, idx) => (
                                    <div key={idx} className="rounded-[1.75rem] border border-gray-100 bg-gray-50 p-4 transition-all hover:border-blue-100 hover:bg-white hover:shadow-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="rounded-2xl bg-indigo-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-indigo-600">
                                                {s.class}
                                            </span>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-300">Assigned</span>
                                        </div>
                                        <p className="mt-4 text-sm font-black text-gray-800">{s.subject}</p>
                                    </div>
                                ))}
                                {(!profile?.subjects || profile.subjects.length === 0) && (
                                    <div className="rounded-[2rem] border border-dashed border-gray-200 bg-gray-50 p-10 text-center sm:col-span-2">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">No subjects assigned in timetable</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {successMsg && (
                    <div className="p-4 bg-green-100 text-green-700 rounded-2xl font-bold text-center text-sm anim-fade-in shadow-sm border border-green-200">
                        {successMsg}
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-red-100 text-red-700 rounded-2xl font-bold text-center text-sm anim-fade-in shadow-sm border border-red-200">
                        {error}
                    </div>
                )}

                <div className="space-y-4 pt-4">
                    <button
                        onClick={() => setShowModal(true)}
                        className="w-full py-5 rounded-[2rem] bg-indigo-600 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        <span>🔑</span> Change Login Account
                    </button>

                    <button
                        onClick={() => router.push("/")}
                        className="w-full py-5 rounded-[2rem] bg-gray-900 text-white font-black uppercase tracking-widest text-xs shadow-xl hover:bg-black transition-all active:scale-[0.98]"
                    >
                        Back to Dashboard
                    </button>
                </div>

            </div>

            {/* Change Credentials Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-sm rounded-[3rem] p-8 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
                        <h2 className="text-2xl font-black text-gray-900 mb-2">Update Account</h2>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-8">Set new username & password</p>

                        <form onSubmit={handleUpdate} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">New Username</label>
                                <input
                                    type="text"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 p-4 rounded-3xl font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                                    placeholder="Username"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">New Password</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 p-4 rounded-3xl font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                                    placeholder="Enter new password"
                                />
                                <p className="text-[9px] font-bold text-amber-500 px-1 italic">* Password is your new login key.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="py-4 rounded-3xl bg-gray-100 text-gray-500 font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="py-4 rounded-3xl bg-blue-600 text-white font-black uppercase tracking-widest text-xs shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
