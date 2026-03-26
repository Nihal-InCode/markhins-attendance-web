"use client";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { login as loginApi } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const { showLoader, hideLoader } = useLoading();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        showLoader("Verifying credentials...");

        try {
            const response = await loginApi(username, password);
            if (response.token) {
                playSound('loginSuccess');
                login(response.token, response.user);
            } else {
                playSound('loginError');
                setError(response.error || response.message || "Invalid response from server");
            }
        } catch (err) {
            playSound('loginError');
            setError(err.message || "Login failed. Please check your credentials.");
        } finally {
            setLoading(false);
            hideLoader();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center px-6 py-12 min-h-screen bg-gray-50/50 font-sans">
            <div className="w-full max-w-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center">
                    <img
                        src="/logo.png"
                        alt="MARKHINS HUB Logo"
                        className="h-18 w-18 object-contain mx-auto mb-4 drop-shadow-md"
                        style={{ height: '72px', width: '72px' }}
                    />
                    <h1 className="text-3xl font-black text-blue-600 tracking-tight">MARKHINS HUB</h1>
                    <p className="mt-2 text-xs font-black text-gray-400 uppercase tracking-widest">Administrative Console</p>
                </div>

                <form className="mt-8 space-y-6 bg-white p-8 rounded-[2.5rem] shadow-2xl shadow-blue-100/20 border border-gray-100" onSubmit={handleSubmit}>
                    {error && (
                        <div className="p-4 text-xs font-bold text-red-600 bg-red-50 rounded-2xl border border-red-100 animate-shake">
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="space-y-5">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">Username</label>
                            <input
                                type="text"
                                required
                                className="w-full px-6 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-bold text-gray-700 placeholder:text-gray-200"
                                placeholder="Your username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2 px-1">
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Password</label>
                            </div>
                            <input
                                type="password"
                                required
                                className="w-full px-6 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-bold text-gray-700 placeholder:text-gray-200"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center py-5 px-4 border border-transparent rounded-2xl shadow-xl shadow-blue-100 text-sm font-black uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-50 transition-all active:scale-95"
                    >
                        {loading ? "Verifying..." : "Login to Console"}
                    </button>
                </form>
            </div>
        </div>
    );
}
