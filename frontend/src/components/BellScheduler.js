"use client";

import { useEffect, useRef, useState } from "react";
import { getBellSchedule } from "@/lib/api";

export default function BellScheduler() {
  const [countdown, setCountdown] = useState(null);
  const [bellMessage, setBellMessage] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    let schedule = [];
    let systemEnabled = true;
    let disposed = false;
    let lastRefresh = 0;
    const lastPlayed = new Set();
    let countdownInterval = null;

    const playBell = async (message) => {
      const audio = new Audio("/sounds/bell.mp3");
      audio.loop = false;
      audioRef.current = audio;
      audio.onended = () => {
        window.clearInterval(countdownInterval);
        countdownInterval = null;
        audioRef.current = null;
        setCountdown(null);
        setBellMessage("");
      };
      audio.onerror = () => {
        window.clearInterval(countdownInterval);
        countdownInterval = null;
        audioRef.current = null;
        setCountdown(null);
        setBellMessage("");
      };
      try {
        await audio.play();
        const startedAt = Date.now();
        setBellMessage(message || "");
        setCountdown(10);
        countdownInterval = window.setInterval(() => {
          const remaining = Math.max(0, 10 - Math.floor((Date.now() - startedAt) / 1000));
          setCountdown(remaining);
          if (remaining <= 0) {
            audio.pause();
            audio.currentTime = 0;
            window.clearInterval(countdownInterval);
            countdownInterval = null;
            audioRef.current = null;
            setCountdown(null);
            setBellMessage("");
          }
        }, 200);
      } catch (error) {
        audioRef.current = null;
        setCountdown(null);
        setBellMessage("");
        console.warn("Scheduled bell playback was blocked or the sound file is missing:", error);
      }
    };

    const refresh = async () => {
      try {
        const settings = await getBellSchedule();
        if (disposed) return;
        schedule = Array.isArray(settings?.bell_schedule) ? settings.bell_schedule : [];
        systemEnabled = settings?.enabled !== false;
        lastRefresh = Date.now();
      } catch (_) {
        // Keep the last known schedule when temporarily offline.
      }
    };

    const tick = async () => {
      if (Date.now() - lastRefresh > 60_000) await refresh();
      if (disposed || !systemEnabled || document.visibilityState !== "visible") return;
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(now);
      const value = (type) => parts.find((part) => part.type === type)?.value;
      const localDate = `${value("year")}-${value("month")}-${value("day")}`;
      const currentSeconds = Number(value("hour")) * 3600 + Number(value("minute")) * 60 + Number(value("second"));
      schedule.forEach((entry) => {
        if (entry?.enabled === false || !/^\d{2}:\d{2}$/.test(entry?.time || "")) return;
        const [hours, minutes] = entry.time.split(":").map(Number);
        const bellSeconds = hours * 3600 + minutes * 60 - 10;
        const bellDate = bellSeconds < 0 ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(now.getTime() - 86400000)) : localDate;
        const normalizedSeconds = (bellSeconds + 86400) % 86400;
        const key = `${bellDate}-${entry.time}-${entry.id || "bell"}`;
        if (bellDate === localDate && currentSeconds >= normalizedSeconds && currentSeconds < normalizedSeconds + 2 && !lastPlayed.has(key)) {
          lastPlayed.add(key);
          playBell(entry.message);
        }
      });
      if (lastPlayed.size > 200) lastPlayed.clear();
    };

    refresh().then(tick);
    const interval = window.setInterval(tick, 1000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearInterval(countdownInterval);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (countdown === null) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 p-6 text-center text-white backdrop-blur-sm" role="alertdialog" aria-live="assertive" aria-label={`School bell sounding, ${countdown} seconds remaining`}>
      <div className="flex flex-col items-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-4xl">🔔</div>
        <p className="max-w-5xl break-words text-4xl font-black leading-tight sm:text-6xl lg:text-7xl">{bellMessage || "ITS TIME"}</p>
        <p className="mt-6 text-7xl font-black tabular-nums leading-none sm:text-8xl">{countdown}</p>
        <p className="mt-3 text-sm font-semibold text-white/70">seconds remaining</p>
      </div>
    </div>
  );
}
