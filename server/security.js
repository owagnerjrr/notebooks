import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './domain.js';
export const cookieName = '__Host-notebooks-admin';
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const digest = value => createHash('sha256').update(value).digest('hex');
export function hasAdminLink(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && equal(digest(token), process.env.ADMIN_LINK_HASH);
}
function sign(value) {
  if (!process.env.ADMIN_SESSION_SECRET || !process.env.ADMIN_LINK_HASH) fail(503, 'Acesso administrativo aguardando configuração.');
  return createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(value + ':' + process.env.ADMIN_LINK_HASH).digest('hex');
}
export function openAdminSession(token, now = Date.now()) {
  if (!hasAdminLink(token)) fail(403, 'Link administrativo inválido.');
  const payload = Buffer.from(JSON.stringify({ exp: now + 8 * 3600000 })).toString('base64url');
  return `${cookieName}=${payload}.${sign(payload)}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`;
}
export function hasAdminSession(request, now = Date.now()) {
  const value = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!value || value.length > 300 || !process.env.ADMIN_SESSION_SECRET || !process.env.ADMIN_LINK_HASH) return false;
  try {
    const [payload, signature, extra] = value.split('.');
    if (extra || !equal(signature, sign(payload))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.exp) && data.exp > now && data.exp <= now + 8 * 3600000;
  } catch { return false; }
}
export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim());
  if (origin && !allowed.includes(origin)) fail(403, 'Origem não autorizada.');
  if (request.method === 'POST' && !origin) fail(403, 'Origem obrigatória.');
}
export async function identity(request, { appCheck }) {
  // Teachers have no login. Optional App Check supplements always-on server
  // validation, durable rate limiting and strict origin checks.
  const token = request.headers.get('x-firebase-appcheck');
  if (process.env.APP_CHECK_REQUIRED === 'true' && !token) fail(401, 'Verificação do aplicativo obrigatória.');
  if (token) try {
    const result = await appCheck.verifyToken(token);
    if (result.appId !== process.env.FIREBASE_APP_ID) fail(401, 'Aplicativo inválido.');
  } catch { fail(401, 'Não foi possível verificar este aplicativo.'); }
  const link = request.headers.get('x-notebooks-admin-link');
  if (link && !hasAdminLink(link)) fail(403, 'Link administrativo inválido.');
  const supervisor = hasAdminLink(link) || hasAdminSession(request);
  return { user: supervisor ? { uid: 'admin-link' } : null, supervisor };
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
    if (count >= (write ? 30 : 240)) fail(429, 'Muitas solicitações. Aguarde um minuto.');
    tx.set(ref, { count: count + 1, expiresAt: new Date((bucket + 2) * 60000) });
  });
}
