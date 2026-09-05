"use client";
import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { scanTeacherAttendance } from "@/lib/api";

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

                const html5Qrcode = new Html5Qrcode("teacher-qr-reader");
                scannerRef.current = html5Qrcode;
                isScanningRef.current = true;

                const config = {
                    fps: 10,
                    qrbox: { width: 240, height: 240 },
                    aspectRatio: 1.0,
                };

                await html5Qrcode.start(
                    { facingMode: "environment" },
                    config,
                    async (decodedText) => {
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
                                    setMessage(response.message || "Attendance already marked for today.");
                                } else {
                                    setStatus("SUCCESS");
                                    setMessage(response.message || "Attendance marked successfully!");
                                }
                                if (onSuccess) onSuccess(response.record);
                            } else {
                                setStatus("INVALID_QR");
                                setMessage(response.message || "Invalid Office QR code.");
                            }
                        } catch (err) {
                            console.error("Scan submit error:", err);
                            if (err.message && err.message.toLowerCase().includes("network")) {
                                setStatus("NETWORK_ERROR");
                                setMessage("Unable to connect to server. Please check your connection.");
                            } else {
                                setStatus("INVALID_QR");
                                setMessage(err.message || "Invalid Office QR code.");
                            }
                        }
                    },
                    () => {
                        // QR Code scan failure callback (frame by frame - ignorable)
                    }
                );
            } catch (err) {
                console.error("Camera access error:", err);
                if (isMounted) {
                    setStatus("CAMERA_ERROR");
                    setMessage("Unable to access phone camera. Please grant camera permission in your browser.");
                }
            }
        };

        // Small delay to allow DOM to render modal container
        const timer = setTimeout(startScanner, 200);

        return () => {
            isMounted = false;
            clearTimeout(timer);
            cleanupScanner();
        };
    }, [isOpen]);

    const cleanupScanner = () => {
        isScanningRef.current = false;
        if (scannerRef.current) {
            if (scannerRef.current.isScanning) {
                scannerRef.current.stop().catch(() => {}).finally(() => {
                    scannerRef.current = null;
                });
            } else {
                scannerRef.current = null;
            }
        }
    };

    const handleRetry = () => {
        cleanupScanner();
        setStatus("SCANNING");
        setMessage("");
        setRecord(null);

        setTimeout(async () => {
            try {
                const html5Qrcode = new Html5Qrcode("teacher-qr-reader");
                scannerRef.current = html5Qrcode;
                isScanningRef.current = true;

                await html5Qrcode.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
                    async (decodedText) => {
                        if (!isScanningRef.current) return;
                        isScanningRef.current = false;
                        try { await html5Qrcode.stop(); } catch (e) {}

                        setStatus("PROCESSING");
                        try {
                            const response = await scanTeacherAttendance(decodedText);
                            if (response.success) {
                                setRecord(response.record || null);
                                if (response.status === "ALREADY_MARKED") {
                                    setStatus("ALREADY_MARKED");
                                    setMessage(response.message || "Attendance already marked for today.");
                                } else {
                                    setStatus("SUCCESS");
                                    setMessage(response.message || "Attendance marked successfully!");
                                }
                                if (onSuccess) onSuccess(response.record);
                            } else {
                                setStatus("INVALID_QR");
                                setMessage(response.message || "Invalid Office QR code.");
                            }
                        } catch (err) {
                            if (err.message && err.message.toLowerCase().includes("network")) {
                                setStatus("NETWORK_ERROR");
                                setMessage("Unable to connect to server. Please check your connection.");
                            } else {
                                setStatus("INVALID_QR");
                                setMessage(err.message || "Invalid Office QR code.");
                            }
                        }
                    },
                    () => {}
                );
            } catch (err) {
                setStatus("CAMERA_ERROR");
                setMessage("Unable to access phone camera. Please grant camera permission.");
            }
        }, 300);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white max-w-sm w-full rounded-[2.5rem] p-6 shadow-2xl border border-gray-100 relative overflow-hidden text-center flex flex-col items-center">
                
                {/* Header */}
                <div className="w-full flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                            📷
                        </div>
                        <h2 className="text-base font-black text-gray-800 uppercase tracking-tight">
                            Office QR Attendance
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm transition-all"
                    >
                        ✕
                    </button>
                </div>

                {/* Main Content Body */}
                {status === "SCANNING" && (
                    <div className="w-full flex flex-col items-center">
                        <p className="text-xs text-gray-500 font-medium mb-3">
                            Point camera at the office QR code
                        </p>
                        <div className="relative w-64 h-64 rounded-3xl overflow-hidden border-4 border-blue-500/30 bg-black flex items-center justify-center shadow-inner">
                            <div id="teacher-qr-reader" className="w-full h-full"></div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-4 animate-pulse font-medium">
                            Scanning active camera feed...
                        </p>
                    </div>
                )}

                {status === "PROCESSING" && (
                    <div className="py-12 flex flex-col items-center space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
                        <p className="text-sm font-bold text-gray-700">Verifying Office QR Code...</p>
                    </div>
                )}

                {status === "SUCCESS" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl shadow-lg shadow-green-100">
                            ✓
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Attendance Marked!</h3>
                        <p className="text-xs text-gray-500">{message}</p>
                        
                        {record && (
                            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 w-full text-center">
                                <p className="text-xs font-semibold text-green-700">Today: {record.date}</p>
                                <p className="text-sm font-black text-green-900 mt-0.5">Scanned at: {record.scanTime}</p>
                            </div>
                        )}

                        <button
                            onClick={onClose}
                            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-sm shadow-md transition-all active:scale-95"
                        >
                            Done
                        </button>
                    </div>
                )}

                {status === "ALREADY_MARKED" && (
                    <div className="py-6 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-3xl shadow-lg shadow-blue-100">
                            ℹ️
                        </div>
                        <h3 className="text-lg font-black text-gray-800">Already Marked Today</h3>
                        <p className="text-xs text-gray-500">{message}</p>
                        
                        {record && (
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 w-full text-center">
                                <p className="text-xs font-semibold text-blue-700">Date: {record.date}</p>
                                <p className="text-sm font-black text-blue-900 mt-0.5">Time Recorded: {record.scanTime}</p>
                            </div>
                        )}

                        <button
                            onClick={onClose}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-md transition-all active:scale-95"
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
                        <h3 className="text-lg font-black text-gray-800">Invalid Office QR</h3>
                        <p className="text-xs text-red-600 font-medium px-2">{message || "The scanned QR code is not recognized as the official office attendance QR."}</p>

                        <div className="flex gap-2 w-full pt-2">
                            <button
                                onClick={handleRetry}
                                className="flex-1 py-3 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-xs shadow-md transition-all active:scale-95"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={onClose}
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
                        <h3 className="text-lg font-black text-gray-800">Camera Access Blocked</h3>
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
                        <h3 className="text-lg font-black text-gray-800">Connection Failed</h3>
                        <p className="text-xs text-gray-600 font-medium px-2">{message}</p>

                        <div className="flex gap-2 w-full pt-2">
                            <button
                                onClick={handleRetry}
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-xs shadow-md transition-all active:scale-95"
                            >
                                Retry Scan
                            </button>
                            <button
                                onClick={onClose}
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
