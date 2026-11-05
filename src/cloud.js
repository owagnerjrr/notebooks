import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';

const ui = window.NotebooksUI;
const status = document.getElementById('syncStatus');
const login = document.getElementById('supervisorLogin');
const requestedAdmin = new URLSearchParams(location.search).get('painel') === 'supervisao';
let auth, appCheck, authorized = false, ready = false, streamAbort, refreshSequence = 0, authSequence = 0, lastState;
const tell = message => { status.textContent = message; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function headers() {
  const result = { 'X-Firebase-AppCheck': (await getToken(appCheck)).token };
  if (auth.currentUser) result.Authorization = 'Bearer ' + await auth.currentUser.getIdToken();
  return result;
}
async function api(query, body) {
  const response = await fetch('/api/notebooks?' + query, {
    method: body ? 'POST' : 'GET', headers: { ...await headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Falha na sincronização.'); error.status = response.status; throw error; }
  return data;
}
async function refresh() {
  if (!appCheck) return;
  const seq = ++refreshSequence, range = ui.range();
  try {
    const data = await api(new URLSearchParams({ first: range.first, last: range.last }));
    if (seq !== refreshSequence) return;
    lastState = data; ready = true; ui.connected(true); ui.apply(data); tell('Conectado · agendamentos compartilhados entre dispositivos.');
  } catch (error) { if (seq === refreshSequence) { ready = false; ui.connected(false); tell(error.message + ' Reservas locais preservadas.'); } throw error; }
}
async function realtime() {
  streamAbort?.abort();
  const abort = streamAbort = new AbortController();
  let delay = 1000;
  while (!abort.signal.aborted) {
    try {
      const response = await fetch('/api/notebooks?op=stream', { headers: await headers(), signal: abort.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('Conexão em tempo real indisponível.');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n'); buffer = events.pop();
        for (const event of events) if (event.startsWith('data: ')) await refresh();
      }
      delay = 1000;
    } catch {
      if (!abort.signal.aborted) { ready = false; ui.connected(false); tell('Conexão interrompida. Tentando reconectar; novas reservas aguardam conexão.'); }
      delay = Math.min(delay * 2, 30000);
    }
    if (!abort.signal.aborted) await wait(delay);
  }
}
let sending = false;
// Keep the same request after ambiguous network failures. A retry cannot create
// duplicates even when the server committed but its response was lost.
const pending = new Map();
ui.setTransport(async (action, payload) => {
  if (!ready) throw new Error('Aguarde a conexão com o servidor.');
  if (action !== 'reserve' && !authorized) throw new Error('Entre com uma conta autorizada da Supervisão.');
  if (sending) throw new Error('Aguarde a operação em andamento.');
  const signature = JSON.stringify({ action, payload });
  const requestId = pending.get(signature) || crypto.randomUUID();
  pending.set(signature, requestId); sending = true;
  try {
    const result = await api('', { action, payload, requestId });
    pending.delete(signature);
    await refresh().catch(() => {});
    return result;
  } catch (error) {
    if (error.status && error.status < 500) pending.delete(signature);
    throw error;
  } finally { sending = false; }
});
ui.onRangeChange(() => refresh().catch(() => {}));
document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (!auth) throw new Error('Login aguardando configuração.');
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
  } catch { document.getElementById('loginError').textContent = 'Não foi possível entrar. Confira o acesso com a administração.'; }
  finally { document.getElementById('loginPassword').value = ''; }
});
document.getElementById('logout').addEventListener('click', () => signOut(auth));
document.getElementById('exportLocal').addEventListener('click', () => {
  const raw = localStorage.getItem(ui.localKey);
  if (!raw) { alert('Este navegador não tem dados antigos.'); return; }
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'reservas-locais-' + new Date().toISOString().slice(0,10) + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.getElementById('importLocal').addEventListener('click', async () => {
  if (!authorized || !ready) return alert('Entre na Supervisão e aguarde a conexão.');
  let source;
  try { source = JSON.parse(localStorage.getItem(ui.localKey) || '{}'); } catch { return alert('Dados locais inválidos. Exporte uma cópia para análise.'); }
  const rows = source.reservations;
  if (!Array.isArray(rows) || !rows.length) return alert('Nenhuma reserva local para importar.');
  const preview = rows.map(r => `${r.teacher}: ${r.date} ${r.start}–${r.end} · ${r.numbers?.join(', ')}`).join('\n');
  if (!confirm(`Importar ${rows.length} reserva(s) deste navegador?\n${preview.slice(0,3000)}\nDuplicatas serão ignoradas e conflitos serão informados. Os dados locais, bloqueios e histórico original serão mantidos intactos.`)) return;
  const results = [];
  for (const row of rows) {
    try { const result = await ui.send('import', { reservation: row }); results.push(`${row.teacher} ${row.date}: ${result.imported ? 'importada' : 'já registrada'}`); }
    catch (error) { results.push(`${row.teacher} ${row.date}: ${error.message}`); }
  }
  document.getElementById('importResult').textContent = results.join('\n');
});
login.hidden = !requestedAdmin;
if (!import.meta.env.VITE_FIREBASE_API_KEY || !import.meta.env.VITE_APP_CHECK_SITE_KEY) {
  tell('Integração aguardando configuração. Dados antigos preservados; exporte uma cópia neste navegador.');
} else {
  try {
    const app = initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: 'central-notebooks-senac.firebaseapp.com', projectId: 'central-notebooks-senac', storageBucket: 'central-notebooks-senac.firebasestorage.app', messagingSenderId: '87948044049', appId: '1:87948044049:web:85896b009e41fe16c10eb0' });
    appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    auth = getAuth(app);
    await setPersistence(auth, browserSessionPersistence);
    onAuthStateChanged(auth, async user => {
      const authVersion = ++authSequence;
      streamAbort?.abort();
      authorized = false; ui.authorize(false); ready = false; refreshSequence++;
      ui.connected(false);
      if (lastState) ui.apply({ ...lastState, audit: [] });
      document.getElementById('logout').hidden = !user;
      document.getElementById('importLocal').hidden = true;
      try {
        const sessionAuthorized = user ? (await api('op=session')).supervisor : false;
        if (authVersion !== authSequence) return;
        authorized = sessionAuthorized;
        ui.authorize(authorized && requestedAdmin);
        login.hidden = !requestedAdmin || authorized;
        document.getElementById('importLocal').hidden = !authorized;
        if (user && !authorized && requestedAdmin) document.getElementById('loginError').textContent = 'Esta conta não tem permissão de Supervisão.';
        await refresh();
        void realtime();
      } catch (error) { tell(error.message); }
    });
  } catch { tell('Não foi possível iniciar a conexão segura. Reservas locais preservadas.'); }
}
