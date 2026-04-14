import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from 'crypto';

import type { Request } from 'express';

import { config } from '../config/index';
import { HttpError, UpstreamUnavailableError } from '../utils/http-error';

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtPayload = {
  aud?: string | string[];
  exp?: number;
  iss?: string;
  nbf?: number;
  [key: string]: unknown;
};

type ParsedJwt = {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Buffer;
};

type JwksKey = JsonWebKey & {
  kid?: string;
};

type CachedJwks = {
  expiresAt: number;
  keys: Map<string, JwksKey>;
};

function base64UrlDecode(value: string): Buffer {
  const padding = (4 - (value.length % 4)) % 4;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding);
  return Buffer.from(normalized, 'base64');
}

function parseJwt(token: string): ParsedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new HttpError(401, 'Invalid bearer token');
  }

  const encodedHeader = parts[0]!;
  const encodedPayload = parts[1]!;
  const encodedSignature = parts[2]!;

  try {
    return {
      header: JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as JwtHeader,
      payload: JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as JwtPayload,
      signingInput: `${encodedHeader}.${encodedPayload}`,
      signature: base64UrlDecode(encodedSignature),
    };
  } catch {
    throw new HttpError(401, 'Invalid bearer token');
  }
}

function getBearerToken(req: Request): string {
  const authorization = req.header('authorization');
  if (!authorization) {
    throw new HttpError(401, 'Missing Authorization header');
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new HttpError(401, 'Authorization header must use Bearer auth');
  }

  return token;
}

function verifyAudience(
  expectedAudience: string,
  actualAudience: string | string[] | undefined,
): boolean {
  if (typeof actualAudience === 'string') {
    return actualAudience === expectedAudience;
  }

  if (Array.isArray(actualAudience)) {
    return actualAudience.includes(expectedAudience);
  }

  return false;
}

function verifyRegisteredClaims(payload: JwtPayload): void {
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === 'number' && now >= payload.exp) {
    throw new HttpError(401, 'Bearer token has expired');
  }

  if (typeof payload.nbf === 'number' && now < payload.nbf) {
    throw new HttpError(401, 'Bearer token is not yet valid');
  }

  if (config.QODI_JWT_ISSUER && payload.iss !== config.QODI_JWT_ISSUER) {
    throw new HttpError(401, 'Bearer token issuer is invalid');
  }

  if (config.QODI_JWT_AUDIENCE && !verifyAudience(config.QODI_JWT_AUDIENCE, payload.aud)) {
    throw new HttpError(401, 'Bearer token audience is invalid');
  }
}

function compareStaticToken(expectedToken: string, actualToken: string): boolean {
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(actualToken);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function getJwtHashAlgorithm(algorithm: string): 'sha256' | 'sha384' | 'sha512' {
  switch (algorithm) {
    case 'HS256':
    case 'RS256':
      return 'sha256';
    case 'HS384':
    case 'RS384':
      return 'sha384';
    case 'HS512':
    case 'RS512':
      return 'sha512';
    default:
      throw new HttpError(500, `Unsupported JWT algorithm: ${algorithm}`);
  }
}

function getJwtVerifyAlgorithm(algorithm: string): 'RSA-SHA256' | 'RSA-SHA384' | 'RSA-SHA512' {
  switch (algorithm) {
    case 'RS256':
      return 'RSA-SHA256';
    case 'RS384':
      return 'RSA-SHA384';
    case 'RS512':
      return 'RSA-SHA512';
    default:
      throw new HttpError(500, `Unsupported asymmetric JWT algorithm: ${algorithm}`);
  }
}

function verifyHmacJwt(parsed: ParsedJwt, secret: string): void {
  const expectedSignature = createHmac(getJwtHashAlgorithm(parsed.header.alg ?? ''), secret)
    .update(parsed.signingInput)
    .digest();

  if (
    expectedSignature.length !== parsed.signature.length ||
    !timingSafeEqual(expectedSignature, parsed.signature)
  ) {
    throw new HttpError(401, 'Bearer token signature is invalid');
  }
}

function verifyAsymmetricJwt(parsed: ParsedJwt, key: string | KeyObject): void {
  const algorithm = parsed.header.alg;
  if (!algorithm) {
    throw new HttpError(401, 'Bearer token is missing alg');
  }

  const verified = verifySignature(
    getJwtVerifyAlgorithm(algorithm),
    Buffer.from(parsed.signingInput),
    typeof key === 'string' ? createPublicKey(key) : key,
    parsed.signature,
  );

  if (!verified) {
    throw new HttpError(401, 'Bearer token signature is invalid');
  }
}

export class AuthService {
  private jwksCache: CachedJwks | null = null;

  async authenticateRequest(req: Request): Promise<void> {
    const token = getBearerToken(req);

    switch (config.QODI_AUTH_MODE) {
      case 'static-token':
        this.authenticateStaticToken(token);
        return;
      case 'jwt-static':
        this.authenticateStaticJwt(token);
        return;
      case 'jwt-jwks':
        await this.authenticateJwksJwt(token);
        return;
      default:
        throw new HttpError(500, 'Unsupported authentication mode');
    }
  }

  private authenticateStaticToken(token: string): void {
    if (!config.QODI_STATIC_TOKEN || !compareStaticToken(config.QODI_STATIC_TOKEN, token)) {
      throw new HttpError(401, 'Bearer token is invalid');
    }
  }

  private authenticateStaticJwt(token: string): void {
    if (!config.QODI_JWT_SECRET) {
      throw new HttpError(500, 'QODI_JWT_SECRET is required');
    }

    const parsed = parseJwt(token);
    if (parsed.header.alg !== config.QODI_JWT_ALGORITHM) {
      throw new HttpError(401, 'Bearer token algorithm is invalid');
    }

    if (config.QODI_JWT_ALGORITHM.startsWith('HS')) {
      verifyHmacJwt(parsed, config.QODI_JWT_SECRET);
    } else {
      verifyAsymmetricJwt(parsed, config.QODI_JWT_SECRET);
    }

    verifyRegisteredClaims(parsed.payload);
  }

  private async authenticateJwksJwt(token: string): Promise<void> {
    const parsed = parseJwt(token);
    if (!parsed.header.kid) {
      throw new HttpError(401, 'Bearer token is missing kid');
    }

    const jwk = await this.getJwkByKid(parsed.header.kid);
    verifyAsymmetricJwt(parsed, createPublicKey({ key: jwk, format: 'jwk' }));
    verifyRegisteredClaims(parsed.payload);
  }

  private async getJwkByKid(kid: string): Promise<JwksKey> {
    const cached = await this.getJwks(false);
    const existing = cached.keys.get(kid);
    if (existing) {
      return existing;
    }

    const refreshed = await this.getJwks(true);
    const afterRefresh = refreshed.keys.get(kid);
    if (!afterRefresh) {
      throw new HttpError(401, 'Bearer token key id is unknown');
    }

    return afterRefresh;
  }

  private async getJwks(forceRefresh: boolean): Promise<CachedJwks> {
    const now = Date.now();
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > now) {
      return this.jwksCache;
    }

    if (!config.QODI_JWKS_URI) {
      throw new HttpError(500, 'QODI_JWKS_URI is required');
    }

    let response: Awaited<ReturnType<typeof globalThis.fetch>>;
    try {
      response = await globalThis.fetch(config.QODI_JWKS_URI);
    } catch (error) {
      throw new UpstreamUnavailableError(
        `Unable to fetch JWKS document: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    if (!response.ok) {
      throw new UpstreamUnavailableError(`Unable to fetch JWKS document: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { keys?: JwksKey[] };
    if (!Array.isArray(payload.keys)) {
      throw new UpstreamUnavailableError('JWKS document is invalid');
    }

    const keys = new Map<string, JwksKey>();
    for (const key of payload.keys) {
      if (key.kid) {
        keys.set(key.kid, key);
      }
    }

    this.jwksCache = {
      expiresAt: now + config.QODI_JWKS_CACHE_TTL * 1000,
      keys,
    };

    return this.jwksCache;
  }
}
