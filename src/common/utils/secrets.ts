import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const SENSITIVE_KEY_PATTERN =
  /(?:token|secret|password|authorization|api[-_]?key|bot[-_]?token|bearer|credential|private[-_]?key)/i;
const ENCRYPTED_VALUE_MARKER = '__notificationHubEncrypted';

interface EncryptedValue {
  [ENCRYPTED_VALUE_MARKER]: 'v1';
  iv: string;
  tag: string;
  data: string;
}

export function maskSensitiveJson<T>(value: T): T {
  return maskValue(value) as T;
}

export function encryptSensitiveJson<T>(value: T, secret: string): T {
  return transformForEncryption(value, deriveKey(secret)) as T;
}

export function decryptSensitiveJson<T>(value: T, secret: string): T {
  return transformForDecryption(value, deriveKey(secret)) as T;
}

function transformForEncryption(value: unknown, key: Buffer): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformForEncryption(item, key));
  }

  if (isEncryptedValue(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([field, nestedValue]) => [
        field,
        SENSITIVE_KEY_PATTERN.test(field)
          ? encryptValue(nestedValue, key)
          : transformForEncryption(nestedValue, key),
      ]),
    );
  }

  return value;
}

function transformForDecryption(value: unknown, key: Buffer): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformForDecryption(item, key));
  }

  if (isEncryptedValue(value)) {
    return transformForDecryption(decryptValue(value, key), key);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([field, nestedValue]) => [
        field,
        transformForDecryption(nestedValue, key),
      ]),
    );
  }

  return value;
}

function encryptValue(value: unknown, key: Buffer): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);

  return {
    [ENCRYPTED_VALUE_MARKER]: 'v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptValue(value: EncryptedValue, key: Buffer) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(decrypted) as unknown;
}

function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate[ENCRYPTED_VALUE_MARKER] === 'v1' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.data === 'string'
  );
}

function deriveKey(secret: string) {
  return createHash('sha256').update(secret).digest();
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? maskScalar(nestedValue)
          : maskValue(nestedValue),
      ]),
    );
  }

  return value;
}

function maskScalar(value: unknown) {
  if (typeof value !== 'string') {
    return '[redacted]';
  }

  if (value.length <= 8) {
    return '[redacted]';
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
