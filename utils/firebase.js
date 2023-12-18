import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {} from "dotenv/config";

const FIREBASE_CONFIG = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.AUTH_DOMAIN,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
  appId: process.env.APP_ID,
  measurementId: process.env.MEASUREMENT_ID,
};

const APP = initializeApp(FIREBASE_CONFIG);
export const DB = getFirestore(APP);
