import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function run(name, selected=[], available=Array.from({length:17},(_,i)=>i+20)) {
  const start=source.indexOf('function '+name+'()');
  const end=source.indexOf('function ',start+9);
  const fields=Object.fromEntries(Object.entries({teacher:'Docente',room:'206',classGroup:'Teste',date:'2099-11-05',start:'13:00',end:'17:30',qty:'5',feedback:''}).map(([k,value])=>[k,{value}]));
  let payload;
  const context=vm.createContext({selected:new Set(selected),el:id=>fields[id],rangeDays:()=>['2099-11-05'],brasiliaNow:()=>({date:'2026-11-05',time:'11:00'}),rangeFree:()=>available,alert:message=>{throw Error(message)},updateSelection(){},render(){},pad:String,transport:async(action,value)=>{payload=value}});
  vm.runInContext(source.slice(start,end),context);
  vm.runInContext(name+'()',context);
  return {numbers:payload?Array.from(payload.numbers):[...context.selected],fields};
}
test('quick selection starts at notebook 20 when 20–24 are free',()=>{
  assert.deepEqual(run('pickRandom').numbers,[20,21,22,23,24]);
});
test('quantity completion at submission uses 20–24, including notebook 20',()=>{
  assert.deepEqual(run('reserve').numbers,[20,21,22,23,24]);
});
test('manual selection 20–24 is submitted unchanged',()=>{
  assert.deepEqual(run('reserve',[20,21,22,23,24]).numbers,[20,21,22,23,24]);
});
test('partial manual selection keeps notebook 20 when completing the quantity',()=>{
  assert.deepEqual(run('reserve',[20]).numbers,[20,21,22,23,24]);
});
test('unavailable notebook 20 is still excluded from automatic selection',()=>{
  assert.deepEqual(run('pickRandom',[],Array.from({length:16},(_,i)=>i+21)).numbers,[21,22,23,24,25]);
});
