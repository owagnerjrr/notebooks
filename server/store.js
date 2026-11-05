import { randomUUID } from 'node:crypto';
import { fail, hash, id, day, daysBetween, reservation, assertAvailable, publicReservation, emptyMeta, numbers } from './domain.js';
const metaPath = 'notebookMeta/state';
const resCol = 'notebookReservations';
export { metaPath };
async function rowsForDays(tx, db, days) {
  // Core operations are intentional on Enterprise Native: this flow requires
  // transaction reads coordinated with the realtime revision listener.
  const rows = [];
  for (let offset = 0; offset < days.length; offset += 30) {
    const snap = await tx.get(db.collection(resCol).where('date', 'in', days.slice(offset, offset + 30)));
    snap.forEach(doc => rows.push({ ...doc.data(), id: doc.id }));
  }
  return rows;
}
export async function state(db, first, last, supervisor) {
  const days = daysBetween(first, last);
  return db.runTransaction(async tx => {
  const meta = (await tx.get(db.doc(metaPath))).data() || emptyMeta();
  const rows = await rowsForDays(tx, db, days);
  const audit = [];
  if (supervisor) {
    for (let i = 0; i < days.length; i += 30) {
      const snap = await tx.get(db.collection('notebookAudit').where('day', 'in', days.slice(i, i + 30)));
      snap.forEach(doc => { if (!doc.data().hidden) audit.push(doc.data()); });
    }
  }
  return { reservations: rows.filter(r => !r.cancelled).map(publicReservation), blocked: meta.blocked, audit, revision: meta.revision };
  }, { readOnly: true });
}
export async function mutate(db, body, actor) {
  const action = body.action;
  if (!['reserve', 'edit', 'cancel', 'block', 'clearAudit', 'import'].includes(action)) fail(400, 'Operação inválida.');
  if (action !== 'reserve' && !actor.supervisor) fail(403, 'Acesso exclusivo da Supervisão.');
  const requestId = id(body.requestId), requestRef = db.collection('notebookRequests').doc(requestId);
  const fingerprint = hash({ action, payload: body.payload, actor: actor.user?.uid || 'docente' });
  const now = new Date(), eventId = randomUUID();
  return db.runTransaction(async tx => {
    // All mutations read/write the same revision. Even two empty conflict
    // queries serialize; reservation/block/cancel/import races cannot slip by.
    const [metaSnap, previous] = await Promise.all([tx.get(db.doc(metaPath)), tx.get(requestRef)]);
    if (previous.exists) {
      if (previous.data().fingerprint !== fingerprint) fail(409, 'Identificador de solicitação já utilizado.');
      return previous.data().result;
    }
    const meta = metaSnap.data() || emptyMeta(), p = body.payload || {};
    let writes = [], detail = '', result = {}, extraWrites = [];
    if (action === 'reserve') {
      const dates = daysBetween(p.date, p.endDate || p.date);
      const entries = dates.map(date => ({ ...reservation({ ...p, date }), id: `${requestId}-${date}`, groupId: requestId }));
      const existing = await rowsForDays(tx, db, dates);
      assertAvailable(entries, existing, meta.blocked);
      writes = entries;
      detail = `${entries[0].teacher} · Sala ${entries[0].room} · ${p.date} até ${dates.at(-1)} · ${p.start}–${p.end} · ${entries[0].numbers.join(', ')}`;
      result = { ids: entries.map(r => r.id), numbers: entries[0].numbers };
    } else if (action === 'edit' || action === 'cancel') {
      const ref = db.collection(resCol).doc(id(p.id)), snap = await tx.get(ref);
      if (!snap.exists || snap.data().cancelled) fail(404, 'Reserva não encontrada.');
      const before = { ...snap.data(), id: snap.id };
      if (action === 'cancel') {
        writes = [{ ...before, cancelled: true }]; detail = JSON.stringify(publicReservation(before));
      } else {
        // Supervisors may correct an existing/ongoing booking without changing
        // its original start. Rescheduling still requires a future start.
        const after = { ...before, ...reservation(p, { historical: p.date === before.date && p.start === before.start }) };
        const existing = await rowsForDays(tx, db, [after.date]);
        assertAvailable([after], existing, meta.blocked, before.id);
        writes = [after]; detail = JSON.stringify(publicReservation(before)) + ' → ' + JSON.stringify(publicReservation(after));
      }
    } else if (action === 'block') {
      const n = numbers([p.number])[0];
      if (typeof p.blocked !== 'boolean') fail(400, 'Estado de manutenção inválido.');
      meta.blocked = p.blocked ? [...new Set([...meta.blocked, n])].sort((a,b)=>a-b) : meta.blocked.filter(x => x !== n);
      detail = `Notebook ${n}: ${p.blocked ? 'bloqueado' : 'desbloqueado'}`;
    } else if (action === 'clearAudit') {
      const date = day(p.date), snap = await tx.get(db.collection('notebookAudit').where('day', '==', date));
      if (snap.size > 350) fail(409, 'Histórico grande: solicite arquivamento assistido.');
      snap.forEach(doc => extraWrites.push([doc.ref, { hidden: true, hiddenBy: actor.user.uid, hiddenAt: now.toISOString() }]));
      detail = `Histórico de ${date} arquivado, preservado no servidor.`;
    } else if (action === 'import') {
      // One confirmed legacy reservation per transaction: stable hash and durable
      // tombstone prevent resurrecting cancellations or duplicating other PCs.
      const legacy = reservation(p.reservation, { historical: true });
      const importHash = hash(legacy), receipt = db.collection('notebookImports').doc(importHash);
      const imported = await tx.get(receipt);
      if (imported.exists) result = { imported: false, reason: 'already-imported' };
      else {
        const existing = await rowsForDays(tx, db, [legacy.date]);
        const identical = existing.find(r => hash(reservation(r, { historical: true })) === importHash);
        if (identical) {
          extraWrites.push([receipt, { id: identical.id, importedBy: actor.user.uid, at: now.toISOString() }]);
          result = { imported: false, reason: 'already-present' };
        } else {
          assertAvailable([legacy], existing, meta.blocked);
          const legacyId = 'legacy-' + importHash;
          writes = [{ ...legacy, id: legacyId, groupId: legacyId, legacy: true }];
          extraWrites.push([receipt, { id: legacyId, importedBy: actor.user.uid, at: now.toISOString() }]);
          result = { imported: true };
        }
      }
      detail = `Importação local: ${legacy.teacher} · ${legacy.date} · ${result.imported ? 'adicionada' : 'já registrada'}`;
    }
    // All reads above, all writes below. No side effects outside the transaction.
    for (const row of writes) tx.set(db.collection(resCol).doc(row.id), { ...row, updatedAt: now.toISOString() });
    for (const [ref, value] of extraWrites) tx.set(ref, value, { merge: true });
    const labels = { reserve: 'Solicitação', edit: 'Edição', cancel: 'Cancelamento', block: 'Manutenção', clearAudit: 'Arquivamento', import: 'Importação' };
    const time = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const d = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    tx.create(db.collection('notebookAudit').doc(eventId), { action: labels[action], detail, time, day: `${d.year}-${d.month}-${d.day}`, actorUid: actor.user?.uid || null });
    tx.set(db.doc(metaPath), { ...meta, revision: meta.revision + 1 });
    tx.create(requestRef, { fingerprint, result, at: now.toISOString() });
    return result;
  });
}
