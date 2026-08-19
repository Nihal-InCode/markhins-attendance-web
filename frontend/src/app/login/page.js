"use client";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { login as loginApi, getWebAuthnLoginOptions, verifyWebAuthnLogin } from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import { playSound } from '@/lib/sound';
import { isWebAuthnSupported, startAuthentication } from '@/lib/webauthn';

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
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

    const handlePasskeyLogin = async () => {
        setError("");
        if (!username.trim()) {
            setError("Enter your username first, then tap Login with Passkey.");
            return;
        }
        if (!isWebAuthnSupported()) {
            setError("Your browser does not support passkeys. Please use username and password.");
            return;
        }

        setPasskeyLoading(true);
        showLoader("Waiting for biometric...");

        try {
            const optionsResult = await getWebAuthnLoginOptions(username);
            if (!optionsResult.success || !optionsResult.options) {
                throw new Error(optionsResult.error || "No passkeys found for this username");
            }

            if (optionsResult.options.allowCredentials && optionsResult.options.allowCredentials.length === 0) {
                throw new Error("No passkeys registered for this account. Please login with password and register a passkey from your profile.");
            }

            const credential = await startAuthentication(optionsResult.options);

            const verifyResult = await verifyWebAuthnLogin(credential, optionsResult.loginSessionId);

            if (verifyResult.token) {
                playSound('loginSuccess');
                login(verifyResult.token, verifyResult.user);
            } else {
                playSound('loginError');
                setError(verifyResult.error || verifyResult.message || "Passkey authentication failed");
            }
        } catch (err) {
            playSound('loginError');
            if (err.name === 'NotAllowedError') {
                setError("Authentication was cancelled or timed out.");
            } else if (err.name === 'SecurityError') {
                setError("Security error. Ensure you are using HTTPS in production.");
            } else {
                setError(err.message || "Passkey login failed. Try username and password instead.");
            }
        } finally {
            setPasskeyLoading(false);
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
                        {loading ? "Verifying..." : "Sign In"}
                    </button>

                    <div className="relative my-2">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-100"></div>
                        </div>
                        <div className="relative flex justify-center text-[10px]">
                            <span className="bg-white px-3 font-black text-gray-300 uppercase tracking-widest">or</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={passkeyLoading || loading}
                        onClick={handlePasskeyLogin}
                        className="w-full flex justify-center items-center gap-2 py-4 px-4 border border-gray-200 rounded-2xl text-sm font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 disabled:opacity-50 transition-all active:scale-95"
                    >
                        {passkeyLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600"></div>
                                Verifying...
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 10v4M7.5 21a7.5 7.5 0 0 1 0-15c2.5 0 4.5 1.5 5.5 3.5M15 10.5c0 0 1.5 1 2.5 1a3.5 3.5 0 0 0 0-7c-1 0-2.5.5-3.5 2" />
                                    <rect x="5" y="2" width="14" height="20" rx="7" />
                                    <circle cx="12" cy="15" r="3" fill="currentColor" opacity="0.3" />
                                </svg>
                                Login with Passkey
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
