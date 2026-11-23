"use client";
import { useEffect, useCallback, useState } from "react";
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
  const [permission, setPermission] = useState("default");
  const [subscriptionReady, setSubscriptionReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const subscribeUser = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error("This browser does not support push notifications.");
      const registration = await navigator.serviceWorker.register('/sw.js');
      const keyRes = await getPushPublicKey();
      if (!keyRes || !keyRes.publicKey) throw new Error("Push notifications are not available right now.");

      const convertedVapidKey = urlBase64ToUint8Array(keyRes.publicKey);
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      if (subscription && user) {
        const result = await savePushSubscription(subscription, user.phone || user.username || '');
        if (result?.success === false) throw new Error(result.message || "Could not register this device.");
        setSubscriptionReady(true);
        setMessage("Bell notifications are enabled on this device.");
        console.log('[PushNotificationManager] Web Push Subscription saved.');
      }
      return true;
    } catch (err) {
      setSubscriptionReady(false);
      setMessage(err.message || "Could not enable bell notifications on this device.");
      console.warn('[PushNotificationManager Error]:', err.message);
      return false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setPermission(Notification.permission);
    if (Notification.permission === 'granted') subscribeUser();
  }, [user, subscribeUser]);

  const requestPushPermission = async () => {
    if (!('Notification' in window)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') await subscribeUser();
      else if (result === 'denied') setMessage("Notifications are blocked for this site. Allow them in Android app or browser settings, then return here.");
      else setMessage("Choose Allow in the browser notification prompt to receive school bells.");
    } catch (err) {
      setMessage(err.message || "The browser could not open its notification prompt.");
    } finally {
      setBusy(false);
    }
  };

  if (!user || typeof window === 'undefined' || !('Notification' in window) || subscriptionReady) return null;

  const permissionDenied = permission === 'denied';
  return (
    <div className="fixed bottom-4 left-3 right-3 z-[10000] mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden="true">🔔</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-900">Enable school bell notifications</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {permissionDenied
              ? "Android blocked the earlier request. Change Notifications to Allow in this app’s or browser’s site settings, then come back and try again."
              : "Tap below to open Android’s native notification permission prompt. Choose Allow so bells can reach this device when the app is closed."}
          </p>
          {message && <p className="mt-2 text-[11px] font-semibold text-amber-800">{message}</p>}
          <button type="button" onClick={requestPushPermission} disabled={busy} className="mt-3 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-60">
            {busy ? "Checking permission…" : permissionDenied ? "Check Notification Permission" : "Enable Notifications"}
          </button>
          {permissionDenied && <p className="mt-2 text-[10px] text-gray-500">Android: long-press the app icon → App info → Notifications → Allow. For Chrome, open Site settings → Notifications → MARKHINS HUB → Allow.</p>}
        </div>
      </div>
    </div>
  );
}
