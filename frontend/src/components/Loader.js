"use client";
import React, { useEffect } from 'react';

export default function Loader({
    text = "Loading...",
    showProgress = false,
    progress = 0,
    playSuccessSound = false,
    vibrate = false,
    isFadingOut = false
}) {

    useEffect(() => {
        // When loader unmounts (or just before), check success actions
        return () => {
            if (playSuccessSound) {
                try {
                    const audio = new Audio("/success.mp3");
                    audio.play().catch(e => console.warn("Sound play blocked or file missing:", e));
                } catch (err) {
                    console.warn("Audio Context Error:", err);
                }
            }
            if (vibrate && "vibrate" in navigator) {
                navigator.vibrate(100);
            }
        };
    }, [playSuccessSound, vibrate]);

    return (
        <div className={`loader-container ${isFadingOut ? 'fade-out' : ''}`}>
            <div className="loader-content">
                {/* Institutional Loader Animation SVG/HTML Structure */}
                <div className="loader">
                    <div className="ciw"></div>
                    <div className="ci1"></div>
                    <div className="ci2"></div>
                    <div className="points"></div>
                </div>

                {text && <div className="loader-text">{text}</div>}

                {showProgress && (
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                )}
            </div>
        </div>
    );
}
