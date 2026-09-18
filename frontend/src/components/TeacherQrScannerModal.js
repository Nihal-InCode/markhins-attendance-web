"use client";
import { useState, useEffect, useRef } from "react";
import { scanTeacherAttendance } from "@/lib/api";
import { playSound } from "@/lib/sound";

export default function TeacherQrScannerModal({ isOpen, onClose, onSuccess }) {
    const [status, setStatus] = useState("IDLE"); // IDLE, SCANNING, PROCESSING, SUCCESS, ALREADY_MARKED, INVALID_QR, CAMERA_ERROR, NETWORK_ERROR
    const [message, setMessage] = useState("");
    const [record, setRecord] = useState(null);
    const scannerRef = useRef(null);
    const isScanningRef = useRef(false);

    useEffect(() => {
        if (!isOpen) {
            cleanupScanner();
            setStatus("IDLE");
            setMessage("");
            setRecord(null);
            return;
        }

        let isMounted = true;
        setStatus("SCANNING");
        setMessage("");

        const startScanner = async () => {
            try {
                // Ensure target div exists
                const readerElement = document.getElementById("teacher-qr-reader");
                if (!readerElement) return;

                // Dynamically import html5-qrcode
                const { Html5Qrcode } = await import("html5-qrcode");

                const html5Qrcode = new Html5Qrcode("teacher-qr-reader");
                scannerRef.current = html5Qrcode;
                isScanningRef.current = true;

                // Enumerate cameras to avoid 0.5x ultra-wide lens
                let cameraConfig = { facingMode: "environment" };
                try {
                    const cameras = await Html5Qrcode.getCameras();
                    if (cameras && cameras.length > 0) {
                        const backCameras = cameras.filter(c => {
                            const lbl = (c.label || "").toLowerCase();
                            return lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment");
                        });
                        const primaryMainCam = backCameras.find(c => {
                            const lbl = (c.label || "").toLowerCase();
                            return !lbl.includes("wide") && !lbl.includes("0.5") && !lbl.includes("macro") && !lbl.includes("aux") && !lbl.includes("secondary");
                        }) || backCameras[0] || cameras[0];

                        if (primaryMainCam && primaryMainCam.id) {
                            cameraConfig = { deviceId: { exact: primaryMainCam.id } };
                        }
                    }
                } catch (camListErr) {
                    console.warn("Could not enumerate cameras, falling back to facingMode environment:", camListErr);
                }

                const config = {
                    fps: 15,
                    qrbox: { width: 220, height: 220 },
                    aspectRatio: 1.0,
                };

                const onScanSuccess = async (decodedText) => {
                    if (!isScanningRef.current) return;
                    isScanningRef.current = false;
                    
                    try {
                        await html5Qrcode.stop();
                    } catch (e) {
                        console.warn("Scanner stop warning:", e);
                    }

                    if (!isMounted) return;
                    setStatus("PROCESSING");

                    try {
                        const response = await scanTeacherAttendance(decodedText);
                        if (response.success) {
                            setRecord(response.record || null);
                            if (response.status === "ALREADY_MARKED") {
                                setStatus("ALREADY_MARKED");
                                setMessage(response.message || "Attendance already marked.");
                                playSound('rescan');
                            } else {
                                setStatus("SUCCESS");
                                setMessage(response.message || "Attendance marked successfully!");
                                playSound('qrDone');
                            }
                            if (onSuccess) onSuccess(response.record);
                        } else {
                            setStatus("INVALID_QR");
                            setMessage(response.message || "Invalid QR code.");
                            playSound('error');
                        }
                    } catch (err) {
                        console.error("Scan submit error:", err);
                        playSound('error');
                        if (err.message && err.message.toLowerCase().includes("network")) {
                            setStatus("NETWORK_ERROR");
                            setMessage("We couldn't reach the server. Please check your internet connection and try again.");
                        } else {
                            setStatus("INVALID_QR");
                            setMessage(err.message || "QR Code Not Recognized.");
                        }
                    }
                };

                const applyHardwareZoom = async () => {
                    try {
                        const videoEl = document.querySelector("#teacher-qr-reader video");
                        if (videoEl && videoEl.srcObject) {
                            const track = videoEl.srcObject.getVideoTracks()[0];
                            if (track && typeof track.getCapabilities === "function") {
                                const caps = track.getCapabilities();
                                if (caps.zoom) {
                                    const targetZoom = Math.min(caps.zoom.max || 3.0, Math.max(caps.zoom.min || 1.0, 2.0));
                                    await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("Hardware zoom error:", e);
                    }
                };

                try {
                    await html5Qrcode.start(cameraConfig, config, onScanSuccess, () => {});
                    setTimeout(applyHardwareZoom, 300);
                } catch (startErr) {
                    if (cameraConfig.deviceId) {
                        await html5Qrcode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
                        setTimeout(applyHardwareZoom, 300);
                    } else {
                        throw startErr;
                    }
                }

            } catch (err) {
                console.error("Camera access error:", err);
                if (isMounted) {
                    setStatus("CAMERA_ERROR");
                    setMessage("We couldn't access your camera. Please allow camera access in your browser settings to continue.");
                }
            }
        };

        const timer = setTimeout(startScanner, 200);

        return () => {
            isMounted = false;
            clearTimeout(timer);
            cleanupScanner();
        };
    }, [isOpen]);

    const cleanupScanner = async () => {
        isScanningRef.current = false;
        if (scannerRef.current) {
            const instance = scannerRef.current;
            scannerRef.current = null;
            try {
                if (typeof instance.stop === "function") {
                    await instance.stop();
                }
            } catch (e) {
                console.warn("Scanner stop warning:", e);
            }
            try {
                if (typeof instance.clear === "function") {
                    await instance.clear();
                }
            } catch (e) {
                console.warn("Scanner clear warning:", e);
            }
        }
    };

    const handleClose = async () => {
        await cleanupScanner();
        setStatus("IDLE");
        setMessage("");
        setRecord(null);
        if (onClose) onClose();
    };

    const handleRetry = () => {
        cleanupScanner();
        setStatus("SCANNING");
        setMessage("");
        setRecord(null);

        setTimeout(async () => {
            try {
                const { Html5Qrcode } = await import("html5-qrcode");
                const html5Qrcode = new Html5Qrcode("teacher-qr-reader");
                scannerRef.current = html5Qrcode;
                isScanningRef.current = true;

                let cameraConfig = { facingMode: "environment" };
                try {
                    const cameras = await Html5Qrcode.getCameras();
                    if (cameras && cameras.length > 0) {
                        const backCameras = cameras.filter(c => {
                            const lbl = (c.label || "").toLowerCase();
                            return lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment");
                        });
                        const primaryMainCam = backCameras.find(c => {
                            const lbl = (c.label || "").toLowerCase();
                            return !lbl.includes("wide") && !lbl.includes("0.5") && !lbl.includes("macro") && !lbl.includes("aux") && !lbl.includes("secondary");
                        }) || backCameras[0] || cameras[0];

                        if (primaryMainCam && primaryMainCam.id) {
                            cameraConfig = { deviceId: { exact: primaryMainCam.id } };
                        }
                    }
                } catch (e) {}

                const config = { fps: 15, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 };
                
                const onScanSuccess = async (decodedText) => {
                    if (!isScanningRef.current) return;
                    isScanningRef.current = false;
                    try { await html5Qrcode.stop(); } catch (e) {}
                    try { await html5Qrcode.clear(); } catch (e) {}

                    setStatus("PROCESSING");
                    try {
                        const response = await scanTeacherAttendance(decodedText);
                        if (response.success) {
                            setRecord(response.record || null);
                            if (response.status === "ALREADY_MARKED") {
                                setStatus("ALREADY_MARKED");
                                setMessage(response.message || "Attendance already marked.");
                                playSound('rescan');
                            } else {
                                setStatus("SUCCESS");
                                setMessage(response.message || "Attendance marked successfully!");
                                playSound('qrDone');
                            }
                            if (onSuccess) onSuccess(response.record);
                        } else {
                            setStatus("INVALID_QR");
                            setMessage(response.message || "Invalid QR code.");
                            playSound('error');
                        }
                    } catch (err) {
                        playSound('error');
                        if (err.message && err.message.toLowerCase().includes("network")) {
                            setStatus("NETWORK_ERROR");
                            setMessage("We couldn't reach the server. Please check your internet connection and try again.");
                        } else {
                            setStatus("INVALID_QR");
                            setMessage(err.message || "QR Code Not Recognized.");
                        }
                    }
                };

                const applyHardwareZoom = async () => {
                    try {
                        const videoEl = document.querySelector("#teacher-qr-reader video");
                        if (videoEl && videoEl.srcObject) {
                            const track = videoEl.srcObject.getVideoTracks()[0];
                            if (track && typeof track.getCapabilities === "function") {
                                const caps = track.getCapabilities();
                                if (caps.zoom) {
                                    const targetZoom = Math.min(caps.zoom.max || 3.0, Math.max(caps.zoom.min || 1.0, 2.0));
                                    await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
                                }
                            }
                        }
                    } catch (e) {}
                };

                try {
                    await html5Qrcode.start(cameraConfig, config, onScanSuccess, () => {});
                    setTimeout(applyHardwareZoom, 300);
                } catch (err) {
                    await html5Qrcode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
                    setTimeout(applyHardwareZoom, 300);
                }
            } catch (err) {
                setStatus("CAMERA_ERROR");
                setMessage("We couldn't access your camera. Please allow camera access in your browser settings to continue.");
            }
        }, 300);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <style>{`
                @keyframes paytmLaserSweep {
                    0% { top: 8%; opacity: 0.7; }
                    50% { top: 86%; opacity: 1; }
                    100% { top: 8%; opacity: 0.7; }
                }
                .animate-paytm-laser {
                    animation: paytmLaserSweep 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
                #teacher-qr-reader {
                    width: 100% !important;
                    height: 100% !important;
                    overflow: hidden !important;
                    border: none !important;
                }
                #teacher-qr-reader video {
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                    transform: scale(1.45) !important;
                    transform-origin: center center !important;
                }
            `}</style>
            
            <div className="bg-white max-w-sm w-full rounded-[2.5rem] p-6 shadow-2xl border border-gray-100 relative overflow-hidden text-center flex flex-col items-center">
                
                {/* Header */}
                <div className="w-full flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold shadow-xs">
                            📷
                        </div>
                        <h2 className="text-base font-black text-gray-800 uppercase tracking-tight">
                            Staff QR Scanner
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm transition-all active:scale-95"
                    >
                        ✕
                    </button>
                </div>

                {/* Main Content Body */}
                {status === "SCANNING" && (
                    <div className="w-full flex flex-col items-center">
                        <p className="text-xs text-indigo-950 font-bold mb-3">
                            Align QR code within the scanning frame
                        </p>
                        
                        {/* PayTM-Style Viewfinder Box */}
                        <div className="relative w-64 h-64 rounded-3xl overflow-hidden border-2 border-indigo-400/40 bg-black flex items-center justify-center shadow-2xl">
                            {/* Camera Video Container */}
                            <div id="teacher-qr-reader" className="w-full h-full object-cover"></div>

                            {/* PayTM Laser & Corner Frame Overlay */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-4">
                                <div className="relative w-48 h-48 rounded-2xl border border-indigo-400/20 shadow-[0_0_25px_rgba(79,70,229,0.25)]">
                                    {/* 4 PayTM Corner Brackets */}
                                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]" />

                                    {/* Animated Sweeping Cyan Laser Beam */}
                                    <div className="absolute left-1 right-1 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent rounded-full shadow-[0_0_15px_#22d3ee] animate-paytm-laser" />
                                </div>
                            </div>
                        </div>

                        <p className="text-[11px] text-indigo-600 font-extrabold mt-4 animate-pulse uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                            Detecting QR code...
                        </p>
                    </div>
                )}

                {status === "PROCESSING" && (
                    <div className="py-12 flex flex-col items-center space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
                        <p className="text-sm font-black text-indigo-950">Verifying Attendance QR...</p>
                    </div>
                )}

                {status === "SUCCESS" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl shadow-lg shadow-emerald-100">
                            ✓
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Attendance Recorded</h3>
                        <p className="text-xs text-gray-600 font-medium px-2">{message}</p>
                        
                        {record && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 w-full text-center space-y-1">
                                <div className="flex justify-between items-center text-xs font-bold text-emerald-800">
                                    <span>Date: {record.date || 'Today'}</span>
                                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-200 text-emerald-950 text-[10px] uppercase font-black">Present</span>
                                </div>
                                <p className="text-sm font-black text-emerald-950">Time Scanned: {record.scanTime}</p>
                            </div>
                        )}

                        <button
                            onClick={handleClose}
                            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-md transition-all active:scale-95"
                        >
                            Done
                        </button>
                    </div>
                )}

                {status === "ALREADY_MARKED" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-3xl shadow-lg shadow-indigo-100">
                            ℹ️
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Already Recorded</h3>
                        <p className="text-xs text-gray-600 font-medium px-2">{message}</p>
                        
                        {record && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 w-full text-center space-y-1">
                                <div className="flex justify-between items-center text-xs font-bold text-indigo-800">
                                    <span>Date: {record.date}</span>
                                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-200 text-indigo-950 text-[10px] uppercase font-black">Recorded</span>
                                </div>
                                <p className="text-sm font-black text-indigo-950">Time Recorded: {record.scanTime}</p>
                            </div>
                        )}

                        <button
                            onClick={handleClose}
                            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-md transition-all active:scale-95"
                        >
                            Close
                        </button>
                    </div>
                )}

                {status === "INVALID_QR" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-3xl shadow-lg shadow-red-100">
                            ⚠️
                        </div>
                        <h3 className="text-lg font-black text-gray-800">QR Code Not Recognized</h3>
                        <p className="text-xs text-red-600 font-medium px-2">{message || "This QR code isn't a valid staff attendance code. Please scan the official code provided at your location."}</p>

                        <div className="flex gap-2 w-full pt-2">
                            <button
                                onClick={handleRetry}
                                className="flex-1 py-3 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-xs shadow-md transition-all active:scale-95"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={handleClose}
                                className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {status === "CAMERA_ERROR" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-3xl shadow-lg shadow-amber-100">
                            🚫
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Camera Access Required</h3>
                        <p className="text-xs text-gray-600 font-medium leading-relaxed px-2">{message}</p>

                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] text-amber-800 text-left w-full space-y-1">
                            <p className="font-bold">How to fix:</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-amber-700">
                                <li>Tap padlock / site settings in URL bar.</li>
                                <li>Set Camera permission to <strong>Allow</strong>.</li>
                                <li>Tap Try Again below.</li>
                            </ol>
                        </div>

                        <button
                            onClick={handleRetry}
                            className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-bold text-sm shadow-md transition-all active:scale-95"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {status === "NETWORK_ERROR" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-3xl shadow-lg shadow-orange-100">
                            📡
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Unable to Connect</h3>
                        <p className="text-xs text-gray-600 font-medium px-2">{message}</p>

                        <div className="flex gap-2 w-full pt-2">
                            <button
                                onClick={handleRetry}
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-xs shadow-md transition-all active:scale-95"
                            >
                                Retry Scan
                            </button>
                            <button
                                onClick={handleClose}
                                className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
