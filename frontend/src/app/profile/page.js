"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getMyProfile } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import PencilLoader from "@/components/PencilLoader";

export default function ProfilePage() {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    useEffect(() => {
        async function fetchProfile() {
            showLoader("Loading profile...");
            try {
                const data = await getMyProfile();
                setProfile(data);
            } catch (err) {
                setError("Failed to load profile data.");
            } finally {
                setLoading(false);
                hideLoader();
            }
        }
        fetchProfile();
    }, []);

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
        <div className="min-h-screen bg-gray-50/50 flex flex-col items-center py-10 px-6 font-sans">
            <div className="max-w-md w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Header */}
                <div className="flex justify-between items-center">
                    <button
                        onClick={() => router.back()}
                        className="w-10 h-10 rounded-2xl bg-white border border-gray-100 flex items-center justify-center shadow-sm hover:bg-gray-50 transition-all active:scale-90"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-black text-gray-800 tracking-tight uppercase">My Profile</h1>
                    <div className="w-10"></div>
                </div>

                {/* Profile Card */}
                <div className="relative pt-12">
                    <div className="bg-white rounded-[3rem] p-8 shadow-2xl shadow-blue-100 border border-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-blue-50 rounded-full -mr-16 -mt-16 blur-3xl opacity-50"></div>

                        {/* Avatar Placeholder */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-24 h-24 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-[2rem] border-4 border-white shadow-xl flex items-center justify-center text-3xl text-white font-black">
                            {profile?.name?.charAt(0)}
                        </div>

                        <div className="text-center mt-6">
                            <h2 className="text-2xl font-black text-gray-900 leading-tight">{profile?.name}</h2>
                            <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">@{profile?.username || 'username'}</p>

                            <div className="flex justify-center mt-4">
                                <span className={`${getRoleColor(profile?.role)} text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-blue-100`}>
                                    {profile?.role}
                                </span>
                            </div>
                        </div>

                        <div className="mt-10 space-y-6">
                            <div className="flex gap-4 items-center p-4 rounded-3xl bg-gray-50/50 border border-gray-100">
                                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-xl">🏫</div>
                                <div>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Designation</p>
                                    <p className="text-sm font-bold text-gray-800">{profile?.main_subject || 'Faculty'}</p>
                                </div>
                            </div>

                            {(profile?.role === 'Class Teacher' || profile?.role === 'Vice Principal') && profile?.class_teacher_of && (
                                <div className="flex gap-4 items-center p-4 rounded-3xl bg-green-50/30 border border-green-50">
                                    <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-xl">👥</div>
                                    <div>
                                        <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Class Teacher of</p>
                                        <p className="text-sm font-black text-green-700">{profile?.class_teacher_of?.toUpperCase()}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Subjects Handled Section */}
                <div className="space-y-4">
                    <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest px-1">Subjects & Classes</h3>
                    <div className="grid grid-cols-1 gap-3">
                        {profile?.subjects?.map((s, idx) => (
                            <div key={idx} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex justify-between items-center transition-all hover:scale-[1.02] hover:shadow-md">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black">
                                        {s.class}
                                    </div>
                                    <p className="font-bold text-gray-800">{s.subject}</p>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                </div>
                            </div>
                        ))}
                        {(!profile?.subjects || profile.subjects.length === 0) && (
                            <div className="bg-gray-50 rounded-3xl p-8 text-center border border-dashed border-gray-200">
                                <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">No subjects assigned in timetable</p>
                            </div>
                        )}
                    </div>
                </div>

                <button
                    onClick={() => router.push("/")}
                    className="w-full py-5 rounded-3xl bg-gray-900 text-white font-black uppercase tracking-widest text-sm shadow-xl hover:bg-black transition-all active:scale-[0.98]"
                >
                    Back to Dashboard
                </button>

            </div>
        </div>
    );
}
