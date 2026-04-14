import { validateEnv } from './configuration';

/**
 * Validated environment configuration.
 *
 * This is evaluated immediately when the module is imported,
 * ensuring that the application fails fast on startup if
 * environment variables are missing or invalid.
 */
export const config = validateEnv();

// Re-export types for convenience
export type { Env } from './env.validation';
