import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAGIC = Buffer.from('BAP1');

function keyFromSecret(secret) {
  if (!secret) throw new Error('BROWSER_PROFILE_KEY is required');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export async function encryptProfile({ profileDir, encryptedPath, secret }) {
  const tarPath = `${encryptedPath}.plain.tar.gz`;
  await mkdir(dirname(encryptedPath), { recursive: true });
  try {
    await execFileAsync('tar', ['-C', profileDir, '-czf', tarPath, '.']);
    const plaintext = await readFile(tarPath);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    await writeFile(encryptedPath, Buffer.concat([MAGIC, iv, tag, ciphertext]), { mode: 0o600 });
  } finally {
    await rm(tarPath, { force: true });
  }
}

export async function decryptProfile({ encryptedPath, profileDir, secret }) {
  const tarPath = `${encryptedPath}.plain.tar.gz`;
  const payload = await readFile(encryptedPath);
  if (payload.length < 32 || !payload.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid encrypted browser profile');
  const iv = payload.subarray(4, 16);
  const tag = payload.subarray(16, 32);
  const ciphertext = payload.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  try {
    await writeFile(tarPath, plaintext, { mode: 0o600 });
    await execFileAsync('tar', ['-C', profileDir, '-xzf', tarPath]);
  } finally {
    await rm(tarPath, { force: true });
  }
}

async function main() {
  const [command, profileDir, encryptedPath] = process.argv.slice(2);
  const secret = process.env.BROWSER_PROFILE_KEY;
  if (command === 'encrypt') return encryptProfile({ profileDir, encryptedPath, secret });
  if (command === 'decrypt') return decryptProfile({ encryptedPath, profileDir, secret });
  throw new Error('Usage: browser-profile-crypto.mjs <encrypt|decrypt> <profileDir> <encryptedPath>');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exitCode = 1; });
