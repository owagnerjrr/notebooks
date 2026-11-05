import { services } from '../server/firebase.js';
import { ApiError, fail, day } from '../server/domain.js';
import { checkOrigin, identity, rateLimit, openAdminSession, cookieName } from '../server/security.js';
import { state, mutate, metaPath } from '../server/store.js';
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
async function handle(request) {
  try {
    checkOrigin(request);
    const svc = await services();
    const actor = await identity(request, svc);
    await rateLimit(request, svc.db, request.method === 'POST');
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Envie JSON.');
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 24000) fail(413, 'Solicitação muito grande.');
      let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'JSON inválido.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Solicitação inválida.');
      if (body.action === 'openAdmin') return new Response(JSON.stringify({ supervisor: true }), { headers: { ...headers, 'Set-Cookie': openAdminSession(body.token) } });
      if (body.action === 'closeAdmin') return new Response('{}', { headers: { ...headers, 'Set-Cookie': `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });
      return json(await mutate(svc.db, body, actor));
    }
    const url = new URL(request.url), op = url.searchParams.get('op') || 'state';
    if (op === 'session') return json({ supervisor: actor.supervisor });
    if (op === 'stream') {
      let stop = () => {}, timer, unsubscribe;
      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          stop = () => { if (closed) return; closed = true; clearTimeout(timer); unsubscribe?.(); request.signal.removeEventListener('abort', stop); try { controller.close(); } catch {} };
          unsubscribe = svc.db.doc(metaPath).onSnapshot(snap => {
            if (closed) return;
            try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ revision: snap.data()?.revision || 0 })}\n\n`)); } catch { stop(); }
          }, stop);
          // Renew each connection before Vercel's configured execution deadline.
          timer = setTimeout(stop, 45000);
          request.signal.addEventListener('abort', stop, { once: true });
          if (request.signal.aborted) stop();
        },
        cancel() { stop(); }
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
    }
    if (op !== 'state') fail(404, 'Recurso não encontrado.');
    const first = day(url.searchParams.get('first')), last = day(url.searchParams.get('last') || first);
    return json(await state(svc.db, first, last, actor.supervisor));
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('notebooks-api', error.code || error.name);
    return json({ error: error instanceof ApiError ? error.message : 'Serviço temporariamente indisponível.' }, error.status || 503);
  }
}
export const GET = handle;
export const POST = handle;
