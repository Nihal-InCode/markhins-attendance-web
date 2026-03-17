"use client";
import { useState, useEffect } from 'react';
import { toggleMute, getMuteState } from '@/lib/sound';

export default function VolumeToggle() {
    const [muted, setMuted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Initial sync
        setMuted(getMuteState());
        setIsVisible(true);
    }, []);

    const handleToggle = () => {
        const newState = toggleMute();
        setMuted(newState);
    };

    if (!isVisible) return null;

    return (
        <button
            onClick={handleToggle}
            className={`fixed bottom-6 right-6 z-[9999] p-4 rounded-full shadow-2xl transition-all duration-300 transform active:scale-125 hover:scale-110 flex items-center justify-center ${muted
                    ? 'bg-red-500 text-white'
                    : 'bg-green-500 text-white'
                }`}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
        >
            <div className="relative w-6 h-6">
                {muted ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 animate-in zoom-in duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 animate-in zoom-in duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                )}
            </div>
        </button>
    );
}
