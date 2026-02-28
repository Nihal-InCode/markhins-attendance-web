"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getTeachersList } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";

export default function TeachersPage() {
    const [teachers, setTeachers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const { user } = useAuth();
    const router = useRouter();
    const { showLoader, hideLoader } = useLoading();

    useEffect(() => {
        async function fetchTeachers() {
            showLoader("Loading faculty list...");
            try {
                const data = await getTeachersList();
                setTeachers(data);
            } catch (err) {
                setError("Failed to load teachers list.");
            } finally {
                setLoading(false);
                hideLoader();
            }
        }
        fetchTeachers();
    }, []);

    const filteredTeachers = teachers.filter(t =>
        t.name?.toLowerCase().includes(search.toLowerCase()) ||
        t.role?.toLowerCase().includes(search.toLowerCase()) ||
        t.class_teacher_of?.toLowerCase().includes(search.toLowerCase()) ||
        t.subject?.toLowerCase().includes(search.toLowerCase())
    );

    const getRoleColor = (role) => {
        switch (role?.toLowerCase()) {
            case 'principal': return 'bg-red-500 shadow-red-100';
            case 'class teacher': return 'bg-blue-600 shadow-blue-100';
            default: return 'bg-gray-400 shadow-gray-100';
        }
    };

    if (loading) return null;

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
                    <h1 className="text-xl font-black text-gray-800 tracking-tight uppercase">Teachers List</h1>
                    <div className="w-10"></div>
                </div>

                {/* Search Bar */}
                <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4 focus-within:ring-4 focus-within:ring-blue-100 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search name, role, class..."
                        className="bg-transparent border-none outline-none w-full font-bold text-gray-700 placeholder:text-gray-300"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {/* Teachers List */}
                <div className="grid grid-cols-1 gap-4">
                    {filteredTeachers.map((t) => (
                        <div key={t.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/30 rounded-full -mr-12 -mt-12 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>

                            <div className="flex justify-between items-start">
                                <div className="flex gap-4 items-center">
                                    <div className="w-14 h-14 rounded-[1.25rem] bg-gradient-to-tr from-gray-100 to-gray-200 flex items-center justify-center text-xl text-gray-400 font-black">
                                        {t.name?.charAt(0)}
                                    </div>
                                    <div>
                                        <h2 className="text-base font-black text-gray-800 leading-tight">{t.name}</h2>
                                        <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-widest">@{t.username || 'username'}</p>
                                    </div>
                                </div>
                                <span className={`${getRoleColor(t.role)} text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-blue-50`}>
                                    {t.role}
                                </span>
                            </div>

                            <div className="mt-6 flex flex-wrap gap-2">
                                {t.role === 'Class Teacher' && (
                                    <span className="bg-blue-50 text-blue-600 text-[9px] font-black px-3 py-1.5 rounded-xl border border-blue-100 uppercase tracking-tight">
                                        🏫 Class Teacher of {t.class_teacher_of}
                                    </span>
                                )}
                                <span className="bg-gray-50 text-gray-500 text-[9px] font-black px-3 py-1.5 rounded-xl border border-gray-100 uppercase tracking-tight">
                                    📘 {t.subject || 'Faculty'}
                                </span>
                            </div>
                        </div>
                    ))}

                    {filteredTeachers.length === 0 && (
                        <div className="bg-gray-50 rounded-[2.5rem] p-12 text-center border border-dashed border-gray-200">
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">No teachers matching your search</p>
                        </div>
                    )}
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
