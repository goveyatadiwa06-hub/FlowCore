const crypto = require('crypto');

const algorithm = 'aes-256-cbc';

// must be 32 bytes (64 hex characters)
if (!process.env.ENCRYPTION_SECRET) {
  throw new Error('ENCRYPTION_SECRET missing in .env');
}

const secretKey = Buffer.from(process.env.ENCRYPTION_SECRET, 'hex');
const ivLength = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(ivLength);

  const cipher = crypto.createCipheriv(
    algorithm,
    secretKey,
    iv
  );

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = parts.join(':');

  const decipher = crypto.createDecipheriv(
    algorithm,
    secretKey,
    iv
  );

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = { encrypt, decrypt };
