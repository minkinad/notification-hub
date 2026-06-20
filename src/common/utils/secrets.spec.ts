import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  maskSensitiveJson,
} from './secrets';

describe('secret utilities', () => {
  const encryptionKey = 'unit-test-encryption-key-with-at-least-32-characters';

  it('encrypts sensitive values and restores the original config', () => {
    const config = {
      url: 'https://example.com/hook',
      headers: {
        authorization: 'Bearer provider-secret',
      },
      nested: {
        apiKey: 'provider-api-key',
      },
    };

    const encrypted = encryptSensitiveJson(config, encryptionKey);

    expect(encrypted).not.toEqual(config);
    expect(JSON.stringify(encrypted)).not.toContain('provider-secret');
    expect(JSON.stringify(encrypted)).not.toContain('provider-api-key');
    expect(decryptSensitiveJson(encrypted, encryptionKey)).toEqual(config);
  });

  it('decrypts legacy plaintext and keeps masking API responses', () => {
    const legacyConfig = {
      botToken: 'very-secret-token',
      chatId: '@alerts',
    };

    const decrypted = decryptSensitiveJson(legacyConfig, encryptionKey);

    expect(maskSensitiveJson(decrypted)).toEqual({
      botToken: 'very...oken',
      chatId: '@alerts',
    });
  });
});
