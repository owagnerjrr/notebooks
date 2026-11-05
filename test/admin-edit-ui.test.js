import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
  const fields=new Map();const el=id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:''});return fields.get(id)};
  el('viewDate').value='2026-11-05';el('viewTime').value='13:00';el('reservations').innerHTML='<input value="rascunho em edição">';
  const record={id:'existing',teacher:'Docente',room:'206',classGroup:'Turma',date:'2026-11-05',start:'13:00',end:'17:30',numbers:[20]};
  const context=vm.createContext({el,db:{reservations:[record],blocked:[],audit:[]},editingReservationId:'existing',selected:new Set(),screen:'admin',pad:String,esc:String,dateBR:String,active:()=>true,auditDate:()=>'',formatAudit:String});
  const start=source.indexOf('function render(){'),end=source.indexOf("el('date').value=brasiliaNow().date",start);
  vm.runInContext(source.slice(start,end),context);
  return {context,el,render(){vm.runInContext('render()',context)}};
}
test('realtime/clock render preserves an open edit form and its unsaved values',()=>{
  const t=setup();t.render();t.render();assert.equal(t.el('reservations').innerHTML,'<input value="rascunho em edição">');assert.equal(t.context.editingReservationId,'existing');
});
test('a reservation cancelled elsewhere removes its stale editor',()=>{
  const t=setup();t.context.db.reservations=[];t.render();assert.equal(t.context.editingReservationId,null);assert.ok(t.el('reservations').innerHTML.includes('Nenhuma solicitação'));
});
