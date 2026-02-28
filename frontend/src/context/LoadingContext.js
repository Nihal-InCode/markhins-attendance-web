"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import Loader from '@/components/Loader';

const LoadingContext = createContext();

export function LoadingProvider({ children }) {
    const [loading, setLoading] = useState(false);
    const [fading, setFading] = useState(false); // New state for fading
    const [loadingText, setLoadingText] = useState("Loading...");
    const [options, setOptions] = useState({});
    const [startTime, setStartTime] = useState(null);

    const showLoader = useCallback((text = "Loading...", opts = {}) => {
        setFading(false); // Ensure fading is false when showing
        setLoadingText(text);
        setOptions(opts);
        setLoading(true);
        setStartTime(Date.now());
    }, []);

    const hideLoader = useCallback(() => {
        const MIN_TIME = 400; // Step 5: Minimum Display Time
        const FADE_OUT_DELAY = 300; // New: Delay for fade-out animation
        const elapsed = Date.now() - (startTime || Date.now());
        const remaining = Math.max(0, MIN_TIME - elapsed);

        setTimeout(() => {
            setFading(true); // Start fading out
            setTimeout(() => {
                setLoading(false);
                setFading(false); // Reset fading state after animation
                // Success sound/vibration logic if requested (handled in component or here)
                if (options.playSuccessSound || options.vibrate) {
                    // We'll pass a 'success' prop to Loader for a brief moment or trigger here
                }
            }, FADE_OUT_DELAY); // Wait for fade-out animation to complete
        }, remaining);
    }, [startTime, options]);

    return (
        <LoadingContext.Provider value={{ showLoader, hideLoader }}>
            {children}
            {loading && (
                <Loader
                    text={loadingText}
                    showProgress={options.showProgress}
                    progress={options.progress}
                    playSuccessSound={options.playSuccessSound}
                    vibrate={options.vibrate}
                    isFadingOut={fading}
                />
            )}
        </LoadingContext.Provider>
    );
}

export const useLoading = () => useContext(LoadingContext);
