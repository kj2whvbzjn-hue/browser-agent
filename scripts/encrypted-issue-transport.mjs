import {
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  constants,
} from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');

export function generateTransportKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function keyFingerprint(publicKeyPem) {
  return `sha256:${createHash('sha256').update(publicKeyPem).digest('hex')}`;
}

export function encryptEnvelope(value, recipientPublicKey, metadata = {}) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aadObject = { v: 1, ...metadata };
  const aad = Buffer.from(JSON.stringify(aadObject));
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt({
    key: recipientPublicKey,
    oaepHash: 'sha256',
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  }, key);
  return {
    ...aadObject,
    alg: 'RSA-OAEP-3072+AES-256-GCM',
    kid: keyFingerprint(recipientPublicKey),
    nonce: b64u(nonce),
    encryptedKey: b64u(encryptedKey),
    ciphertext: b64u(ciphertext),
    tag: b64u(tag),
  };
}

export function decryptEnvelope(envelope, recipientPrivateKey) {
  const { alg, kid, nonce, encryptedKey, ciphertext, tag, ...aadObject } = envelope;
  if (alg !== 'RSA-OAEP-3072+AES-256-GCM') throw new Error(`Unsupported alg: ${alg}`);
  const key = privateDecrypt({
    key: recipientPrivateKey,
    oaepHash: 'sha256',
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  }, unb64u(encryptedKey));
  const decipher = createDecipheriv('aes-256-gcm', key, unb64u(nonce));
  decipher.setAAD(Buffer.from(JSON.stringify(aadObject)));
  decipher.setAuthTag(unb64u(tag));
  const plaintext = Buffer.concat([decipher.update(unb64u(ciphertext)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
