import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mutate, state } from '../../server/store.js';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only with FIRESTORE_EMULATOR_HOST and a demo project. Never run these tests against production.');
const projectId='demo-notebooks-tests';
test('deny-all rules for teachers and supervisors, including queries and subcollections',async()=>{
  const env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')}});
  try {
    for(const context of [env.unauthenticatedContext(),env.authenticatedContext('teacher'),env.authenticatedContext('supervisor',{supervisor:true})]){
      const db=context.firestore(),ref=doc(db,'notebookMeta/state');
      await assertFails(getDoc(ref));await assertFails(getDocs(collection(db,'notebookReservations')));
      await assertFails(setDoc(ref,{blocked:[],revision:1}));await assertFails(updateDoc(ref,{supervisor:true}));await assertFails(deleteDoc(ref));
      await assertFails(setDoc(doc(db,'notebookMeta/state/children/x'),{value:'x'}));
    }
  } finally { await env.cleanup(); }
});
test('simultaneous bookings, replay, imports, cancellation and supervisor boundaries',async()=>{
  const app=initializeApp({projectId},'tests'),db=getFirestore(app);
  try {
    const future=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const payload={teacher:'Hugo Oliveira De Faria',room:'206',classGroup:'Aprendizagem',date:future,start:'13:00',end:'17:30',numbers:[21,22,23,24,25]};
    const actor={supervisor:false,user:null},admin={supervisor:true,user:{uid:'approved'}};
    const attempts=await Promise.allSettled(['booking-a','booking-b'].map(requestId=>mutate(db,{action:'reserve',requestId,payload},actor)));
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
    const winner=attempts[0].status==='fulfilled'?'booking-a':'booking-b';
    const replay=await mutate(db,{action:'reserve',requestId:winner,payload},actor);
    assert.equal(replay.ids.length,1);
    for(const action of ['edit','cancel','block','clearAudit','import'])await assert.rejects(mutate(db,{action,requestId:'unauthorized',payload},actor),{status:403});
    await assert.rejects(mutate(db,{action:'reserve',requestId:winner,payload:{...payload,room:'999'}},actor),{status:409});
    const read=await state(db,future,future,false);assert.equal(read.reservations.length,1);assert.deepEqual(read.audit,[]);
    const duplicate=await mutate(db,{action:'import',requestId:'import-a',payload:{reservation:payload}},admin);assert.equal(duplicate.imported,false);
    await mutate(db,{action:'cancel',requestId:'cancel-a',payload:{id:replay.ids[0]}},admin);
    await mutate(db,{action:'import',requestId:'import-b',payload:{reservation:payload}},admin);
    assert.equal((await state(db,future,future,true)).reservations.length,0,'import must not resurrect cancellations');
    const historical={...payload,date:'2026-11-05',numbers:[26]};
    assert.equal((await mutate(db,{action:'import',requestId:'historical-a',payload:{reservation:historical}},admin)).imported,true);
    assert.equal((await mutate(db,{action:'import',requestId:'historical-b',payload:{reservation:historical}},admin)).imported,false);
    const past={...payload,date:'2020-11-05',numbers:[20]};
    await mutate(db,{action:'import',requestId:'past-import',payload:{reservation:past}},admin);
    const pastRecord=(await state(db,past.date,past.date,true)).reservations[0];
    await mutate(db,{action:'edit',requestId:'past-correction',payload:{...pastRecord,room:'207'}},admin);
    assert.equal((await state(db,past.date,past.date,true)).reservations[0].room,'207');
    await assert.rejects(mutate(db,{action:'edit',requestId:'past-reschedule',payload:{...pastRecord,start:'12:30'}},admin),{status:400});
  } finally { await deleteApp(app); }
});
