import { createHmac } from 'node:crypto';
import { fail, canSupervise } from './domain.js';
export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim());
  if (origin && !allowed.includes(origin)) fail(403, 'Origem não autorizada.');
  if (request.method === 'POST' && !origin) fail(403, 'Origem obrigatória.');
}
export async function identity(request, { auth, appCheck }) {
  const token = request.headers.get('x-firebase-appcheck');
  if (!token) fail(401, 'Verificação do aplicativo obrigatória.');
  try {
    const result = await appCheck.verifyToken(token);
    if (result.appId !== process.env.FIREBASE_APP_ID) fail(401, 'Aplicativo inválido.');
  } catch { fail(401, 'Não foi possível verificar este aplicativo.'); }
  let user = null;
  const bearer = request.headers.get('authorization');
  if (bearer) {
    if (!bearer.startsWith('Bearer ')) fail(401, 'Login inválido.');
    try { user = await auth.verifyIdToken(bearer.slice(7), true); } catch { fail(401, 'Sessão expirada ou revogada.'); }
  }
  return { user, supervisor: canSupervise(user, process.env.SUPERVISOR_UIDS) };
}
export async function rateLimit(request, db, write = false) {
  if (!process.env.RATE_LIMIT_SECRET) fail(503, 'Proteção de tráfego pendente.');
  // Vercel overwrites x-vercel-forwarded-for at its trusted ingress.
  // Do not trust browser-provided x-forwarded-for.
  const ip = request.headers.get('x-vercel-forwarded-for');
  if (!ip) fail(503, 'Ingresso confiável indisponível.');
  const bucket = Math.floor(Date.now() / 60000);
  const digest = createHmac('sha256', process.env.RATE_LIMIT_SECRET).update(ip + ':' + bucket + ':' + write).digest('hex');
  const ref = db.collection('notebookRateLimits').doc(digest);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref), count = snap.exists ? snap.data().count : 0;
    if (count >= (write ? 20 : 180)) fail(429, 'Muitas solicitações. Aguarde um minuto.');
    tx.set(ref, { count: count + 1, expiresAt: new Date((bucket + 2) * 60000) });
  });
}
