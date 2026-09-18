"use client";
import { useEffect } from "react";
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

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    let isSubscribed = false;

    async function initPush() {
      try {
        // Register SW
        const registration = await navigator.serviceWorker.register('/sw.js');
        
        // Fetch VAPID key
        const keyRes = await getPushPublicKey();
        if (!keyRes || !keyRes.publicKey) return;

        const convertedVapidKey = urlBase64ToUint8Array(keyRes.publicKey);

        // Check permission state
        if (Notification.permission === 'default') {
          // Ask for permission gracefully
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') return;
        } else if (Notification.permission !== 'granted') {
          return;
        }

        // Get existing subscription or create new
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey
          });
        }

        // Send subscription to server
        if (subscription && !isSubscribed) {
          isSubscribed = true;
          await savePushSubscription(subscription, user.phone || user.username || '');
          console.log('[PushNotificationManager] Web Push Subscription saved.');
        }
      } catch (err) {
        console.warn('[PushNotificationManager Warning]:', err.message);
      }
    }

    initPush();
  }, [user]);

  return null;
}
