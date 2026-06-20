import { envValidationSchema } from './env.validation';

describe('environment validation', () => {
  const baseEnvironment = {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/notification_hub',
    CHANNEL_CONFIG_ENCRYPTION_KEY:
      'local-channel-config-key-with-more-than-32-characters',
  };

  it('rejects short and documented placeholder JWT secrets', () => {
    const shortSecret = envValidationSchema.validate({
      ...baseEnvironment,
      JWT_SECRET: 'too-short',
    });
    const placeholderSecret = envValidationSchema.validate({
      ...baseEnvironment,
      JWT_SECRET: 'replace_with_at_least_32_random_characters',
    });

    expect(shortSecret.error).toBeDefined();
    expect(placeholderSecret.error).toBeDefined();
  });

  it('rejects the documented channel encryption key placeholder', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      CHANNEL_CONFIG_ENCRYPTION_KEY:
        'replace_with_at_least_32_random_characters',
      JWT_SECRET: 'local-test-secret-with-more-than-32-characters',
    });

    expect(result.error).toBeDefined();
  });

  it('accepts a JWT secret with at least 32 non-placeholder characters', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      JWT_SECRET: 'local-test-secret-with-more-than-32-characters',
    });

    expect(result.error).toBeUndefined();
  });
});
