// PGlite проверяет SQL-переходы и ACL, но не заменяет два независимых backend.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { schema, user, account, session, passkey } from '../src/index.ts';
import { authFactors, authProofs, authContexts, authReservations, authFactorCounters } from '../src/auth-factor-schema.ts';
import { backupCodes, backupHash, bearerHash, factorKeys, randomBearer, totpSecret } from '../src/auth-factor-crypto.ts';
import { factorStore } from '../src/auth-factor-store.ts';
import { ensureAuthRole, ensureHubRole } from '../src/roles.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';

const pg=new PGlite(), db=drizzle(pg,{schema});
before(async()=>{await migrate(db,{migrationsFolder:MIGRATIONS_DIR});});
after(()=>pg.close());
async function fixture(role='owner') {
  const id=randomUUID(), bearer=randomBearer(), factorId=randomUUID();
  const encrypted=factorKeys([Buffer.alloc(32,7)]).seal(totpSecret(),id,factorId);
  await db.insert(user).values({id,email:id+'@example.test',name:id,role});
  await db.insert(account).values({id,accountId:id,providerId:'credential',userId:id,password:'synthetic-password-hash'});
  await db.insert(authFactors).values({id:factorId,userId:id,kind:'totp',state:'active',...encrypted,createdAt:new Date()});
  const sid=randomUUID();
  await db.insert(session).values({id:sid,token:bearer,userId:id,expiresAt:new Date(Date.now()+60_000)});
  return {id,bearer,sid,factorId,encrypted};
}
/** Прежний ключ пользователя: восстановление должно отозвать его только при завершении. */
async function oldKey(userId:string) {
  const id=randomUUID();
  await db.insert(passkey).values({id,userId,publicKey:'synthetic-old-key',credentialID:randomBearer(),counter:0,deviceType:'singleDevice',backedUp:false});
  return id;
}
async function context(f:Awaited<ReturnType<typeof fixture>>,purpose='login') {
  const hash=bearerHash(randomBearer());
  const result=await pg.query<{ok:boolean}>(`select public.gf_b_password_context($1,0,$1,$2,$3,$4,$5,$6,$7) as ok`,
    [f.id,'synthetic-password-hash',hash,purpose,f.sid,f.bearer,bearerHash('source:'+f.id)]);
  assert.equal(result.rows[0]?.ok,true);return hash;
}
async function reserve(hash:string,source=bearerHash('synthetic-source')) {
  const id=bearerHash(randomBearer());
  const r=await pg.query<{result:unknown}>(`select public.gf_b_reserve($1,$2,$3) as result`,[hash,source,id]);
  return {id,result:r.rows[0]?.result};
}
async function login(f:Awaited<ReturnType<typeof fixture>>,hash:string,attempt:string,step=Math.floor(Date.now()/30_000)) {
  const token=randomBearer(), id=randomUUID();
  const r=await pg.query<{result:{id:string;token:string}|null}>(`select public.gf_b_totp_login($1,$2,$3,$4,$5,$6,$7,$8) as result`,
    [hash,attempt,f.factorId,f.encrypted.ciphertext,step,id,token,randomUUID()]);
  return r.rows[0]?.result;
}

test('B: миграция повторяема, закрытая схема и роли без прямого доступа',async()=>{
  await migrate(db,{migrationsFolder:MIGRATIONS_DIR});
  await ensureHubRole(db,'synthetic-hub-password');await ensureAuthRole(db,'synthetic-auth-password');
  for(const role of ['gf_hub','gf_auth']) {
    await pg.exec('set role '+role);
    try {
      for(const table of ['factors','proofs','contexts','reservations','counters','backup_codes']) {
        await assert.rejects(pg.exec(`select * from auth_private.${table}`));
        await assert.rejects(pg.exec(`delete from auth_private.${table}`));
        await assert.rejects(pg.exec(`insert into auth_private.${table} default values`));
      }
      await assert.rejects(pg.exec('create table auth_private.synthetic(id int)'));
    } finally {await pg.exec('reset role');}
  }
  await pg.exec('set role gf_hub');
  try {
    await assert.rejects(pg.exec(`select public.gf_b_reserve('${'a'.repeat(64)}','${'b'.repeat(64)}','${'c'.repeat(64)}')`));
    // SET ROLE из superuser-сессии не доказывает полномочия отдельного LOGIN.
    assert.equal((await pg.query<{member:boolean}>("select pg_has_role('gf_hub','gf_auth','MEMBER') as member")).rows[0]?.member,false);
  } finally {await pg.exec('reset role');}
});

test('B: proof требует исходный bearer, refresh сохраняет proof; DELETE/INSERT и UPSERT его не восстанавливают',async()=>{
  const f=await fixture(), hash=await context(f), attempt=await reserve(hash), result=await login(f,hash,attempt.id);
  assert.ok(result);
  async function access(token:string) {
    return (await pg.query<{value:unknown}>('select gf_b_session_access($1,$2) as value',[result!.id,token])).rows[0]?.value;
  }
  assert.ok(await access(result.token));assert.equal(await access(randomBearer()),null);
  for(let repeat=0;repeat<2;repeat++) {
    await ensureHubRole(db,'synthetic-hub-password');
    await pg.exec('set role gf_hub');
    try {
      for(const field of ['token','id','user_id','security_generation','created_at']) {
        const literal=field==='security_generation'?'99':field==='created_at'?"now() - interval '1 day'":"'synthetic-other'";
        await assert.rejects(pg.query(`update public.session set ${field}=${literal} where id=$1`,[result.id]));
      }
      await pg.query('update public.session set expires_at=now()+interval \'1 hour\',updated_at=now() where id=$1',[result.id]);
      assert.ok(await access(result.token));
    } finally {await pg.exec('reset role');}
  }
  const original=(await db.select().from(session).where(eq(session.id,result.id)))[0]!;
  await pg.exec('set role gf_hub');
  try {
    await db.delete(session).where(eq(session.id,result.id));
    await db.insert(session).values(original);
    assert.equal(await access(result.token),null);
    await assert.rejects(db.insert(session).values({...original,token:randomBearer()}).onConflictDoUpdate({target:session.id,set:{token:randomBearer()}}));
  } finally {await pg.exec('reset role');}
  assert.equal((await db.select().from(authProofs).where(eq(authProofs.sessionId,result.id))).length,0);
});

test('B: резервация committed до verifier, пять попыток, replay/crash не возвращают квоту',async()=>{
  const f=await fixture(), hash=await context(f);
  const attempts=await Promise.all(Array.from({length:8},()=>reserve(hash,bearerHash(f.id))));
  assert.equal(attempts.filter(a=>a.result).length,5);
  assert.equal((await db.select().from(authContexts).where(eq(authContexts.tokenHash,hash)))[0]?.attempts,5);
  assert.equal((await db.select().from(authReservations).where(eq(authReservations.contextHash,hash))).length,5);
  assert.equal((await reserve(hash,bearerHash(f.id))).result,null);
  // Другая обёртка после потери ответа использует ту же БД, без возврата попыток.
  assert.equal((await reserve(hash,bearerHash(f.id))).result,null);
  const accepted=attempts.find(a=>a.result)!;
  const result=await login(f,hash,accepted.id);assert.ok(result);
  assert.equal(await login(f,hash,accepted.id),null);
});

test('B: CAS credential/generation/factor/step и одноразовость TOTP, положительный вход',async()=>{
  for(const mode of ['password','generation','factor','expiry','attempt','step','ok']) {
    const f=await fixture(), hash=await context(f), attempt=await reserve(hash,bearerHash(f.id));
    if(mode==='password')await db.update(account).set({password:'changed'}).where(eq(account.id,f.id));
    if(mode==='generation')await db.update(user).set({securityGeneration:1}).where(eq(user.id,f.id));
    if(mode==='factor')await db.update(authFactors).set({ciphertext:'changed'}).where(eq(authFactors.id,f.factorId));
    if(mode==='expiry')await db.update(authContexts).set({expiresAt:new Date(0)}).where(eq(authContexts.tokenHash,hash));
    const result=await login(f,hash,mode==='attempt'?bearerHash(randomBearer()):attempt.id,
      Math.floor(Date.now()/30_000)+(mode==='step'?5:0));
    if(mode==='ok')assert.ok(result);else assert.equal(result,null,mode);
  }
  const f=await fixture(), hash=await context(f), attempt=await reserve(hash,bearerHash(f.id));
  assert.ok(await login(f,hash,attempt.id));
  const secondHash=await context(f), secondAttempt=await reserve(secondHash,bearerHash(f.id));
  assert.equal(await login(f,secondHash,secondAttempt.id),null,'тот же TOTP-step не принимается снова');
});

test('B: reauth заменяет только исходную сессию, proof свежести не меняется при refresh',async()=>{
  const f=await fixture();
  await db.insert(authProofs).values({sessionId:f.sid,userId:f.id,generation:0,bearerHash:bearerHash(f.bearer),issuanceId:randomUUID(),
    method:'totp',factorId:f.factorId,verifiedAt:new Date(Date.now()-60_000)});
  const hash=await context(f,'reauth'), attempt=await reserve(hash,bearerHash(f.id));
  const result=await login(f,hash,attempt.id);assert.ok(result);
  assert.equal((await db.select().from(session).where(eq(session.id,f.sid))).length,0);
  const proof=(await db.select().from(authProofs).where(eq(authProofs.sessionId,result.id)))[0]!;
  await db.update(session).set({expiresAt:new Date(Date.now()+100_000),updatedAt:new Date()}).where(eq(session.id,result.id));
  assert.deepEqual((await db.select().from(authProofs).where(eq(authProofs.sessionId,result.id)))[0],proof);
});

test('B: анонимные backup-квоты не расходуют домен MFA и не получают userId по заявлению',async()=>{
  const source=bearerHash('same-nat');
  for(let i=0;i<5;i++) {
    const hash=bearerHash(randomBearer());
    await db.insert(authContexts).values({tokenHash:hash,purpose:'backup',createdAt:new Date(),expiresAt:new Date(Date.now()+60_000)});
    for(let j=0;j<5;j++)assert.equal(Boolean((await reserve(hash,source)).result),i<4);
  }
  const counters=await db.select().from(authFactorCounters).where(eq(authFactorCounters.domain,'backup'));
  assert.equal(counters.some(c=>c.key.includes(':target:')),false);
  const f=await fixture(), hash=await context(f);
  const attempt=await reserve(hash,source);assert.ok(attempt.result);assert.ok(await login(f,hash,attempt.id));
});

test('B: отказ при финальной записи откатывает step/context/session/proof, committed резервация остаётся',async()=>{
  const f=await fixture(), hash=await context(f), attempt=await reserve(hash,bearerHash(f.id));
  await pg.exec(`create function public.gf_test_b_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic'; end $$;
    create trigger gf_test_b_fail before insert on auth_private.proofs for each row execute function public.gf_test_b_fail();`);
  try {await assert.rejects(login(f,hash,attempt.id));}
  finally {await pg.exec('drop trigger gf_test_b_fail on auth_private.proofs; drop function public.gf_test_b_fail();');}
  assert.equal((await db.select().from(authFactors).where(eq(authFactors.id,f.factorId)))[0]?.lastStep,-1);
  assert.equal((await db.select().from(authContexts).where(eq(authContexts.tokenHash,hash)))[0]?.state,'active');
  assert.equal((await db.select().from(authContexts).where(eq(authContexts.tokenHash,hash)))[0]?.attempts,1);
  assert.ok(await login(f,hash,attempt.id));
});

test('B: операторский enrolment одноразовый; pending/active TOTP, backup только hash, повтор не показывает набор',async()=>{
  const f=await fixture(), store=factorStore(db), initial=randomBearer(), cookie=randomBearer();
  const passwordHash='a'.repeat(32)+':'+ 'b'.repeat(128);
  await ensureAuthRole(db,'synthetic-auth-password');
  await pg.exec('set role gf_auth');
  try {await assert.rejects(pg.query('select gf_b_operator_enrol($1,$2,$3,$4)',[f.id,passwordHash,bearerHash(initial),'synthetic']));}
  finally {await pg.exec('reset role');}
  assert.equal((await pg.query<{ok:boolean}>('select gf_b_operator_enrol($1,$2,$3,$4) as ok',
    [f.id,passwordHash,bearerHash(initial),'Синтетическая проверка восстановления'])).rows[0]?.ok,true);
  await pg.exec('set role gf_auth');
  try {
    assert.equal(await store.exchange(bearerHash(initial),bearerHash(cookie)),true);
    assert.equal(await store.exchange(bearerHash(initial),bearerHash(randomBearer())),false);
    const pendingId=randomUUID(),secret=totpSecret(), keys=factorKeys([Buffer.alloc(32,8)]);
    const encrypted=keys.seal(secret,f.id,pendingId);
    assert.equal(await store.pending(bearerHash(cookie),pendingId,encrypted),true);
    assert.equal(await store.pending(bearerHash(cookie),randomUUID(),encrypted),false,'секрет не показывается повторно');
    const snapshot=await store.snapshot(null,bearerHash(cookie));assert.ok(snapshot?.factor);
    assert.equal(snapshot.factor.id,pendingId);assert.equal(snapshot.factor.state,'pending');
    assert.equal(JSON.stringify(snapshot).includes(secret),false);
    const codes=backupCodes(f.id), attempt=bearerHash(randomBearer());
    assert.ok(await store.reserve(bearerHash(cookie),bearerHash(f.id),attempt));
    assert.equal(await store.complete(bearerHash(cookie),attempt,snapshot.factor,Math.floor(Date.now()/30_000),codes.hashes,randomUUID(),null),true);
    assert.equal(await store.complete(bearerHash(cookie),attempt,snapshot.factor,Math.floor(Date.now()/30_000),codes.hashes,randomUUID(),null),false);
    assert.equal(await store.snapshot(null,bearerHash(cookie)),null);
  } finally {await pg.exec('reset role');}
  const rows=await pg.query<{code_hash:string}>('select code_hash from auth_private.backup_codes where user_id=$1',[f.id]);
  assert.equal(rows.rows.length,10);for(const row of rows.rows)assert.match(row.code_hash,/^[a-f0-9]{64}$/);
  assert.equal((await db.select().from(session).where(eq(session.userId,f.id))).length,0);
});

test('B: backup ничего не сжигает до конца enrolment; брошенное восстановление не запирает, завершённое отзывает прежнее',async()=>{
  const f=await fixture(), store=factorStore(db), codes=backupCodes(f.id), source=bearerHash(f.id);
  for(const code of codes.hashes) await pg.query('insert into auth_private.backup_codes values($1,$2,$3,now())',[code,f.id,'synthetic-set']);
  const asAuth=async<T>(fn:()=>Promise<T>)=>{await pg.exec('set role gf_auth');try{return await fn();}finally{await pg.exec('reset role');}};
  // То, чем владелец входит: должно пережить любое незавершённое восстановление.
  const state=async()=>({
    password:(await db.select().from(account).where(eq(account.userId,f.id)))[0]?.password,
    factors:(await db.select().from(authFactors).where(eq(authFactors.userId,f.id))).filter(x=>x.state==='active').map(x=>x.id),
    codes:(await pg.query('select 1 from auth_private.backup_codes where user_id=$1',[f.id])).rows.length,
    sessions:(await db.select().from(session).where(eq(session.userId,f.id))).length,
    passkeys:(await db.select().from(passkey).where(eq(passkey.userId,f.id))).length,
  });
  await oldKey(f.id);
  const recover=(code:string)=>asAuth(async()=>{
    const anonymous=randomBearer(),enrol=randomBearer(),cookie=randomBearer();
    assert.equal(await store.backupContext(bearerHash(anonymous),source),true);
    const attempt=bearerHash(randomBearer());assert.ok(await store.reserve(bearerHash(anonymous),source,attempt));
    if(!await store.recover(bearerHash(anonymous),attempt,f.id,code,bearerHash(enrol)))return null;
    return await store.exchange(bearerHash(enrol),bearerHash(cookie))?cookie:null;
  });
  const before=await state();
  assert.deepEqual(before,{password:'synthetic-password-hash',factors:[f.factorId],codes:10,sessions:1,passkeys:1});
  assert.equal(await recover(backupHash(f.id,randomBearer())),null);
  const abandoned=await recover(codes.hashes[0]!);assert.ok(abandoned);
  assert.deepEqual(await state(),before,'брошенное восстановление ничего не отняло');
  const cookie=await recover(codes.hashes[1]!);assert.ok(cookie);
  assert.equal(await store.snapshot(null,bearerHash(abandoned)),null,'новое восстановление гасит незавершённое прежнее');
  const id=randomUUID(),encrypted=factorKeys([Buffer.alloc(32,9)]).seal(totpSecret(),f.id,id),newHash='e'.repeat(32)+':'+'f'.repeat(128);
  await asAuth(async()=>{
    assert.equal(await store.pending(bearerHash(cookie),id,encrypted),true);
    const next=await store.snapshot(null,bearerHash(cookie));assert.ok(next?.factor);
    const attempt=bearerHash(randomBearer());assert.ok(await store.reserve(bearerHash(cookie),source,attempt));
    const step=Math.floor(Date.now()/30_000),fresh=backupCodes(f.id).hashes;
    assert.equal(await store.complete(bearerHash(cookie),attempt,next.factor,step,fresh,randomUUID(),null),false,
      'восстановление без нового пароля не завершается: прежний мог утечь');
    await pg.exec('reset role');assert.deepEqual(await state(),before);await pg.exec('set role gf_auth');
    assert.equal(await store.complete(bearerHash(cookie),attempt,next.factor,step,fresh,randomUUID(),newHash),true);
  });
  const after=await state();
  assert.deepEqual(after,{password:newHash,factors:[id],codes:10,sessions:0,passkeys:0},'завершение: новый пароль, фактор и набор, прежние отозваны');
  assert.equal((await pg.query('select 1 from auth_private.backup_codes where code_hash=$1',[codes.hashes[2]!])).rows.length,0);
});

test('B: SQL-переход UV требует одноразовый контекст, fingerprint и текущее поколение',async()=>{
  // Это контракт доверенного SQL-канала, не испытание WebAuthn verifier.
  const f=await fixture(),store=factorStore(db),initial=randomBearer(),cookie=randomBearer();
  assert.equal((await pg.query<{ok:boolean}>('select gf_b_operator_enrol($1,$2,$3,$4) as ok',
    [f.id,'a'.repeat(32)+':'+ 'b'.repeat(128),bearerHash(initial),'Синтетическая настройка UV'])).rows[0]?.ok,true);
  assert.equal(await store.exchange(bearerHash(initial),bearerHash(cookie)),true);
  const id=randomUUID(),credential=randomBearer();
  const key=await store.enrolKey(bearerHash(cookie),{id,userId:f.id,publicKey:'synthetic-cose-key',credentialID:credential,
    counter:0,deviceType:'singleDevice',backedUp:false});assert.ok(key);
  const snapshot=await store.uvSnapshot(credential);assert.ok(snapshot);assert.equal(snapshot.state,'pending');
  const next={id:randomUUID(),token:randomBearer(),issuance:randomUUID()},codes=backupCodes(f.id);
  // NULL контекста - только сырым SQL: store его уже не принимает.
  const withoutContext=async(snap:NonNullable<typeof snapshot>)=>(await pg.query<{v:unknown}>(
    'select public.gf_b_uv_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[snap.userId,snap.generation,snap.key.id,snap.fingerprint,0,
      null,randomUUID(),randomBearer(),randomUUID(),codes.hashes,randomUUID()])).rows[0]?.v??null;
  assert.equal(await withoutContext(snapshot),null);
  assert.equal(await store.uvFinish(snapshot,0,bearerHash(randomBearer()),next,codes.hashes,randomUUID()),null);
  assert.deepEqual(await store.uvFinish(snapshot,0,bearerHash(cookie),next,codes.hashes,randomUUID()),{enrolled:true});
  assert.equal(await store.uvFinish(snapshot,0,bearerHash(cookie),next,codes.hashes,randomUUID()),null);
  const active=await store.uvSnapshot(credential);assert.ok(active);assert.equal(active.state,'active');
  assert.equal(await withoutContext(active),null,'без контекста вход по UV не выдаёт сессию');
  const login=randomBearer();assert.equal(await store.uvLoginContext(bearerHash(login),bearerHash('uv-source')),true);
  const result=await store.uvFinish(active,0,bearerHash(login),next,[],randomUUID());assert.ok(result&&'id' in result);
  assert.equal(await store.uvFinish(active,0,bearerHash(login),{...next,id:randomUUID(),token:randomBearer()},[],randomUUID()),null,
    'повтор того же снимка и контекста - не вторая сессия');
  await pg.query('update public.passkey set public_key=$1 where id=$2',['changed-key',id]);
  assert.equal(await store.access(next.id,next.token),null,'подмена publicKey не сохраняет прежний UV proof');
  const again=randomBearer();assert.equal(await store.uvLoginContext(bearerHash(again),bearerHash('uv-source')),true);
  assert.equal(await store.uvFinish(active,0,bearerHash(again),{...next,id:randomUUID(),token:randomBearer()},[],randomUUID()),null);
  assert.equal((await store.uvSnapshot(credential))?.state,null);
});

test('B: активный фактор сам требует усиления, даже при потерянном guard-маркере',async()=>{
  const f=await fixture('user'),store=factorStore(db),snapshot=await store.snapshot(f.id+'@example.test',null);
  assert.equal(snapshot?.required,true);
  const hash=await context(f);
  assert.equal(await store.passwordLogin(hash,{id:randomUUID(),token:randomBearer(),issuance:randomUUID()}),null);
});

test('B: сессия живёт строго 30 дней от входа - ни вставка, ни продление не двигают срок дальше (D-071)',async()=>{
  const f=await fixture(),day=86_400_000;
  const read=async(id:string)=>(await db.select().from(session).where(eq(session.id,id)))[0]!;
  const sid=randomUUID();
  await db.insert(session).values({id:sid,token:randomBearer(),userId:f.id,expiresAt:new Date(Date.now()+40*day)});
  const inserted=await read(sid);
  assert.equal(inserted.expiresAt.getTime(),inserted.createdAt.getTime()+30*day);
  const original=await read(f.sid);
  await db.update(session).set({expiresAt:new Date(Date.now()+90*day)}).where(eq(session.id,f.sid));
  assert.equal((await read(f.sid)).expiresAt.getTime(),original.createdAt.getTime()+30*day);
  // Сокращать срок можно: потолок, а не фиксированная дата.
  const soon=new Date(Date.now()+30_000);
  await db.update(session).set({expiresAt:soon}).where(eq(session.id,f.sid));
  assert.equal((await read(f.sid)).expiresAt.getTime(),soon.getTime());
});

test('B: потолок backup-контекстов считает только живые - истёкшие не закрывают восстановление',async()=>{
  await pg.exec(`insert into auth_private.contexts(token_hash,purpose,created_at,expires_at)
    select encode(sha256(convert_to('ceiling-'||i,'UTF8')),'hex'),'backup',now()-interval '2 hours',now()-interval '1 hour'
    from generate_series(1,10000) i`);
  try {
    assert.equal(await factorStore(db).backupContext(bearerHash(randomBearer()),bearerHash('ceiling-source')),true);
  } finally {
    await pg.exec(`delete from auth_private.contexts where token_hash in
      (select encode(sha256(convert_to('ceiling-'||i,'UTF8')),'hex') from generate_series(1,10000) i)`);
  }
});

test('B: восстановление через UV закрыто - новый пароль задаётся только в TOTP-complete; прежнее не тронуто',async()=>{
  const f=await fixture(),store=factorStore(db),codes=backupCodes(f.id),source=bearerHash('uv-recovery:'+f.id);
  for(const code of codes.hashes) await pg.query('insert into auth_private.backup_codes values($1,$2,$3,now())',[code,f.id,'synthetic-set']);
  const old=await oldKey(f.id);
  const anonymous=randomBearer(),enrol=randomBearer(),cookie=randomBearer();
  assert.equal(await store.backupContext(bearerHash(anonymous),source),true);
  const attempt=bearerHash(randomBearer());assert.ok(await store.reserve(bearerHash(anonymous),source,attempt));
  assert.equal(await store.recover(bearerHash(anonymous),attempt,f.id,codes.hashes[0]!,bearerHash(enrol)),true);
  assert.equal(await store.exchange(bearerHash(enrol),bearerHash(cookie)),true);
  const id=randomUUID(),credential=randomBearer();
  // Ключ держателя кода не ложится даже ожидающим: public.passkey видит штатный вход Better Auth.
  assert.equal(await store.enrolKey(bearerHash(cookie),{id,userId:f.id,publicKey:'synthetic-new-key',credentialID:credential,
    counter:0,deviceType:'singleDevice',backedUp:false}),null);
  assert.deepEqual((await db.select().from(passkey).where(eq(passkey.userId,f.id))).map(k=>k.id),[old]);
  assert.deepEqual((await db.select().from(authFactors).where(eq(authFactors.userId,f.id))).map(x=>[x.id,x.state]),[[f.factorId,'active']]);
  assert.equal((await db.select().from(session).where(eq(session.userId,f.id))).length,1);
  // Даже если ожидающий UV-фактор уже был (заведён в обход), recovery-контекст его не включает.
  await pg.query(`insert into public.passkey(id,user_id,public_key,credential_id,counter,device_type,backed_up) values($1,$2,'synthetic-new-key',$3,0,'singleDevice',false)`,[id,f.id,credential]);
  await pg.query(`insert into auth_private.factors(id,user_id,kind,state,credential_id,fingerprint,created_at,expires_at)
    values($1,$2,'uv','pending',$1,public.gf_b_hash(jsonb_build_array($2::text,$3::text,'synthetic-new-key'::text)::text),now(),now()+interval '5 minutes')`,[id,f.id,credential]);
  await pg.query(`update auth_private.contexts set data=data||jsonb_build_object('uvKeyId',$1::text) where token_hash=$2`,[id,bearerHash(cookie)]);
  const snapshot=await store.uvSnapshot(credential);assert.ok(snapshot);assert.equal(snapshot.state,'pending');
  assert.equal(await store.uvFinish(snapshot,0,bearerHash(cookie),{id:randomUUID(),token:randomBearer(),issuance:randomUUID()},
    backupCodes(f.id).hashes,randomUUID()),null);
  assert.equal((await db.select().from(session).where(eq(session.userId,f.id))).length,1);
});
