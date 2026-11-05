// Проверяет именно выход сборки; источники правил в релизный пакет не добавляются.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { checkRelease, type ReleaseFile } from '../build/release-check.ts';
const root=process.argv[2]?resolve(process.argv[2]):resolve(import.meta.dirname,'../dist'),files:ReleaseFile[]=[];
async function walk(path:string):Promise<void>{for(const entry of await readdir(path,{withFileTypes:true})){const file=resolve(path,entry.name);if(entry.isDirectory())await walk(file);else files.push({path:relative(root,file).replaceAll('\\','/'),data:await readFile(file,'utf8')});}}
await walk(root);checkRelease(files);console.log(`✓ release-check: ${files.length} файлов, без исходников и source maps`);
