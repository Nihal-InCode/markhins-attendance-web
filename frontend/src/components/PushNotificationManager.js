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
  const [subscriptionReady, setSubscriptionReady] = useState(false);
  const [busy, setBusy] = useState(false);

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
        console.log('[PushNotificationManager] Web Push Subscription saved.');
      }
      return true;
    } catch (err) {
      setSubscriptionReady(false);
      console.warn('[PushNotificationManager Error]:', err.message);
      return false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') subscribeUser();
  }, [user, subscribeUser]);

  const requestPushPermission = async () => {
    if (!('Notification' in window)) return;
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') await subscribeUser();
    } catch (err) {
      console.warn('[PushNotificationManager Error]:', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user || typeof window === 'undefined' || !('Notification' in window) || subscriptionReady) return null;

  return (
    <div className="fixed bottom-4 left-3 right-3 z-[10000] mx-auto flex max-w-lg justify-center sm:left-auto sm:right-5">
      <button type="button" onClick={requestPushPermission} disabled={busy} className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-xl hover:bg-amber-600 disabled:opacity-60">
        {busy ? "Checking…" : "Enable Notifications"}
      </button>
    </div>
  );
}
