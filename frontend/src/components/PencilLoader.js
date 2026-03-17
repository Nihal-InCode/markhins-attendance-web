"use client";
import React from 'react';

export default function PencilLoader({ text = "Loading...", isFadingOut = false }) {
    return (
        <div className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}>
            <div className="relative flex flex-col items-center">
                <svg className="pencil" viewBox="0 0 200 200" width="120" height="120" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <clipPath id="pencil-eraser">
                            <rect height="30" width="30" x="5" y="65"></rect>
                        </clipPath>
                    </defs>
                    <circle className="pencil__stroke" r="70" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="439.82 439.82" strokeDashoffset="439.82" strokeLinecap="round" transform="rotate(-113,100,100)"></circle>
                    <g className="pencil__rotate" transform="translate(100,100)">
                        <g fill="none">
                            <circle className="pencil__body1" r="64" stroke="#2563eb" strokeWidth="30" strokeDasharray="402.12 402.12" strokeDashoffset="402.12" transform="rotate(-90)"></circle>
                            <circle className="pencil__body2" r="56" stroke="#3b82f6" strokeWidth="10" strokeDasharray="351.86 351.86" strokeDashoffset="351.86" transform="rotate(-90)"></circle>
                            <circle className="pencil__body3" r="46" stroke="#60a5fa" strokeWidth="10" strokeDasharray="289.03 289.03" strokeDashoffset="289.03" transform="rotate(-90)"></circle>
                        </g>
                        <g className="pencil__eraser" transform="rotate(-45) translate(49,0)">
                            <g className="pencil__eraser-skew">
                                <rect fill="#f87171" height="30" width="30" rx="5" ry="5" x="-15" y="-15"></rect>
                                <rect fill="#ef4444" height="30" width="5" x="5" y="-15"></rect>
                                <rect fill="rgba(0,0,0,0.1)" height="30" width="30" rx="5" ry="5" x="-15" y="-15"></rect>
                                <rect fill="rgba(255,255,255,0.2)" height="30" width="30" clipPath="url(#pencil-eraser)" rx="5" ry="5" x="-15" y="-15"></rect>
                                <rect fill="#9ca3af" height="20" width="8" x="-15" y="-10"></rect>
                                <rect fill="#6b7280" height="20" width="1" x="-12.5" y="-10"></rect>
                                <rect fill="#6b7280" height="20" width="1" x="-10" y="-10"></rect>
                            </g>
                        </g>
                        <g className="pencil__point" transform="rotate(-90) translate(49,0)">
                            <polygon fill="#fbbf24" points="15 0,30 -30,0 -30"></polygon>
                            <polygon fill="#1f2937" points="15 0,20 -10,10 -10"></polygon>
                        </g>
                    </g>
                </svg>
                <div className="mt-4 text-white text-sm font-black uppercase tracking-[0.2em] animate-pulse">
                    {text}
                </div>
            </div>
        </div>
    );
}
