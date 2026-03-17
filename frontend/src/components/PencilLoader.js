"use client";
import React from 'react';

export default function PencilLoader({ text = "Loading...", isFadingOut = false }) {
    return (
        <div className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}>
            <div className="relative flex flex-col items-center">
                <svg className="pencil" viewBox="0 0 200 200" width="120" height="120" xmlns="http://www.w3.org/2000/svg">
                    {/* The stroke path being "drawn" */}
                    <circle
                        className="pencil__stroke"
                        cx="100" cy="100" r="70"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="439.82"
                        strokeDashoffset="439.82"
                        strokeLinecap="round"
                    />

                    {/* The Unified Pencil - One Piece */}
                    <g className="pencil__rotate" transform="translate(100, 100)">
                        <g className="pencil__body-wrapper" transform="rotate(-90) translate(70, 0)">
                            {/* Pencil Body - Unified stick design */}
                            <g transform="rotate(90)">
                                {/* Eraser */}
                                <rect x="-6" y="-40" width="12" height="10" rx="2" fill="#ff8a8a" />
                                {/* Ferrule (Metal part) */}
                                <rect x="-6" y="-32" width="12" height="4" fill="#cbd5e1" />
                                {/* Main Yellow Body */}
                                <rect x="-6" y="-28" width="12" height="35" fill="#fbbf24" />
                                {/* Body Stripes for depth */}
                                <rect x="-2" y="-28" width="4" height="35" fill="#f59e0b" />
                                {/* Wood Tip Cone */}
                                <polygon points="-6,7 6,7 0,18" fill="#fde68a" />
                                {/* Graphite Tip */}
                                <polygon points="-2,12 2,12 0,18" fill="#1e293b" />
                            </g>
                        </g>
                    </g>
                </svg>
                <div className="mt-6 text-white text-sm font-black uppercase tracking-[0.3em] animate-pulse">
                    {text}
                </div>
            </div>
        </div>
    );
}
