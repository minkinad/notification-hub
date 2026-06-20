import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_SECRET: Joi.string()
    .min(32)
    .invalid(
      'replace_with_a_long_random_secret',
      'replace_with_at_least_32_random_characters',
      'change_me_to_a_long_random_secret_32_chars',
    )
    .required(),
  JWT_EXPIRATION: Joi.string().default('7d'),
  CHANNEL_CONFIG_ENCRYPTION_KEY: Joi.string()
    .min(32)
    .invalid('replace_with_at_least_32_random_characters')
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis'] })
    .optional(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  CORS_ORIGIN: Joi.string().default('*'),
  APP_NAME: Joi.string().default('NotificationHub'),
  APP_VERSION: Joi.string().default('1.0.0'),
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().positive().default(100),
  DELIVERY_HTTP_TIMEOUT_MS: Joi.number().integer().positive().default(5000),
  DELIVERY_HTTP_MAX_RESPONSE_BYTES: Joi.number()
    .integer()
    .positive()
    .default(32768),
  DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS: Joi.boolean().default(true),
  DELIVERY_OUTBOX_INTERVAL_MS: Joi.number().integer().positive().default(30000),
});
