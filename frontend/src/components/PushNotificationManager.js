"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { getPushPublicKey, savePushSubscription } from "@/lib/api";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationManager() {
  const { user } = useAuth();
  const [permissionState, setPermissionState] = useState("default");
  const [showBanner, setShowBanner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const subscribeUser = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const registration = await navigator.serviceWorker.register('/sw.js');
      const keyRes = await getPushPublicKey();
      if (!keyRes || !keyRes.publicKey) return;

      const convertedVapidKey = urlBase64ToUint8Array(keyRes.publicKey);
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      if (subscription && user) {
        await savePushSubscription(subscription, user.phone || user.username || '');
        console.log('[PushNotificationManager] Web Push Subscription saved.');
      }
    } catch (err) {
      console.warn('[PushNotificationManager Error]:', err.message);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const currentPerm = Notification.permission;
    setPermissionState(currentPerm);

    if (currentPerm === 'granted') {
      subscribeUser();
    } else {
      const dismissed = sessionStorage.getItem('push_banner_dismissed');
      if (!dismissed) {
        setShowBanner(true);
      }
    }
  }, [user, subscribeUser]);

  async function handleEnablePush() {
    setLoading(true);
    setMsg("");
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        alert("Notifications are not supported by this browser.");
        return;
      }

      const perm = await Notification.requestPermission();
      setPermissionState(perm);

      if (perm === 'granted') {
        await subscribeUser();
        setShowBanner(false);
        setMsg("Push notifications enabled!");
        setTimeout(() => setMsg(""), 4000);
      } else if (perm === 'denied') {
        alert("Notification permission is blocked by your browser settings. Please click the lock icon in your browser address bar to allow notifications.");
      }
    } catch (err) {
      console.error("[Push Error]:", err);
      alert("Failed to enable notifications: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    setShowBanner(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('push_banner_dismissed', '1');
    }
  }

  return (
    <>
      {msg && (
        <div className="fixed top-4 right-4 z-50 rounded-2xl bg-emerald-600 text-white px-4 py-2.5 shadow-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <span>🔔</span>
          <span>{msg}</span>
        </div>
      )}

      {showBanner && (
        <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-96 z-50 rounded-3xl bg-slate-900/95 backdrop-blur-md text-white p-5 shadow-2xl border border-slate-800/80 flex flex-col gap-3 animate-in slide-in-from-bottom duration-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-xl shrink-0">
                🔔
              </div>
              <div>
                <h4 className="text-sm font-black text-white">Enable Attendance Alerts</h4>
                <p className="text-xs text-slate-300 mt-0.5 leading-snug">
                  Receive daily 8:00 AM scan reminders & hub alerts directly on your phone.
                </p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-slate-400 hover:text-white text-xs font-bold p-1 shrink-0"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          {permissionState === 'denied' ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-200">
              ⚠️ Notification permission was blocked in browser settings. Please tap the lock icon in your browser address bar to <b>Allow Notifications</b>.
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                onClick={handleDismiss}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all"
              >
                Not Now
              </button>
              <button
                onClick={handleEnablePush}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black shadow-lg shadow-purple-900/40 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                <span>{loading ? "Enabling..." : "Enable Notifications"}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
