import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
import { fail } from './domain.js';
let validated;
export async function services() {
  if (process.env.INTEGRATION_ENABLED !== 'true') fail(503, 'Sincronização aguardando configuração e validação.');
  const projectId = process.env.FIREBASE_PROJECT_ID, database = process.env.FIREBASE_DATABASE_ID || '(default)';
  if (projectId !== 'central-notebooks-senac' || database !== '(default)') fail(503, 'Projeto Firebase inválido.');
  const app = getApps()[0] ?? initializeApp({ projectId, credential: process.env.FIREBASE_PRIVATE_KEY ? cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) : applicationDefault() });
  // Confirm the existing edition and location with the server credential before
  // any data operation. Never provision or silently switch databases.
  if (!validated) validated = (async () => {
    const token = await app.options.credential.getAccessToken();
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}`, { headers: { Authorization: 'Bearer ' + token.access_token } });
    if (!response.ok) throw new Error('database-metadata-' + response.status);
    const info = await response.json();
    if (info.type !== 'FIRESTORE_NATIVE' || info.databaseEdition && info.databaseEdition !== 'STANDARD') throw new Error('unsupported-database-edition');
    console.info('notebooks-database-validated', info.type, info.databaseEdition || 'STANDARD', info.locationId);
  })().catch(error => { validated = null; throw error; });
  await validated;
  return { db: getFirestore(app, database), appCheck: getAppCheck(app) };
}
