import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PRIVATE_MAGIC = Buffer.from('BTP1');

function keyFromSecret(secret) {
  if (!secret) throw new Error('BROWSER_PROFILE_KEY is required');
  return createHash('sha256').update(secret, 'utf8').digest();
}

async function writePrivate(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { mode: 0o600 });
}

async function prepare(privateEncryptedPath, publicPath) {
  const secret = process.env.BROWSER_PROFILE_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  await writePrivate(
    privateEncryptedPath,
    Buffer.concat([PRIVATE_MAGIC, iv, tag, ciphertext]),
  );
  await mkdir(dirname(publicPath), { recursive: true });
  await writeFile(publicPath, publicKey, 'utf8');
}

async function decryptPrivate(privateEncryptedPath) {
  const secret = process.env.BROWSER_PROFILE_KEY;
  const payload = await readFile(privateEncryptedPath);
  if (payload.length < 32 || !payload.subarray(0, 4).equals(PRIVATE_MAGIC)) {
    throw new Error('Invalid encrypted transport private key');
  }
  const iv = payload.subarray(4, 16);
  const tag = payload.subarray(16, 32);
  const ciphertext = payload.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function wrap(publicPath, secretPath, wrappedPath) {
  const publicKey = await readFile(publicPath, 'utf8');
  const transferSecret = (await readFile(secretPath, 'utf8')).trim();
  if (!transferSecret) throw new Error('Transfer secret is empty');
  const wrapped = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(transferSecret, 'utf8'),
  );
  await writePrivate(wrappedPath, Buffer.from(wrapped.toString('base64'), 'utf8'));
}

async function unwrap(privateEncryptedPath, wrappedPath, secretPath) {
  const privateKey = await decryptPrivate(privateEncryptedPath);
  const wrapped = Buffer.from((await readFile(wrappedPath, 'utf8')).trim(), 'base64');
  const transferSecret = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrapped,
  );
  await writePrivate(secretPath, transferSecret);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare' && args.length === 2) return prepare(args[0], args[1]);
  if (command === 'wrap' && args.length === 3) return wrap(args[0], args[1], args[2]);
  if (command === 'unwrap' && args.length === 3) return unwrap(args[0], args[1], args[2]);
  throw new Error(
    'Usage: browser-profile-transfer-crypto.mjs prepare <private.enc> <public.pem> | wrap <public.pem> <secret.txt> <wrapped.txt> | unwrap <private.enc> <wrapped.txt> <secret.txt>',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
