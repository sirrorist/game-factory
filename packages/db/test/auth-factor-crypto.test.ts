import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_WARNING, backupCodes, backupHash, base32, bearerHash, factorKeys,
  randomBearer, totpCode, totpSecret, validBackup, validBearer, verifyTotp } from '../src/auth-factor-crypto.ts';

test('TOTP: официальные SHA-1 векторы RFC 6238, шесть цифр и ограниченное окно', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'],
    [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'],
    [20000000000, '65353130']] as const) {
    assert.equal(totpCode(secret, Math.floor(seconds / 30), 8), expected);
  }
  const now = 1_700_000_000_000, step = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) assert.equal(verifyTotp(secret, totpCode(secret, step + offset), now), step + offset);
  for (const offset of [-2, 2]) assert.equal(verifyTotp(secret, totpCode(secret, step + offset), now), null);
  for (const code of ['1','1234567','abcdef','１２３４５６']) assert.equal(verifyTotp(secret,code,now),null);
  assert.throws(() => totpCode(secret,-1)); assert.throws(() => totpCode('a'.repeat(32),1));
});

test('bearer: независимые 256 бит, канонический base64url, hash-only; backup 128 бит и отдельное назначение', () => {
  const values = Array.from({ length: 32 }, randomBearer);
  assert.equal(new Set(values).size,32);
  for (const value of values) {
    assert.equal(validBearer(value),true); assert.equal(Buffer.from(value,'base64url').length,32);
    assert.match(bearerHash(value),/^[a-f0-9]{64}$/); assert.notEqual(bearerHash(value),value);
  }
  assert.equal(validBearer(values[0]+'='),false); assert.equal(validBearer(''),false);
  assert.equal(validBearer('A'.repeat(42)+'B'),false);
  const { codes, hashes }=backupCodes('synthetic-user');
  assert.equal(codes.length,10); assert.equal(new Set(codes).size,10);
  for (const [i, code] of codes.entries()) {
    assert.equal(validBackup(code),true); assert.equal(Buffer.from(code,'base64url').length,16);
    assert.equal(hashes[i],backupHash('synthetic-user',code));
    assert.notEqual(hashes[i],backupHash('other-user',code)); assert.notEqual(hashes[i],bearerHash(code));
  }
  assert.match(BACKUP_WARNING,/один раз/); assert.match(BACKUP_WARNING,/бумаге/);
  assert.match(BACKUP_WARNING,/восстановить доступ/);
});

test('AES-GCM факторов: привязка user/factor/key, неверный ключ/тег и ротация без fallback', () => {
  const secret=totpSecret(), ring=factorKeys([Buffer.alloc(32,1)]);
  assert.match(secret,/^[A-Z2-7]{32}$/);
  const encrypted=ring.seal(secret,'user-a','factor-a');
  assert.equal(encrypted.ciphertext.includes(secret),false);
  assert.equal(ring.open(encrypted,'user-a','factor-a'),secret);
  assert.throws(()=>ring.open(encrypted,'user-b','factor-a'));
  assert.throws(()=>ring.open(encrypted,'user-a','factor-b'));
  assert.throws(()=>ring.open({...encrypted,keyId:'missing'},'user-a','factor-a'));
  const raw=Buffer.from(encrypted.ciphertext,'base64url'); raw[15]=raw[15]!^1;
  assert.throws(()=>ring.open({...encrypted,ciphertext:raw.toString('base64url')},'user-a','factor-a'));
  const rotated=factorKeys([Buffer.alloc(32,2),Buffer.alloc(32,1)]);
  assert.equal(rotated.open(encrypted,'user-a','factor-a'),secret);
  assert.throws(()=>factorKeys([Buffer.alloc(32,2)]).open(encrypted,'user-a','factor-a'));
  assert.throws(()=>factorKeys([Buffer.alloc(31)]));
});
