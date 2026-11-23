import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { account, session, user } from '../src/index.ts';
import { authContexts, authFactors, authProofs } from '../src/auth-factor-schema.ts';
import { backupCodes, bearerHash, factorKeys, randomBearer, totpCode, totpSecret } from '../src/auth-factor-crypto.ts';
import { factorStore } from '../src/auth-factor-store.ts';
import { hashPassword } from '../src/admin.ts';
import { ensureAuthRole, ensureHubRole } from '../src/roles.ts';
import { nativeFactors } from './auth-factor-native-fixture.ts';
import { factorController } from '../../../apps/hub/src/lib/auth-factor-core.ts';
import { createHubAuth } from '../../../apps/hub/src/lib/auth-core.ts';
import { cookies } from './auth-race-fixtures.ts';

const bin=process.env.GF_TEST_PG_BIN, options={skip:!bin && 'нужен собственный native PostgreSQL; PGlite не заменяет два backend',timeout:20000};
let native:Awaited<ReturnType<typeof nativeFactors>>;
let passwordHash:string;
const password='Synthetic B strong password',keys=factorKeys([Buffer.alloc(32,17)]);
before(async()=>{if(bin){native=await nativeFactors(bin);passwordHash=await hashPassword(password);}});
after(async()=>{if(native)await native.close();});
async function fixture() {
  const id=randomUUID(),factorId=randomUUID(),secret=totpSecret();
  await native.db.insert(user).values({id,name:id,email:id+'@example.test',role:'owner'});
  await native.db.insert(account).values({id,userId:id,accountId:id,providerId:'credential',password:passwordHash});
  await native.db.insert(authFactors).values({id:factorId,userId:id,kind:'totp',state:'active',...keys.seal(secret,id,factorId),createdAt:new Date()});
  return {id,factorId,secret,email:id+'@example.test'};
}
async function issue(f:Awaited<ReturnType<typeof fixture>>) {
  const control=factorController(factorStore(native.authDb),keys),result=await control.password(f.email,password,f.id);
  assert.equal(result?.kind,'totp');if(result?.kind!=='totp')throw new Error('не выпущен pre-auth');
  return {control,cookie:result.cookie};
}

test('B native: настоящий gf_hub не имеет DML/EXECUTE/SET ROLE даже после повторной выдачи',options,async()=>{
  assert.equal((await native.hub`select current_user as role`)[0]?.role,'gf_hub');
  for(let i=0;i<2;i++) {
    await ensureHubRole(native.db,'synthetic-hub-password');await ensureAuthRole(native.db,'synthetic-auth-password');
    for(const statement of [
      'set role gf_auth','select * from auth_private.proofs','insert into auth_private.proofs default values',
      'delete from auth_private.factors',`select gf_b_reserve('${'a'.repeat(64)}','${'b'.repeat(64)}','${'c'.repeat(64)}')`,
      `select gf_b_operator_enrol('victim','${passwordHash}','${'a'.repeat(64)}','synthetic')`,
    ])await assert.rejects(native.hub.unsafe(statement),statement);
    await assert.rejects(native.auth`select * from auth_private.proofs`);
  }
});

test('B native: committed-допуск виден второму backend до verifier; шестой правильный код отвергнут',options,async()=>{
  const f=await fixture(),{cookie}=await issue(f),store=factorStore(native.authDb);
  let entered=0,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  const barrierStore={...store,reserve:async(...args:Parameters<typeof store.reserve>)=>{
    const result=await store.reserve(...args);
    if(result){entered++;await waiting;}return result;
  }};
  const control=factorController(barrierStore,keys),step=Math.floor(Date.now()/30000);
  const wrong=totpCode(f.secret,step)==='000000'?'999999':'000000';
  const pending=Array.from({length:5},()=>control.totp(cookie,wrong,f.id));
  try {
    const deadline=Date.now()+5000;
    while(entered<5 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(entered,5);
    const committed=await native.second<{count:number}[]>`select count(*)::int as count from auth_private.reservations where context_hash=${bearerHash(cookie)}`;
    assert.equal(committed[0]?.count,5);
    assert.equal(await factorController(store,keys).totp(cookie,totpCode(f.secret,step),f.id),null);
  } finally {release();await Promise.all(pending);}
  const good=await fixture(),issued=await issue(good);
  assert.ok(await issued.control.totp(issued.cookie,totpCode(good.secret,Math.floor(Date.now()/30000)),good.id));
});

test('B native: два backend одновременно потребляют TOTP/context — ровно одна session/proof',options,async()=>{
  const f=await fixture(),issued=await issue(f),other=factorController(factorStore(native.other),keys);
  const code=totpCode(f.secret,Math.floor(Date.now()/30000));
  const results=await Promise.all([issued.control.totp(issued.cookie,code,f.id),other.totp(issued.cookie,code,f.id)]);
  assert.equal(results.filter(Boolean).length,1);
  const rows=await native.first<{count:number}[]>`select count(*)::int as count from auth_private.proofs where user_id=${f.id}`;
  assert.equal(rows[0]?.count,1);
});

test('B native: оригинальная подписанная cookie attacker не переназначается на owner proof',options,async()=>{
  const f=await fixture(),issued=await issue(f),owner=await issued.control.totp(issued.cookie,totpCode(f.secret,Math.floor(Date.now()/30000)),f.id);
  assert.ok(owner);
  const id=randomUUID();await native.db.insert(user).values({id,name:id,email:id+'@example.test'});
  await native.db.insert(account).values({id,userId:id,accountId:id,providerId:'credential',password:passwordHash});
  const auth=createHubAuth(native.hubDb,'https://hub.example','synthetic B cookie signing secret at least 32 chars');
  const response=await auth.handler(new Request('https://hub.example/api/auth/sign-in/email',{method:'POST',
    headers:{origin:'https://hub.example','content-type':'application/json'},body:JSON.stringify({email:id+'@example.test',password})}));
  assert.equal(response.status,200);const cookie=cookies(response);assert.match(cookie,/__Host-gf-session=/);
  const self=await auth.api.getSession({headers:new Headers({cookie})});assert.ok(self);
  const originalToken=self.session.token;
  for(let i=0;i<2;i++) {
    await ensureHubRole(native.db,'synthetic-hub-password');
    await native.hub`delete from public.session where id=${self.session.id}`;
    await assert.rejects(native.hub`update public.session set token=${originalToken} where id=${owner.id}`);
    assert.equal(await auth.api.getSession({headers:new Headers({cookie})}),null);
    await native.hub`update public.session set expires_at=now()+interval '1 hour',updated_at=now() where id=${owner.id}`;
    assert.ok(await factorStore(native.authDb).access(owner.id,owner.token));
    assert.equal(await factorStore(native.authDb).access(owner.id,originalToken),null);
  }
});

test('B native: отзыв между crypto и финальной записью не обновляет исходный снимок',options,async()=>{
  const f=await fixture(),issued=await issue(f),store=factorStore(native.authDb);
  const original=store.totpLogin;
  const control=factorController({...store,totpLogin:async(...args)=>{
    await native.other.update(user).set({securityGeneration:1}).where(eq(user.id,f.id));return original(...args);
  }},keys);
  assert.equal(await control.totp(issued.cookie,totpCode(f.secret,Math.floor(Date.now()/30000)),f.id),null);
  assert.equal((await native.db.select().from(session).where(eq(session.userId,f.id))).length,0);
});

test('B native: два разных backup-кода одного набора дают максимум один enrolment',options,async()=>{
  const f=await fixture(),codes=backupCodes(f.id),store=factorStore(native.authDb),secondStore=factorStore(native.other);
  for(const hash of codes.hashes)await native.first`insert into auth_private.backup_codes(code_hash,user_id,set_id,created_at) values(${hash},${f.id},'synthetic',now())`;
  const a=factorController(store,keys),b=factorController(secondStore,keys),ca=await a.backupContext('same-source'),cb=await b.backupContext('same-source');
  assert.ok(ca&&cb);
  const results=await Promise.all([a.recover(ca,f.email,codes.codes[0]!,'same-source'),b.recover(cb,f.email,codes.codes[1]!,'same-source')]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal((await native.db.select().from(session).where(eq(session.userId,f.id))).length,0);
  const contexts=await native.db.select().from(authContexts).where(eq(authContexts.userId,f.id));
  assert.equal(contexts.filter(c=>c.purpose==='enrol-cookie'&&c.state==='active').length,1);
  assert.equal((await native.db.select().from(authFactors).where(eq(authFactors.userId,f.id))).length,0);
  assert.equal((await native.db.select().from(authProofs).where(eq(authProofs.userId,f.id))).length,0);
});
