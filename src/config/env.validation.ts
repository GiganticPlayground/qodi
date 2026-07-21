import { z } from 'zod';

const supportedQodiAlgorithms = [
  'RSA-OAEP',
  'RSA-OAEP-SHA256',
  'RSA-OAEP-SHA384',
  'RSA-OAEP-SHA512',
] as const;

export const envSchema = z
  .object({
    QODI_PORT: z
      .string()
      .transform((value) => parseInt(value, 10))
      .pipe(z.number().min(1).max(65535))
      .optional()
      .default(8080),
    NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
    LOG_LEVEL: z
      .enum(['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .optional()
      .default('debug'),
    LOG_TYPE: z.enum(['json', 'pretty', 'hidden']).optional().default('pretty'),
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((value) => {
        if (!value) {
          return undefined;
        }

        if (value === '*') {
          return '*';
        }

        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

        return origins.length > 0 ? origins : undefined;
      }),
    TRUST_PROXY: z
      .string()
      .optional()
      .default('false')
      .transform((value) => {
        if (!value || value === 'false') {
          return false;
        }

        if (value === 'true') {
          return true;
        }

        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? false : parsed;
      }),
    QODI_AUTH_MODE: z.enum(['jwt-static', 'jwt-jwks', 'static-token']),
    QODI_ALGORITHM: z.enum(supportedQodiAlgorithms).optional().default('RSA-OAEP-SHA256'),
    QODI_CLOCK_SKEW_SECONDS: z
      .string()
      .transform((value) => parseInt(value, 10))
      .pipe(z.number().int().min(0))
      .optional()
      .default(0),
    QODI_PRIVATE_KEY_PATH: z.string().optional(),
    QODI_PRIVATE_KEY: z.string().optional(),
    QODI_PUBLIC_KEY_PATH: z.string().optional(),
    QODI_PUBLIC_KEY: z.string().optional(),
    QODI_STATIC_TOKEN: z.string().optional(),
    QODI_JWT_SECRET: z.string().optional(),
    QODI_JWT_ALGORITHM: z
      .enum(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512'])
      .optional()
      .default('HS256'),
    QODI_JWT_ISSUER: z.string().optional(),
    QODI_JWT_AUDIENCE: z.string().optional(),
    QODI_JWKS_URI: z.string().url().optional(),
    QODI_JWKS_CACHE_TTL: z
      .string()
      .transform((value) => parseInt(value, 10))
      .pipe(z.number().int().positive())
      .optional()
      .default(300),
    REQCAST_CONFIG: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.QODI_PRIVATE_KEY && !value.QODI_PRIVATE_KEY_PATH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either QODI_PRIVATE_KEY or QODI_PRIVATE_KEY_PATH must be set',
        path: ['QODI_PRIVATE_KEY'],
      });
    }

    if (!value.QODI_PUBLIC_KEY && !value.QODI_PUBLIC_KEY_PATH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either QODI_PUBLIC_KEY or QODI_PUBLIC_KEY_PATH must be set',
        path: ['QODI_PUBLIC_KEY'],
      });
    }

    if (value.QODI_AUTH_MODE === 'static-token' && !value.QODI_STATIC_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QODI_STATIC_TOKEN is required when QODI_AUTH_MODE=static-token',
        path: ['QODI_STATIC_TOKEN'],
      });
    }

    if (value.QODI_AUTH_MODE === 'jwt-static' && !value.QODI_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QODI_JWT_SECRET is required when QODI_AUTH_MODE=jwt-static',
        path: ['QODI_JWT_SECRET'],
      });
    }

    if (value.QODI_AUTH_MODE === 'jwt-jwks' && !value.QODI_JWKS_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QODI_JWKS_URI is required when QODI_AUTH_MODE=jwt-jwks',
        path: ['QODI_JWKS_URI'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
