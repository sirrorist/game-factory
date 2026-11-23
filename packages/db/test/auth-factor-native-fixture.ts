// Разрешён только собственный временный кластер. Рабочий URL не принимается.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdtempSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { schema } from '../src/index.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { ensureAuthRole, ensureHubRole } from '../src/roles.ts';

export async function nativeFactors(bin: string) {
  const root=mkdtempSync(join(tmpdir(),'gf-auth-b-native-')),socket=join(root,'socket'),data=join(root,'data');
  mkdirSync(socket);
  execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','gf_test','--no-locale'],{stdio:'pipe',timeout:15000});
  const log=openSync(join(root,'postgres.log'),'w',0o600);
  const server=spawn(join(bin,'postgres'),['-D',data,'-k',socket,'-p','5447','-c','listen_addresses=',
    '-c','shared_buffers=16MB','-c','max_connections=10'],{stdio:['ignore',log,log]});
  closeSync(log);
  const clients:ReturnType<typeof postgres>[]=[];
  function connect(user='gf_test') {
    const client=postgres({host:socket,port:5447,user,database:'postgres',max:1,connect_timeout:1,onnotice:()=>{},
      connection:{statement_timeout:5000,lock_timeout:4000}});clients.push(client);return client;
  }
  const first=connect(),second=connect();
  async function close() {
    const failures:unknown[]=[];
    for(const client of clients)try {await client.end({timeout:1});}catch(e){failures.push(e);}
    if(server.exitCode===null && server.signalCode===null) {
      server.kill('SIGINT');
      for(let i=0;i<30 && server.exitCode===null && server.signalCode===null;i++)await delay(100);
      if(server.exitCode===null && server.signalCode===null) {
        server.kill('SIGKILL');
        for(let i=0;i<10 && server.exitCode===null && server.signalCode===null;i++)await delay(100);
        failures.push(new Error('тестовый PostgreSQL потребовал SIGKILL'));
      }
    }
    if(failures.length)throw new AggregateError(failures,'не полностью завершён тестовый кластер B');
  }
  try {
    let ready=false;
    for(let i=0;i<30;i++) {try {await first`select 1`;ready=true;break;}catch {await delay(100);}}
    if(!ready)throw new Error('временный PostgreSQL B не готов');
    const db=drizzle(first,{schema}),other=drizzle(second,{schema});
    await migrate(db,{migrationsFolder:MIGRATIONS_DIR});
    await ensureHubRole(db,'synthetic-hub-password');await ensureAuthRole(db,'synthetic-auth-password');
    const hub=connect('gf_hub'),auth=connect('gf_auth');
    return {first,second,db,other,hub,auth,hubDb:drizzle(hub,{schema}),authDb:drizzle(auth,{schema}),close};
  } catch(e) {await close();throw e;}
}
