import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, checkOrigin } from '../server/security.js';
import { GET, POST } from '../api/notebooks.js';
process.env.ALLOWED_ORIGINS='https://notebooks-tau.vercel.app';
process.env.FIREBASE_APP_ID='expected';
const svc={ appCheck:{verifyToken:async t=>({appId:t})}, auth:{verifyIdToken:async(t,revoked)=>{assert.equal(revoked,true);if(t==='revoked')throw Error();return {uid:t}}} };
test('App Check is mandatory and bound to the expected Firebase app',async()=>{
  await assert.rejects(identity(new Request('https://site/api'),svc),{status:401});
  await assert.rejects(identity(new Request('https://site/api',{headers:{'X-Firebase-AppCheck':'another-app'}}),svc),{status:401});
  assert.equal((await identity(new Request('https://site/api',{headers:{'X-Firebase-AppCheck':'expected'}}),svc)).supervisor,false);
});
test('revoked tokens and malformed authorization fail closed',async()=>{
  for(const token of ['Bearer revoked','bad'])await assert.rejects(identity(new Request('https://site/api',{headers:{'X-Firebase-AppCheck':'expected',Authorization:token}}),svc),{status:401});
});
test('cross-origin and originless writes are rejected',()=>{
  for(const origin of ['', 'https://evil.example'])assert.throws(()=>checkOrigin(new Request('https://site/api',{method:'POST',headers:origin?{origin}:{}})),{status:403});
});
test('deployment without configuration refuses all backend reads/writes',async()=>{
  process.env.INTEGRATION_ENABLED='false';
  assert.equal((await GET(new Request('https://site/api'))).status,503);
  assert.equal((await POST(new Request('https://site/api',{method:'POST',headers:{origin:'https://notebooks-tau.vercel.app'}}))).status,503);
});
