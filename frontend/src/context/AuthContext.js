"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { validateToken as validateTokenApi } from "@/lib/api";

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    /**
     * Logical check for authenticated status and valid token
     */
    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem("token");

        if (!token) {
            setUser(null);
            setLoading(false);
            if (pathname !== "/login") {
                router.push("/login");
            }
            return;
        }

        try {
            // Validate the stored token with the backend
            const response = await validateTokenApi();
            if (response.success) {
                setUser(response.user || { name: 'Teacher' });
            } else {
                localStorage.removeItem("token");
                setUser(null);
                if (pathname !== "/login") router.push("/login");
            }
        } catch (err) {
            console.error("[Auth Check Error]", err);
            // If it's a network error, we might want to keep the session for offline use
            // but if it's a 401 (handled in apiRequest), the token is already removed.
            if (!localStorage.getItem("token") && pathname !== "/login") {
                router.push("/login");
            }
        } finally {
            setLoading(false);
        }
    }, [pathname, router]);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    /**
     * Enhanced login to handle token storage and state update
     */
    const login = (token, userData) => {
        localStorage.setItem("token", token);
        setUser(userData || { name: 'Teacher' });
        // Show branded intro before going home
        sessionStorage.setItem("showIntro", "1");
        router.push("/login-transition");
    };

    /**
     * Logout clears storage and redirects
     */
    const logout = () => {
        localStorage.removeItem("token");
        setUser(null);
        router.push("/login");
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading, checkAuth }}>
            {/* Show nothing while loading the initial auth state to prevent flickering */}
            {loading ? (
                <div className="flex items-center justify-center min-h-screen">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                children
            )}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
