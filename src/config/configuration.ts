import { config as loadDotenv } from 'dotenv';

import { envSchema, type Env } from './env.validation';

// Load environment variables from .env file
loadDotenv();

/**
 * Validates environment variables against the defined schema.
 *
 * @throws {Error} If validation fails, with a detailed error message
 * @returns {Env} Validated and type-safe environment configuration
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Environment variable validation failed:\n${errorMessages}\n\nPlease check your .env file or environment configuration.`,
    );
  }

  return result.data;
}
