import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { fail } from './domain.js';
export function services() {
  if (process.env.INTEGRATION_ENABLED !== 'true' || process.env.FIREBASE_DATABASE_EDITION !== 'STANDARD') fail(503, 'Sincronização aguardando configuração e validação.');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== 'central-notebooks-senac') fail(503, 'Projeto Firebase inválido.');
  const app = getApps()[0] ?? initializeApp({ projectId, credential: process.env.FIREBASE_PRIVATE_KEY ? cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) : applicationDefault() });
  return { db: getFirestore(app, process.env.FIREBASE_DATABASE_ID || '(default)'), auth: getAuth(app), appCheck: getAppCheck(app) };
}
