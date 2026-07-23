/**
 * Optional YAML auth config for Qodi, modeled on ipb-nexus's `nexus.yaml`.
 *
 * When a config file is present it drives authentication via the shared
 * `token-weaver/auth` middleware and supports MULTIPLE strategies (tried in order,
 * first accept wins) — e.g. an internal static token AND client JWTs at once.
 * When absent, Qodi falls back to its env-var auth (`QODI_AUTH_MODE`).
 *
 * Auth only — crypto settings (algorithm, keys, clock skew, reqcast) stay env-driven.
 */
import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';

import type { AuthPaths, AuthStrategyOptions } from 'token-weaver/auth';
import YAML from 'yaml';
import { z } from 'zod';

/** Default config location; overridable via QODI_CONFIG_PATH (kept independent of the
 *  validated env module so the loader can be unit-tested without full env validation). */
const DEFAULT_CONFIG_PATH = process.env.QODI_CONFIG_PATH ?? 'config/qodi.yaml';

// --- YAML-facing schema (before env interpolation) ------------------------------

const requirementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scope'), value: z.string().min(1) }),
  z.object({
    type: z.literal('claim_includes'),
    claim: z.string().min(1),
    value: z.string().min(1),
  }),
]);

const pathsSchema = z.object({
  pathPrefix: z.string().optional(),
  whitelist: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
  whitelistClaim: z.string().min(1).optional(),
  blacklistClaim: z.string().min(1).optional(),
});

const jwksStrategySchema = z.object({
  type: z.literal('jwks'),
  issuer: z.string().min(1),
  audience: z.string().min(1).optional(),
  jwks_url: z.string().min(1),
  requirements: z.array(requirementSchema).optional(),
  paths: pathsSchema.optional(),
});

const hs256StrategySchema = z.object({
  type: z.literal('hs256'),
  issuer: z.string().min(1),
  audience: z.string().min(1).optional(),
  secret: z.string().min(1),
  requirements: z.array(requirementSchema).optional(),
  paths: pathsSchema.optional(),
});

const staticStrategySchema = z.object({
  type: z.literal('static'),
  token: z.string().min(1),
  paths: pathsSchema.optional(),
});

const strategySchema = z.discriminatedUnion('type', [
  jwksStrategySchema,
  hs256StrategySchema,
  staticStrategySchema,
]);

// `auth` accepts a single strategy or a non-empty array of them.
const configSchema = z.object({
  auth: z.union([strategySchema, z.array(strategySchema).min(1)]),
});

type RawStrategy = z.infer<typeof strategySchema>;

export interface QodiAuthConfig {
  strategies: AuthStrategyOptions[];
}

// --- Env interpolation ----------------------------------------------------------

/** Resolve `${env:NAME}` references in a config string; throws if the referenced var is unset. */
function resolveEnv(value: string, context: string): string {
  return value.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, (_match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined || resolved === '') {
      throw new Error(`Env var "${varName}" referenced in qodi config (${context}) is not set`);
    }
    return resolved;
  });
}

// --- Compile a raw strategy into the token-weaver/auth option shape -------------

type RawPaths = z.infer<typeof pathsSchema>;

/** Build a clean AuthPaths omitting undefined keys (qodi uses exactOptionalPropertyTypes). */
function compilePaths(raw: RawPaths | undefined): AuthPaths | undefined {
  if (!raw) return undefined;
  const paths: AuthPaths = {};
  if (raw.pathPrefix !== undefined) paths.pathPrefix = raw.pathPrefix;
  if (raw.whitelist !== undefined) paths.whitelist = raw.whitelist;
  if (raw.blacklist !== undefined) paths.blacklist = raw.blacklist;
  if (raw.whitelistClaim !== undefined) paths.whitelistClaim = raw.whitelistClaim;
  if (raw.blacklistClaim !== undefined) paths.blacklistClaim = raw.blacklistClaim;
  return paths;
}

function compileStrategy(raw: RawStrategy, ctx: string): AuthStrategyOptions {
  const paths = compilePaths(raw.paths);

  if (raw.type === 'static') {
    return {
      mode: 'static',
      staticToken: resolveEnv(raw.token, `${ctx}.token`),
      ...(paths ? { paths } : {}),
    };
  }

  const audience = raw.audience ? resolveEnv(raw.audience, `${ctx}.audience`) : undefined;
  const shared = {
    issuer: resolveEnv(raw.issuer, `${ctx}.issuer`),
    ...(audience !== undefined ? { audience } : {}),
    ...(raw.requirements ? { requirements: raw.requirements } : {}),
    ...(paths ? { paths } : {}),
  };

  if (raw.type === 'jwks') {
    return { mode: 'jwt-jwks', jwksUri: resolveEnv(raw.jwks_url, `${ctx}.jwks_url`), ...shared };
  }
  return { mode: 'jwt-hs256', secret: resolveEnv(raw.secret, `${ctx}.secret`), ...shared };
}

// --- Loader ---------------------------------------------------------------------

/**
 * Load the Qodi auth config. Returns `null` when no config file exists at
 * `QODI_CONFIG_PATH` (→ env-var auth fallback). Throws on a malformed file or an
 * unresolved `${env:…}` reference (fail fast).
 */
export function loadQodiConfig(configPath: string = DEFAULT_CONFIG_PATH): QodiAuthConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = readFileSync(configPath, 'utf8');
  const parsed: unknown =
    extname(configPath).toLowerCase() === '.json' ? JSON.parse(raw) : YAML.parse(raw);

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Qodi config validation failed (${configPath}):\n${issues}`);
  }

  const rawAuth = result.data.auth;
  const list = Array.isArray(rawAuth) ? rawAuth : [rawAuth];
  const strategies = list.map((entry, i) =>
    compileStrategy(entry, list.length > 1 ? `auth[${i}]` : 'auth'),
  );

  return { strategies };
}
