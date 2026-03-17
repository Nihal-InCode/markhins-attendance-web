"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import PencilLoader from '@/components/PencilLoader';

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
        const MIN_TIME = 500; // Requirement: Minimum Display Time
        const FADE_OUT_DELAY = 300; // Delay for fade-out animation
        const elapsed = Date.now() - (startTime || Date.now());
        const remaining = Math.max(0, MIN_TIME - elapsed);

        setTimeout(() => {
            setFading(true); // Start fading out
            setTimeout(() => {
                setLoading(false);
                setFading(false); // Reset fading state after animation
            }, FADE_OUT_DELAY); // Wait for fade-out animation to complete
        }, remaining);
    }, [startTime]);

    return (
        <LoadingContext.Provider value={{ showLoader, hideLoader }}>
            {children}
            {loading && (
                <PencilLoader
                    text={loadingText}
                    isFadingOut={fading}
                />
            )}
        </LoadingContext.Provider>
    );
}

export const useLoading = () => useContext(LoadingContext);
