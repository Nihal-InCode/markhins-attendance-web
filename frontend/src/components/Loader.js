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

    const triggeredSuccess = React.useRef(false);

    useEffect(() => {
        // Trigger success effects when we start fading out (minimum time has passed & action finished)
        if (isFadingOut && !triggeredSuccess.current) {
            triggeredSuccess.current = true;

            if (playSuccessSound) {
                try {
                    const audio = new Audio("/success.mp3");
                    audio.play().catch(e => console.warn("Success sound blocked:", e));
                } catch (err) { }
            }
            if (vibrate && "vibrate" in navigator) {
                navigator.vibrate(100);
            }
        }
    }, [isFadingOut, playSuccessSound, vibrate]);

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
