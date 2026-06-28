"use client";
import React from 'react';

export default function PencilLoader({ text = "Loading...", isFadingOut = false }) {
    return (
        <div className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center transition-opacity duration-300 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}>
            <svg className="absolute w-0 h-0">
                <defs>
                    <filter id="goo">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
                        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
                        <feBlend in="SourceGraphic" in2="goo" />
                    </filter>
                </defs>
            </svg>
            <div className="relative flex flex-col items-center">
                <div className="loader-container">
                    <div className="dot dot-3" />
                    <div className="dot dot-2" />
                    <div className="dot dot-1" />
                </div>
                <div className="mt-16 text-white/90 text-[11px] font-black uppercase tracking-[0.35em]">
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
