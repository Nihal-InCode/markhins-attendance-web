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
        <div className="fixed top-4 right-4 z-[10000] rounded-2xl bg-emerald-600 text-white px-4 py-2.5 shadow-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <span>🔔</span>
          <span>{msg}</span>
        </div>
      )}

      {showBanner && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xs sm:max-w-sm rounded-3xl bg-slate-900 text-white p-5 shadow-2xl border border-slate-800/90 flex flex-col items-center text-center gap-3 animate-in zoom-in-95 duration-200">
            {/* Top Icon */}
            <div className="h-12 w-12 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-2xl text-purple-400 shrink-0 mb-1">
              🔔
            </div>

            {/* Minimal Heading & Description */}
            <div>
              <h4 className="text-base font-bold text-white">Enable Notifications</h4>
              <p className="text-xs text-slate-400 mt-1 leading-snug">
                Get daily attendance reminders & important alerts.
              </p>
            </div>

            {permissionState === 'denied' ? (
              <div className="w-full bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-200 text-center leading-tight">
                ⚠️ Notifications are blocked in browser settings. Please allow them from address bar 🔒 settings.
              </div>
            ) : null}

            {/* Action Buttons */}
            <div className="w-full flex flex-col gap-2 pt-2 border-t border-slate-800/80">
              {permissionState !== 'denied' && (
                <button
                  onClick={handleEnablePush}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-900/40 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Enabling..." : "Allow Notifications"}
                </button>
              )}
              <button
                onClick={handleDismiss}
                className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all"
              >
                {permissionState === 'denied' ? "Close" : "Not Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
