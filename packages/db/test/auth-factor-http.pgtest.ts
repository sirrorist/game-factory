// Реальный HTTP-контроллер и SQL; Next-маршрут B пока не подключён.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { account, schema, session, user } from '../src/index.ts';
import { authFactors } from '../src/auth-factor-schema.ts';
import { backupCodes, bearerHash, factorKeys, randomBearer, totpCode, totpSecret } from '../src/auth-factor-crypto.ts';
import { factorStore } from '../src/auth-factor-store.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { hashPassword } from '../src/admin.ts';
import { factorController, FACTOR_CONTEXT_COOKIE } from '../../../apps/hub/src/lib/auth-factor-core.ts';
import { factorHttp } from '../../../apps/hub/src/lib/auth-factor-http.ts';
import { createHubAuth } from '../../../apps/hub/src/lib/auth-core.ts';
import { SESSION_COOKIE, verifiedSessionBearer } from '../../../apps/hub/src/lib/session-bearer.ts';
import { LoginGuard, ipKey } from '../../../apps/hub/src/lib/login-guard.ts';
import { CSRF_COOKIE, CSRF_HEADER } from '../../../apps/hub/src/lib/csrf-names.ts';

const pg=new PGlite(),db=drizzle(pg,{schema}),keys=factorKeys([Buffer.alloc(32,33)]);
const origin='https://hub.example',secret='Synthetic auth factor cookie secret, at least 32 chars';
const password='Synthetic factor correct password',csrf='c'.repeat(43);
let hash:string;
before(async()=>{await migrate(db,{migrationsFolder:MIGRATIONS_DIR});hash=await hashPassword(password);});
after(()=>pg.close());
async function fixture(withFactor=true) {
  const id=randomUUID(),factorId=randomUUID(),totp=totpSecret();
  await db.insert(user).values({id,name:id,email:id+'@example.test',role:'owner'});
  await db.insert(account).values({id,accountId:id,userId:id,providerId:'credential',password:hash});
  if(withFactor)await db.insert(authFactors).values({id:factorId,userId:id,kind:'totp',state:'active',...keys.seal(totp,id,factorId),createdAt:new Date()});
  const guard=new LoginGuard(),auth=createHubAuth(db,origin,secret);
  const control=factorController(factorStore(db),keys);
  const handle=factorHttp({control,origin,secret,enabled:true,guard,session:async headers=>{
    const current=await auth.api.getSession({headers});return current?{id:current.session.id,email:current.user.email}:null;
  }});
  return {id,email:id+'@example.test',totp,guard,auth,control,handle};
}
function cookies(response:Response) {return response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
function request(body:Record<string,unknown>,extra={cookie:'',ip:'192.0.2.30'},originHeader=origin) {
  return new Request(origin+'/api/account/security/action',{method:'POST',headers:{origin:originHeader,'content-type':'application/json',
    cookie:`${CSRF_COOKIE}=${csrf}; ${extra.cookie}`,[CSRF_HEADER]:csrf,'x-real-ip':extra.ip},body:JSON.stringify(body)});
}

test('B HTTP: пароль даёт только pre-auth; правильный TOTP даёт совместимую подписанную cookie, исходный bearer проверяется',async()=>{
  const f=await fixture(),response=await f.handle(request({email:f.email,password}),'password');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{code:'totp_required'});
  const context=cookies(response);assert.match(context,new RegExp(FACTOR_CONTEXT_COOKIE));assert.doesNotMatch(context,new RegExp(SESSION_COOKIE));
  assert.equal((await db.select().from(session).where(eq(session.userId,f.id))).length,0);
  const code=totpCode(f.totp,Math.floor(Date.now()/30000));
  assert.equal((await f.handle(request({code},{cookie:FACTOR_CONTEXT_COOKIE+'='+randomBearer(),ip:'192.0.2.30'}),'totp')).status,401);
  const result=await f.handle(request({code},{cookie:context,ip:'192.0.2.30'}),'totp');assert.equal(result.status,200);
  const cookie=cookies(result),headers=new Headers({cookie});
  const current=await f.auth.api.getSession({headers});assert.ok(current);
  const bearer=await verifiedSessionBearer(headers,secret);assert.equal(bearer,current.session.token);
  assert.equal(await verifiedSessionBearer(headers,secret+'wrong'),null);
  assert.equal(await verifiedSessionBearer(new Headers({cookie:cookie+'; '+cookie}),secret),null);
  assert.ok(await factorStore(db).access(current.session.id,bearer!));
  assert.equal((await f.handle(request({code},{cookie:context,ip:'192.0.2.30'}),'totp')).status,401);
});

for(const [source,victim] of [['192.0.2.50','192.0.2.50'],['2001:db8:1234:10::1','2001:db8:1234:10::2']]) {
  test(`B HTTP: backup-отказы не банят правильный пароль/TOTP за общим ${source!.includes(':')?'IPv6 /64':'IP'}`,async()=>{
    const f=await fixture();
    for(let i=0;i<5;i++) {
      const start=await f.handle(request({},{cookie:'',ip:source!}),'backup-start');assert.equal(start.status,200);
      const context=cookies(start);
      for(let j=0;j<5;j++)assert.equal((await f.handle(request({email:f.email,code:backupCodes(f.id).codes[0]!},
        {cookie:context,ip:source!}),'recover')).status,401);
    }
    const primary=await f.handle(request({email:f.email,password},{cookie:'',ip:victim!}),'password');
    assert.equal(primary.status,200,'backup не должен включать бан парольного LoginGuard');
    const result=await f.handle(request({code:totpCode(f.totp,Math.floor(Date.now()/30000))},{cookie:cookies(primary),ip:victim!}),'totp');
    assert.equal(result.status,200);assert.match(cookies(result),new RegExp(SESSION_COOKIE));
    assert.equal(f.guard.check(ipKey(victim!)).banned,false);
    const different=await fixture();
    assert.equal((await different.handle(request({email:different.email,password},{cookie:'',ip:'198.51.100.2'}),'password')).status,200);
  });
}

test('B HTTP: неизвестные поля, Origin, disabled и GET не запускают auth-процедуры; ответы не отражают секреты',async()=>{
  let calls=0;
  const control=new Proxy({...factorController(factorStore(db),keys)},{get(target,key){const value=Reflect.get(target,key);
    if(typeof value==='function')return (...args:unknown[])=>{calls++;return Reflect.apply(value,target,args);};return value;}});
  const handle=factorHttp({enabled:true,origin,secret,control,session:async()=>null});
  const input={email:'synthetic@example.test',password:'hidden-password'};
  assert.equal((await handle(request({...input,userId:'owner'}),'password')).status,400);
  assert.equal((await handle(request(input,{cookie:'',ip:'192.0.2.3'},'https://game.example'),'password')).status,403);
  assert.equal((await handle(new Request(origin),'password')).status,405);assert.equal(calls,0);
  const disabled=factorHttp({enabled:false,origin,secret,control,session:async()=>null});
  assert.equal((await disabled(request(input),'password')).status,404);assert.equal(calls,0);
  const response=await handle(request({token:randomBearer()}),'exchange');
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{code:'invalid'});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});

test('B HTTP: исчерпание выдачи контекстов после верного пароля не становится парольной неудачей',async()=>{
  const f=await fixture();
  for(let i=0;i<10;i++)await f.handle(request({email:f.email,password}),'password');
  assert.equal(f.guard.check('192.0.2.30').banned,false);
  const rows=await pg.query<{hits:unknown}>('select hits from auth_private.counters where key=$1',['issue:target:'+bearerHash(f.id+':login')]);
  assert.equal((rows.rows[0]?.hits as unknown[]).length,5);
});

test('B HTTP: setup не меняет пароль через totp-complete ни в Node, ни в SQL; без newPassword TOTP включается',async()=>{
  // admin/owner без фактора сразу получают totp_required; обычный путь setup - у user/developer.
  const f=await fixture(false),at={ip:'192.0.2.40'};
  await db.update(user).set({role:'user'}).where(eq(user.id,f.id));
  const login=await f.handle(request({email:f.email,password},{cookie:'',...at}),'password');
  assert.equal(login.status,200);assert.deepEqual(await login.json(),{code:'ok'});
  const setup=await f.handle(request({},{cookie:cookies(login),...at}),'setup');assert.equal(setup.status,200);
  const enrol=cookies(setup);
  const pending=await f.handle(request({},{cookie:enrol,...at}),'totp-pending');assert.equal(pending.status,200);
  const {secret:totp}=await pending.json() as {secret:string};
  const step=Math.floor(Date.now()/30000),code=totpCode(totp,step);
  const stored=async()=>(await db.select().from(account).where(eq(account.userId,f.id)))[0]!.password;
  const attacker='Synthetic attacker chosen password';
  assert.equal((await f.handle(request({code,newPassword:attacker},{cookie:enrol,...at}),'totp-complete')).status,401);
  assert.equal(await stored(),hash);
  // SQL держит то же правило сам, даже если Node пропустит пароль.
  const store=factorStore(db),context=bearerHash(enrol.slice(enrol.indexOf('=')+1)),attempt=bearerHash(randomBearer());
  assert.ok(await store.reserve(context,bearerHash('sql-direct'),attempt));
  const snapshot=await store.snapshot(null,context);assert.ok(snapshot?.factor);
  assert.equal(await store.complete(context,attempt,snapshot.factor,step,backupCodes(f.id).hashes,randomUUID(),await hashPassword(attacker)),false);
  assert.equal(await stored(),hash);
  const done=await f.handle(request({code},{cookie:enrol,...at}),'totp-complete');assert.equal(done.status,200);
  assert.equal(await stored(),hash);
});

test('B HTTP: action из прототипа - 400; сбой процедуры пишется в журнал без message и секретов',async()=>{
  const f=await fixture(),warn=console.warn,lines:string[]=[];
  assert.equal((await f.handle(request({}),'constructor')).status,400);
  assert.equal((await f.handle(request({}),'__proto__')).status,400);
  const leaked='Failed query params: '+randomBearer();
  const control={...factorController(factorStore(db),keys),exchange:async()=>{throw new Error(leaked,{cause:{code:'23514'}});}};
  const handle=factorHttp({enabled:true,origin,secret,control,session:async()=>null});
  console.warn=(...args:unknown[])=>{lines.push(args.join(' '));};
  try {assert.equal((await handle(request({token:randomBearer()}),'exchange')).status,503);}
  finally {console.warn=warn;}
  assert.deepEqual(lines,['gf-auth: сбой действия=exchange ошибка=Error sqlstate=23514']);
});

test('B HTTP: вход в свою учётку не обнуляет перебор чужой; password-change считает неверный старый пароль',async()=>{
  const f=await fixture(false),other=await fixture(false),at={cookie:'',ip:'192.0.2.50'};
  await db.update(user).set({role:'user'}).where(eq(user.id,other.id));
  for(let i=0;i<4;i++)assert.equal((await f.handle(request({email:f.email,password:'Synthetic wrong password '+i},at),'password')).status,401);
  assert.equal((await f.handle(request({email:other.email,password},at),'password')).status,200);
  assert.equal((await f.handle(request({email:f.email,password:'Synthetic wrong password 5'},at),'password')).status,401);
  assert.equal(f.guard.check(ipKey(at.ip)).banned,true,'пятый неверный на чужую учётку - бан');

  const g=await fixture(false),here={ip:'192.0.2.51'};
  await db.update(user).set({role:'user'}).where(eq(user.id,g.id));
  const login=await g.handle(request({email:g.email,password},{cookie:'',...here}),'password');assert.equal(login.status,200);
  const change=(old:string)=>g.handle(request({password:old,newPassword:'Synthetic next strong password'},{cookie:cookies(login),...here}),'password-change');
  for(let i=0;i<5;i++)assert.equal((await change('Synthetic wrong old password '+i)).status,401);
  const banned=await change(password);assert.equal(banned.status,429,'после пяти неверных старых паролей - бан, даже с верным');
  assert.ok(Number(banned.headers.get('retry-after'))>0);
});
