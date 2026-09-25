// Минимальная запись zip без зависимостей: deflate из node:zlib, CRC32 из node:zlib.
// Только запись: чтение чужих архивов (этап 2) пойдёт через проверенную
// библиотеку с защитой от zip-slip и zip-бомб, а не через самописный парсер.
// Архив детерминированный: фиксированная дата, порядок файлов задаёт вызывающий.

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Путь внутри архива через "/". */
  name: string;
  data: Uint8Array;
}

// 1980-01-01 00:00 в формате DOS: воспроизводимые архивы без меток времени.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_FLAG = 1 << 11;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error(`zip: больше ${MAX_ENTRIES} файлов не поддерживается (нужен zip64)`);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.name)) throw new Error(`zip: файл "${entry.name}" добавлен дважды`);
    seen.add(entry.name);
    if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) {
      throw new Error(`zip: небезопасное имя "${entry.name}"`);
    }

    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const deflated = deflateRawSync(raw, { level: 9 });
    // Сжатие не всегда выгодно (png, mp3): тогда кладём как есть.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw) >>> 0;

    if (raw.length > MAX_SIZE || offset > MAX_SIZE) throw new Error('zip: архив больше 4 ГБ не поддерживается (нужен zip64)');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // обычный файл rw-r--r--
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDir, end]);
}
