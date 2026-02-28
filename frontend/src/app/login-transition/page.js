"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginTransitionPage() {
    const router = useRouter();
    const videoRef = useRef(null);
    const [phase, setPhase] = useState("enter"); // enter → show → exit
    const [hasVideo, setHasVideo] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);

    const TOTAL_DURATION = 3800; // ms fallback for CSS animation

    const goHome = () => {
        setPhase("exit");
        setTimeout(() => {
            sessionStorage.removeItem("showIntro");
            router.replace("/");
        }, 600);
    };

    useEffect(() => {
        // Guard: only show if coming from a fresh login
        const flag = sessionStorage.getItem("showIntro");
        if (!flag) {
            router.replace("/");
            return;
        }

        // Prevent back button during playback
        window.history.pushState(null, "", window.location.href);
        const onPopState = () => {
            window.history.pushState(null, "", window.location.href);
        };
        window.addEventListener("popstate", onPopState);

        // Play success sound
        const audio = new Audio("/success.mp3");
        audio.play().catch(e => console.warn("Login sound play blocked or file missing:", e));

        // Animate in
        const enterTimer = setTimeout(() => setPhase("show"), 50);

        // Fallback: auto-redirect after TOTAL_DURATION
        const fallback = setTimeout(goHome, TOTAL_DURATION);

        return () => {
            clearTimeout(enterTimer);
            clearTimeout(fallback);
            window.removeEventListener("popstate", onPopState);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleVideoLoaded = () => setHasVideo(true);
    const handleVideoError = () => {
        setVideoFailed(true);
        // fallback timer already running
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "#000",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                opacity: phase === "enter" ? 0 : phase === "exit" ? 0 : 1,
                transition: "opacity 0.6s cubic-bezier(0.4,0,0.2,1)",
            }}
        >
            {/* ── MP4 Video (plays if login-intro.mp4 exists in /public) ── */}
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onLoadedData={handleVideoLoaded}
                onError={handleVideoError}
                onEnded={goHome}
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: videoFailed ? "none" : "block",
                    opacity: hasVideo ? 1 : 0,
                    transition: "opacity 0.4s ease",
                }}
            >
                <source src="/login-intro.mp4" type="video/mp4" />
            </video>

            {/* ── CSS Branded Animation (always visible until video loads) ── */}
            {(!hasVideo || videoFailed) && (
                <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {/* Animated background gradient orbs */}
                    <div style={orbStyle("#1e40af", "60vmax", "10%", "20%", "8s")} />
                    <div style={orbStyle("#7c3aed", "50vmax", "70%", "60%", "11s")} />
                    <div style={orbStyle("#0ea5e9", "40vmax", "40%", "80%", "9s")} />

                    {/* Grid lines overlay */}
                    <div style={{
                        position: "absolute", inset: 0,
                        backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                        backgroundSize: "60px 60px",
                    }} />

                    {/* Center content */}
                    <div style={{ position: "relative", textAlign: "center", animation: "introFadeUp 0.8s 0.3s both ease-out" }}>
                        {/* Logo ring */}
                        <div style={{
                            width: 120, height: 120,
                            borderRadius: "50%",
                            border: "2px solid rgba(255,255,255,0.15)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            margin: "0 auto 28px",
                            position: "relative",
                            animation: "introSpin 3s linear infinite",
                        }}>
                            <div style={{
                                position: "absolute", inset: -2,
                                borderRadius: "50%",
                                background: "conic-gradient(from 0deg, transparent 70%, #3b82f6 100%)",
                                animation: "introSpin 2s linear infinite",
                            }} />
                            <div style={{
                                width: 100, height: 100,
                                borderRadius: "50%",
                                background: "rgba(0,0,0,0.6)",
                                backdropFilter: "blur(12px)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                position: "relative", zIndex: 1,
                            }}>
                                <img
                                    src="/logo.png"
                                    alt="Logo"
                                    style={{ width: 60, height: 60, objectFit: "contain" }}
                                    onError={(e) => { e.target.style.display = "none"; }}
                                />
                            </div>
                        </div>

                        {/* Brand name with letter reveal */}
                        <h1 style={{
                            fontSize: "2.25rem",
                            fontWeight: 900,
                            letterSpacing: "0.15em",
                            color: "#fff",
                            fontFamily: "'Inter', sans-serif",
                            margin: 0,
                            animation: "introReveal 0.6s 0.5s both ease-out",
                            textShadow: "0 0 40px rgba(59,130,246,0.6)",
                        }}>
                            MARKHINS HUB
                        </h1>
                        <p style={{
                            marginTop: 10,
                            fontSize: "0.65rem",
                            fontWeight: 800,
                            letterSpacing: "0.35em",
                            color: "rgba(255,255,255,0.45)",
                            fontFamily: "'Inter', sans-serif",
                            animation: "introReveal 0.6s 0.8s both ease-out",
                        }}>
                            ADMINISTRATIVE CONSOLE
                        </p>

                        {/* Animated divider */}
                        <div style={{
                            marginTop: 28,
                            height: 2,
                            background: "linear-gradient(90deg, transparent, #3b82f6, transparent)",
                            borderRadius: 2,
                            animation: "introLine 1.2s 0.9s both ease-out",
                            transformOrigin: "center",
                        }} />

                        {/* Tagline */}
                        <p style={{
                            marginTop: 20,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            color: "rgba(255,255,255,0.3)",
                            letterSpacing: "0.15em",
                            fontFamily: "'Inter', sans-serif",
                            animation: "introReveal 0.7s 1.2s both ease-out",
                        }}>
                            ATTENDANCE · HEALTH · ANALYTICS
                        </p>

                        {/* Pulsing dot indicator */}
                        <div style={{ marginTop: 40, display: "flex", gap: 8, justifyContent: "center" }}>
                            {[0, 1, 2].map(i => (
                                <div key={i} style={{
                                    width: 6, height: 6,
                                    borderRadius: "50%",
                                    background: i === 0 ? "#3b82f6" : "rgba(255,255,255,0.2)",
                                    animation: `introPulse 1.5s ${i * 0.2}s infinite ease-in-out`,
                                }} />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Keyframe styles injected inline */}
            <style>{`
                @keyframes introFadeUp {
                    from { opacity: 0; transform: translateY(30px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes introReveal {
                    from { opacity: 0; transform: translateY(12px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes introLine {
                    from { transform: scaleX(0); opacity: 0; }
                    to   { transform: scaleX(1); opacity: 1; }
                }
                @keyframes introSpin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
                @keyframes introPulse {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50%       { opacity: 1;   transform: scale(1.2); background: #3b82f6; }
                }
                @keyframes introOrb {
                    0%, 100% { transform: translate(0, 0) scale(1); }
                    33%       { transform: translate(5%, -5%) scale(1.05); }
                    66%       { transform: translate(-4%, 4%) scale(0.95); }
                }
            `}</style>
        </div>
    );
}

// Helper: animated background orbs
function orbStyle(color, size, left, top, duration) {
    return {
        position: "absolute",
        width: size, height: size,
        borderRadius: "50%",
        background: color,
        left, top,
        transform: "translate(-50%, -50%)",
        filter: "blur(80px)",
        opacity: 0.25,
        animation: `introOrb ${duration} ease-in-out infinite`,
        willChange: "transform",
    };
}
