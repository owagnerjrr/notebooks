import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function select(initial='') {
  let options=[],value=initial,html='';
  return {get value(){return value},set value(v){value=options.includes(v)?v:''},get innerHTML(){return html},set innerHTML(v){html=v;options=[...v.matchAll(/value="([^"]+)"/g)].map(m=>m[1]);value=options[0]||''},get values(){return options}};
}
function setup(date='2026-11-05',time='12:59') {
  const now={date:'2026-11-05',time};
  const fields={date:{value:date},endDate:{value:date},viewDate:{value:date},start:select(),end:select(),viewTime:select(),submitReservation:{disabled:false}};
  const context=vm.createContext({brasiliaNow:()=>now,el:id=>fields[id],screen:'doc',selected:new Set(),serverConnected:true,pad:n=>String(n).padStart(2,'0'),rangeFree:()=>[],updateSelection(){}});
  const begin=source.indexOf('function slots()'),end=source.indexOf('function save()',begin);
  vm.runInContext(source.slice(begin,end),context);
  return {now,fields,update(){vm.runInContext('updateSlots()',context)}};
}
test('today only offers starts in the future and advances automatically at 13:00',()=>{
  const t=setup();t.update();assert.equal(t.fields.start.value,'13:00');
  t.now.time='13:00';t.update();assert.equal(t.fields.start.value,'13:30');assert.ok(!t.fields.start.values.includes('13:00'));assert.equal(t.fields.end.value,'14:00');
});
test('future days keep all booking slots and valid user choices are retained',()=>{
  const t=setup('2026-11-06','13:00');t.update();assert.equal(t.fields.start.value,'08:00');t.fields.start.value='15:00';t.fields.end.value='17:30';t.update();assert.equal(t.fields.start.value,'15:00');assert.equal(t.fields.end.value,'17:30');
});
test('after the final start there are no booking slots; the map can still inspect earlier times',()=>{
  const t=setup('2026-11-05','21:30');t.update();assert.deepEqual(t.fields.start.values,[]);assert.equal(t.fields.end.value,'');assert.equal(t.fields.submitReservation.disabled,true);assert.ok(t.fields.viewTime.values.includes('08:00'));
});
test('midnight moves the booking date and end date to the new day together',()=>{
  const t=setup('2026-11-05','23:59');t.update();t.now.date='2026-11-06';t.now.time='00:00';t.update();assert.equal(t.fields.date.value,'2026-11-06');assert.equal(t.fields.endDate.value,'2026-11-06');assert.equal(t.fields.start.value,'08:00');
});
