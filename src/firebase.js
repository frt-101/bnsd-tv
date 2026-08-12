import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// Default Firebase Configuration template
// Replace with your Firebase Project config keys when deploying
const firebaseConfig = {
  apiKey: "AIzaSyBNSDTVConfigApiKeyHere",
  authDomain: "bnsd-tv.firebaseapp.com",
  projectId: "bnsd-tv",
  storageBucket: "bnsd-tv.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:bnsdtvapp"
};

let db = null;
let isFirebaseConnected = false;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  isFirebaseConnected = true;
} catch (e) {
  console.warn("Firebase not initialized using default keys. Falling back to local offline storage sync.");
}

export { db, isFirebaseConnected };

/**
 * Save channel state (categories, clip durations, visual FX) to Firestore or LocalStorage
 */
export async function saveChannelConfig(channelId, configData) {
  const payload = {
    ...configData,
    updatedAt: new Date().toISOString()
  };

  // Save to LocalStorage for instant reliable fallback
  localStorage.setItem(`bnsd_channel_${channelId}`, JSON.stringify(payload));

  // Save to Firestore if available
  if (isFirebaseConnected && db) {
    try {
      const channelRef = doc(db, 'channels', channelId);
      await setDoc(channelRef, payload, { merge: true });
    } catch (err) {
      console.warn("Firestore write error, using LocalStorage fallback:", err);
    }
  }
}

/**
 * Listen for real-time channel updates from Firestore or LocalStorage
 */
export function subscribeChannelConfig(channelId, callback) {
  // Load initial local config
  const localRaw = localStorage.getItem(`bnsd_channel_${channelId}`);
  if (localRaw) {
    try {
      callback(JSON.parse(localRaw));
    } catch (e) {}
  }

  // Listen to Firestore real-time doc
  if (isFirebaseConnected && db) {
    try {
      const channelRef = doc(db, 'channels', channelId);
      return onSnapshot(channelRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          localStorage.setItem(`bnsd_channel_${channelId}`, JSON.stringify(data));
          callback(data);
        }
      });
    } catch (err) {
      console.warn("Firestore snapshot listener failed:", err);
    }
  }

  return () => {};
}
