import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// Default Firebase Configuration template — these are placeholder values, not
// a real project. Replace with your Firebase Project config keys to enable
// live multi-projector sync (and see docs/ANDROID_PROJECTOR_SETUP.md for the
// Firestore security rules that must be configured before doing so).
const firebaseConfig = {
  apiKey: "AIzaSyBNSDTVConfigApiKeyHere",
  authDomain: "bnsd-tv.firebaseapp.com",
  projectId: "bnsd-tv",
  storageBucket: "bnsd-tv.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:bnsdtvapp"
};

const isPlaceholderConfig = firebaseConfig.apiKey === "AIzaSyBNSDTVConfigApiKeyHere";

let db = null;
let isFirebaseConnected = false;

if (isPlaceholderConfig) {
  console.warn("Firebase config is still the placeholder template — running in local-storage-only mode. Set real project keys in src/firebase.js to enable cross-projector sync.");
} else {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isFirebaseConnected = true;
  } catch (e) {
    console.warn("Firebase initialization failed. Falling back to local offline storage sync.", e);
  }
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
