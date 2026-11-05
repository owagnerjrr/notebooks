import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identity, checkOrigin, openAdminSession, hasAdminSession } from '../server/security.js';
import { GET, POST } from '../api/notebooks.js';
process.env.ALLOWED_ORIGINS='https://notebooks-tau.vercel.app';
process.env.FIREBASE_APP_ID='expected';
const svc={ appCheck:{verifyToken:async t=>({appId:t})}, auth:{verifyIdToken:async(t,revoked)=>{assert.equal(revoked,true);if(t==='revoked')throw Error();return {uid:t}}} };
test('optional App Check binds tokens to the expected Firebase app; strict mode fails closed',async()=>{
  process.env.APP_CHECK_REQUIRED='true';
  await assert.rejects(identity(new Request('https://site/api'),svc),{status:401});
  await assert.rejects(identity(new Request('https://site/api',{headers:{'X-Firebase-AppCheck':'another-app'}}),svc),{status:401});
  assert.equal((await identity(new Request('https://site/api',{headers:{'X-Firebase-AppCheck':'expected'}}),svc)).supervisor,false);
  process.env.APP_CHECK_REQUIRED='false';
  assert.equal((await identity(new Request('https://site/api'),svc)).supervisor,false);
});
test('only the secret link authorizes admin; querystrings and fake bearer tokens do not',async()=>{
  const token='a'.repeat(64);
  process.env.ADMIN_LINK_HASH=createHash('sha256').update(token).digest('hex');
  process.env.ADMIN_SESSION_SECRET='b'.repeat(64);
  const cookie=openAdminSession(token,1000).split(';')[0];
  const request=new Request('https://site/api?painel=supervisao',{headers:{cookie}});
  assert.equal(hasAdminSession(request,1001),true);
  assert.equal(hasAdminSession(request,1000+8*3600000),false);
  assert.equal(hasAdminSession(new Request('https://site/api',{headers:{cookie:cookie+'tampered'}}),1001),false);
  assert.equal((await identity(new Request('https://site/api?painel=supervisao',{headers:{Authorization:'Bearer admin'}}),svc)).supervisor,false);
  assert.throws(()=>openAdminSession('c'.repeat(64)),{status:403});
  process.env.ADMIN_LINK_HASH=createHash('sha256').update('d'.repeat(64)).digest('hex');
  assert.equal(hasAdminSession(request,1001),false,'rotating link revokes existing sessions');
});
test('cross-origin and originless writes are rejected',()=>{
  for(const origin of ['', 'https://evil.example'])assert.throws(()=>checkOrigin(new Request('https://site/api',{method:'POST',headers:origin?{origin}:{}})),{status:403});
});
test('deployment without configuration refuses all backend reads/writes',async()=>{
  process.env.INTEGRATION_ENABLED='false';
  assert.equal((await GET(new Request('https://site/api'))).status,503);
  assert.equal((await POST(new Request('https://site/api',{method:'POST',headers:{origin:'https://notebooks-tau.vercel.app'}}))).status,503);
});
