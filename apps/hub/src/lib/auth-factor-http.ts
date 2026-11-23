import { SESSION_COOKIE, signedSessionCookie, verifiedSessionBearer } from './session-bearer.ts';
import { FACTOR_CONTEXT_COOKIE, FACTOR_ENROL_COOKIE, FACTOR_REAUTH_COOKIE, type FactorController } from './auth-factor-core.ts';
import { checkCsrf } from './csrf.ts';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf-names.ts';
import { cookieValue, readBody } from './auth-actions-http.ts';
import { clientIp, guardSubject, ipKey, passwordGuard, type LoginGuard } from './login-guard.ts';

const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex','x-content-type-options':'nosniff'};
const cookie=(name:string,value:string)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300`;
const clear=(name:string)=>`${name}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

export function factorHttp(deps:{enabled:boolean;origin:string;secret:string;control:FactorController;
  session:(headers:Headers)=>Promise<{id:string;email:string}|null>;guard?:LoginGuard}) {
  // По умолчанию - общий счёт со старым маршрутом входа: два счёта удвоили бы лимит на адрес.
  const guard=deps.guard??passwordGuard;
  return async(req:Request,action:string):Promise<Response>=>{
    const reply=(value:object,status=200,cookies:string[]=[])=>{
      const h=new Headers(headers);for(const value of cookies)h.append('set-cookie',value);
      return Response.json(value,{status,headers:h});
    };
    if(!deps.enabled)return reply({code:'disabled'},404);
    if(req.method!=='POST')return reply({code:'method_not_allowed'},405);
    if(!checkCsrf({method:req.method,origin:req.headers.get('origin'),cookie:cookieValue(req.headers.get('cookie'),CSRF_COOKIE),
      header:req.headers.get(CSRF_HEADER)},deps.origin).ok)return reply({code:'forbidden'},403);
    const body=await readBody(req);if(!body)return reply({code:'invalid_request'},400);
    const schema:Record<string,string[]>= {
      password:['email','password'],reauth:['email','password'],totp:['code'],setup:[],exchange:['token'],
      'totp-pending':[],'totp-complete':['code'], 'backup-start':[],recover:['email','code'],
      'password-change':['password','newPassword'],'backup-rotate':[],disable:[], 'uv-reauth':[],
    };
    // Только собственные ключи: action='constructor' иначе достал бы функцию из прототипа.
    const fields=Object.hasOwn(schema,action)?schema[action]:undefined;
    const actual=Object.keys(body).filter(name=>!(action==='totp-complete'&&name==='newPassword')).sort();
    if(!fields || actual.join(',')!==[...fields].sort().join(',')
      || Object.values(body).some(v=>typeof v!=='string'||v.length>1024))return reply({code:'invalid_request'},400);
    const input=body as Record<string,string>,source=ipKey(clientIp(req.headers));
    const context=cookieValue(req.headers.get('cookie'),FACTOR_CONTEXT_COOKIE)??'';
    const enrol=cookieValue(req.headers.get('cookie'),FACTOR_ENROL_COOKIE)??'';
    const fail=()=>reply({code:'invalid'},401);
    try {
      async function original() {
        const bearer=await verifiedSessionBearer(req.headers,deps.secret);if(!bearer)return null;
        const session=await deps.session(req.headers);if(!session)return null;
        return {id:session.id,bearer,email:session.email};
      }
      if(action==='password'||action==='reauth') {
        const verdict=guard.check(source);
        if(verdict.banned){const res=reply({code:'source_limited'},429);res.headers.set('retry-after',String(verdict.retryAfterS));return res;}
        const old=action==='reauth'?await original():null;if(action==='reauth'&&!old)return fail();
        const result=await deps.control.password(input.email!,input.password!,source,old),subject=guardSubject(input.email);
        if(!result){const ban=guard.fail(source,Date.now(),subject);console.warn(`gf-auth: вход отклонён ip=${clientIp(req.headers)} причина=пароль${ban?` бан=${ban.bannedForS}с`:''}`);return fail();}
        guard.success(source,subject);
        if(result.kind==='denied')return fail();
        return result.kind==='totp'?reply({code:'totp_required'},200,[cookie(FACTOR_CONTEXT_COOKIE,result.cookie)])
          :reply({code:'ok'},200,[await signedSessionCookie(result.session.token,deps.secret),clear(FACTOR_CONTEXT_COOKIE)]);
      }
      if(action==='totp') {
        const result=await deps.control.totp(context,input.code!,source);
        return result?reply({code:'ok'},200,[await signedSessionCookie(result.token,deps.secret),clear(FACTOR_CONTEXT_COOKIE)]):fail();
      }
      if(action==='exchange') {
        const result=await deps.control.exchange(input.token!);return result?reply({code:'ok'},200,[cookie(FACTOR_ENROL_COOKIE,result)]):fail();
      }
      if(action==='setup') {
        const old=await original();if(!old)return fail();
        const result=await deps.control.setup(old);return result?reply({code:'ok'},200,[cookie(FACTOR_ENROL_COOKIE,result)]):fail();
      }
      if(action==='totp-pending') {const result=await deps.control.pending(enrol);return result?reply(result):fail();}
      if(action==='totp-complete') {
        const result=await deps.control.complete(enrol,input.code!,source,input.newPassword);
        return result?reply(result,200,[clear(FACTOR_ENROL_COOKIE),clear(SESSION_COOKIE)]):fail();
      }
      if(action==='backup-start') {
        const result=await deps.control.backupContext(source);return result?reply({code:'ok'},200,[cookie(FACTOR_CONTEXT_COOKIE,result)]):fail();
      }
      if(action==='recover') {
        const result=await deps.control.recover(context,input.email!,input.code!,source);
        return result?reply({code:'ok'},200,[cookie(FACTOR_ENROL_COOKIE,result),clear(FACTOR_CONTEXT_COOKIE),clear(SESSION_COOKIE)]):fail();
      }
      const old=await original();if(!old)return fail();
      if(action==='password-change') {
        // Проверка старого пароля - тот же лимит, что у входа: свежая сессия не даёт подбирать его без счёта.
        const verdict=guard.check(source),subject=guardSubject(old.email);
        if(verdict.banned){const res=reply({code:'source_limited'},429);res.headers.set('retry-after',String(verdict.retryAfterS));return res;}
        if(await deps.control.changePassword(old,old.email,input.password!,input.newPassword!)) {
          guard.success(source,subject);return reply({code:'ok'},200,[clear(SESSION_COOKIE)]);
        }
        const ban=guard.fail(source,Date.now(),subject);
        console.warn(`gf-auth: смена пароля отклонена ip=${clientIp(req.headers)} причина=пароль${ban?` бан=${ban.bannedForS}с`:''}`);
        return fail();
      }
      if(action==='backup-rotate') {const result=await deps.control.rotate(old);return result?reply(result):fail();}
      if(action==='uv-reauth') {const result=await deps.control.uvContext(old);return result?reply({code:'ok'},200,[cookie(FACTOR_REAUTH_COOKIE,result)]):fail();}
      if(action==='disable')return await deps.control.store.disable(old)?reply({code:'ok'},200,[clear(SESSION_COOKIE)]):fail();
      return reply({code:'invalid_request'},400);
    } catch(error) {
      // Только имя ошибки и SQLSTATE: message у drizzle содержит параметры запроса - сырые
      // bearer новой сессии, ciphertext TOTP и хэши. action здесь уже из белого списка schema.
      const name=error instanceof Error&&/^\w{1,40}$/.test(error.name)?error.name:'unknown';
      const state=(error as {cause?:{code?:unknown}})?.cause?.code;
      console.warn(`gf-auth: сбой действия=${action} ошибка=${name}${typeof state==='string'&&/^[0-9A-Z]{5}$/.test(state)?` sqlstate=${state}`:''}`);
      return reply({code:'temporarily_unavailable'},503);
    }
  };
}
