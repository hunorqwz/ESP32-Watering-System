import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!secret) {
    throw new Error('Insecure Application Configuration: DATABASE_URL or ENCRYPTION_KEY environment variables must be defined to derive a secure cryptographic key.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  // Format: iv:encrypted_text
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      // If not formatted as iv:ciphertext, treat it as legacy plaintext for seamless backward compatibility
      return encryptedText;
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed, returning input as plaintext fallback:', err.message);
    return encryptedText;
  }
}
