import { createHash } from 'node:crypto';
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new ApiError(status, message); };
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyMeta = () => ({ revision: 0, blocked: [] });
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Data inválida.');
  const parsed = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail(400, 'Data inválida.');
  return value;
}
export function daysBetween(first, last = first) {
  day(first); day(last);
  const count = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  if (count < 1 || count > 90) fail(400, 'Selecione um período de até 90 dias.');
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(first) + i * 86400000).toISOString().slice(0, 10));
}
export function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u001f]/.test(value)) fail(400, 'Texto inválido.');
  return value.trim();
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail(400, 'Identificador inválido.');
  return value;
}
export function numbers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 17 || value.some(n => !Number.isInteger(n) || n < 20 || n > 36) || new Set(value).size !== value.length) fail(400, 'Notebooks inválidos (20–36).');
  return [...value].sort((a, b) => a - b);
}
export function reservation(input, { historical = false, now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Reserva inválida.');
  const date = day(input.date);
  const validTime = v => typeof v === 'string' && /^(?:0[89]|1\d|2[01]):(?:00|30)$|^22:00$/.test(v);
  if (!validTime(input.start) || !validTime(input.end) || input.start >= input.end) fail(400, 'Horário inválido.');
  if (!historical && Date.parse(date + 'T' + input.start + ':00-03:00') <= +now) fail(400, 'O início deve estar no futuro.');
  return { teacher: text(input.teacher, 150), room: text(input.room, 60), classGroup: text(input.classGroup ?? '', 120, false), date, start: input.start, end: input.end, numbers: numbers(input.numbers) };
}
export function conflicts(a, b) {
  return a.date === b.date && a.start < b.end && b.start < a.end && a.numbers.some(n => b.numbers.includes(n));
}
export function assertAvailable(candidates, existing, blocked, ignoreId) {
  for (const r of candidates) {
    if (r.numbers.some(n => blocked.includes(n))) fail(409, 'Notebook bloqueado para manutenção.');
    if (existing.some(x => x.id !== ignoreId && !x.cancelled && conflicts(r, x))) fail(409, 'Outro agendamento ocupa os notebooks nesse período.');
  }
}
export function canSupervise(token, allowlist = '') {
  return Boolean(token?.uid && (token.supervisor === true || allowlist.split(',').map(x => x.trim()).filter(Boolean).includes(token.uid)));
}
export function publicReservation(r) {
  return { id: r.id, teacher: r.teacher, room: r.room, classGroup: r.classGroup, date: r.date, start: r.start, end: r.end, numbers: r.numbers, groupId: r.groupId ?? r.id };
}
