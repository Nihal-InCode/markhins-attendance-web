"use client";
import { useEffect, useCallback } from "react";
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

    if (Notification.permission === 'granted') {
      subscribeUser();
      return;
    }
    if (Notification.permission !== 'default') return;

    let requested = false;
    const requestNativePermission = async () => {
      if (requested || Notification.permission !== 'default') return;
      requested = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') await subscribeUser();
      } catch (err) {
        console.warn('[PushNotificationManager Error]:', err.message);
      }
    };

    const events = ['pointerdown', 'keydown', 'touchstart'];
    const onInteraction = () => {
      events.forEach((evt) => window.removeEventListener(evt, onInteraction, true));
      requestNativePermission();
    };
    events.forEach((evt) => window.addEventListener(evt, onInteraction, { capture: true }));

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, onInteraction, true));
    };
  }, [user, subscribeUser]);

  return null;
}
