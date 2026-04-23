import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, initializeAuth, type Auth, type Persistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;
declare const navigator:
  | {
      product?: string;
    }
  | undefined;
declare const require:
  | ((id: string) => unknown)
  | undefined;

const firebaseConfig = {
  apiKey: process?.env?.NEXT_PUBLIC_FIREBASE_API_KEY || process?.env?.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:
    process?.env?.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process?.env?.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:
    process?.env?.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process?.env?.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process?.env?.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process?.env?.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process?.env?.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    process?.env?.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process?.env?.NEXT_PUBLIC_FIREBASE_APP_ID || process?.env?.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const isReactNative = navigator?.product === "ReactNative";

function createAuthInstance(): Auth {
  if (!isReactNative || typeof require !== "function") {
    return getAuth(app);
  }

  try {
    const storageModule = require("@react-native-async-storage/async-storage") as {
      default?: unknown;
    };
    const authModule = require("firebase/auth") as {
      getReactNativePersistence?: (storage: unknown) => unknown;
    };
    const asyncStorage = storageModule?.default;
    const reactNativePersistence = authModule?.getReactNativePersistence;

    if (!asyncStorage || !reactNativePersistence) {
      return getAuth(app);
    }

    return initializeAuth(app, {
      persistence: reactNativePersistence(asyncStorage) as Persistence,
    });
  } catch (error) {
    const authError = error as { code?: string };
    if (authError?.code === "auth/already-initialized") {
      return getAuth(app);
    }

    return getAuth(app);
  }
}

export const auth = createAuthInstance();
export const db = getFirestore(app);
export const storage = getStorage(app);
