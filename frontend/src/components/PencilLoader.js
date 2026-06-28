"use client";
import React from 'react';

export default function PencilLoader({ text = "Loading...", isFadingOut = false }) {
    return (
        <div className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center transition-opacity duration-300 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}>
            <div className="relative flex flex-col items-center">
                <div className="futuristic-loader">
                    <div className="hex-ring hex-ring-outer" />
                    <div className="hex-ring hex-ring-middle" />
                    <div className="hex-ring hex-ring-inner" />
                    <div className="hex-core" />
                    <div className="hex-dot hex-dot-1" />
                    <div className="hex-dot hex-dot-2" />
                    <div className="hex-dot hex-dot-3" />
                    <div className="hex-dot hex-dot-4" />
                    <div className="hex-dot hex-dot-5" />
                    <div className="hex-dot hex-dot-6" />
                </div>
                <div className="futuristic-scanline" />
                <div className="mt-8 text-white/90 text-[11px] font-black uppercase tracking-[0.35em]">
                    {text}
                </div>
                <div className="mt-2 flex gap-1 items-center justify-center">
                    <span className="futuristic-dot-anim" style={{ animationDelay: '0s' }} />
                    <span className="futuristic-dot-anim" style={{ animationDelay: '0.2s' }} />
                    <span className="futuristic-dot-anim" style={{ animationDelay: '0.4s' }} />
                </div>
            </div>
        </div>
    );
}
