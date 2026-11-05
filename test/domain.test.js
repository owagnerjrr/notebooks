import test from 'node:test';
import assert from 'node:assert/strict';
import { reservation, daysBetween, canSupervise, assertAvailable, hash } from '../server/domain.js';
const hugo = { teacher: 'Hugo Oliveira De Faria', room: '206', classGroup: 'Aprendizagem', date: '2026-11-05', start: '13:00', end: '17:30', numbers: [21,22,23,24,25] };
test('preserves the Hugo reservation when importing historical data', () => {
  assert.deepEqual(reservation(hugo, { historical: true }), hugo);
  assert.equal(hash(reservation({ ...hugo, id: 'other-PC' }, { historical: true })), hash(reservation(hugo, { historical: true })));
});
test('server enforces rack, valid dates, slots, required fields and future start', () => {
  for (const change of [{ numbers: [19] }, { numbers: [37] }, { numbers: [21,21] }, { date: '2026-02-30' }, { start: '13:15' }, { end: '13:00' }, { teacher: '' }, { teacher: 'x'.repeat(151) }, { room: 42 }]) {
    assert.throws(() => reservation({ ...hugo, ...change }, { historical: true }));
  }
  assert.throws(() => reservation(hugo, { now: new Date('2026-11-05T16:00:00Z') }));
});
test('range is bounded and calendar-correct', () => {
  assert.deepEqual(daysBetween('2028-02-28','2028-03-01'), ['2028-02-28','2028-02-29','2028-03-01']);
  assert.throws(() => daysBetween('2026-01-01','2026-05-01'));
  assert.throws(() => daysBetween('2026-01-02','2026-01-01'));
});
test('conflicts cover overlap and maintenance, adjacent reservations can coexist', () => {
  const existing = [{ ...hugo, id: 'one' }];
  assert.throws(() => assertAvailable([{ ...hugo, start:'17:00', end:'18:00' }],existing,[]), { status:409 });
  assert.doesNotThrow(() => assertAvailable([{ ...hugo, start:'17:30', end:'18:00' }],existing,[]));
  assert.throws(() => assertAvailable([hugo],[],[21]), { status:409 });
  assert.doesNotThrow(() => assertAvailable([hugo],existing,[],'one'));
});
test('querystrings, emails and ordinary accounts cannot grant supervision', () => {
  for (const token of [null, { uid:'teacher' }, { uid:'teacher', painel:'supervisao' }, { uid:'teacher', supervisor:'true' }, { uid:'teacher', email:'admin@example.com' }]) assert.equal(canSupervise(token,'approved'),false);
  assert.equal(canSupervise({uid:'approved'},' approved, other '),true);
  assert.equal(canSupervise({uid:'admin',supervisor:true}),true);
});
