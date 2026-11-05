export type SaveEntry=readonly [key:string,value:unknown];
/** Снимки фиксируются сразу, пакеты пишутся по очереди даже после ошибки предыдущего. */
export function createSaveWriter(write:(key:string,value:unknown)=>Promise<void>) {
  let tail:Promise<void>=Promise.resolve();
  async function batch(entries:readonly SaveEntry[]):Promise<void> {
    const snapshots=entries.map(([key,value])=>{
      const json=JSON.stringify(value);
      if(json===undefined)throw new TypeError('Снимок сохранения должен быть JSON.');
      return [key,JSON.parse(json) as unknown] as const;
    });
    const result=tail.then(async()=>{for(const [key,value]of snapshots)await write(key,value);});
    tail=result.catch(()=>undefined);
    return result;
  }
  return {save:(key:string,value:unknown)=>batch([[key,value]]),batch};
}
