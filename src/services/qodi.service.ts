import { constants, createPrivateKey, createPublicKey, privateDecrypt } from 'crypto';
import { readFileSync } from 'fs';

import { config } from '../config/index';
import { HttpError } from '../utils/http-error';

type DecryptedPayload = {
  data: unknown;
  exp: number;
};

type InvalidDecryptResponse = {
  success: false;
  error: 'TOKEN_INVALID';
};

type SuccessDecryptResponse = {
  success: true;
  data: unknown;
  exp: number;
};

function loadPem(
  inlineValue: string | undefined,
  filePath: string | undefined,
  label: string,
): string {
  if (inlineValue) {
    return inlineValue;
  }

  if (filePath) {
    return readFileSync(filePath, 'utf8');
  }

  throw new HttpError(500, `${label} is required`);
}

function resolveOaepHash(algorithm: string): string {
  switch (algorithm) {
    case 'RSA-OAEP':
      return 'sha1';
    case 'RSA-OAEP-SHA256':
      return 'sha256';
    case 'RSA-OAEP-SHA384':
      return 'sha384';
    case 'RSA-OAEP-SHA512':
      return 'sha512';
    default:
      throw new HttpError(
        500,
        `Unsupported QODI_ALGORITHM: ${algorithm}. Supported values: RSA-OAEP, RSA-OAEP-SHA256, RSA-OAEP-SHA384, RSA-OAEP-SHA512`,
      );
  }
}

function parsePayload(value: string): DecryptedPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return null;
    }

    if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp)) {
      return null;
    }

    return {
      data: payload.data,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export class QodiService {
  private readonly publicKeyPem = loadPem(
    config.QODI_PUBLIC_KEY,
    config.QODI_PUBLIC_KEY_PATH,
    'QODI public key',
  );

  private readonly privateKey = createPrivateKey(
    loadPem(config.QODI_PRIVATE_KEY, config.QODI_PRIVATE_KEY_PATH, 'QODI private key'),
  );

  private readonly publicKey = createPublicKey(this.publicKeyPem);

  private readonly oaepHash = resolveOaepHash(config.QODI_ALGORITHM);

  getPublicKeyResponse(): { publicKey: string; algorithm: typeof config.QODI_ALGORITHM } {
    return {
      publicKey: this.publicKey
        .export({
          type: 'spki',
          format: 'pem',
        })
        .toString(),
      algorithm: config.QODI_ALGORITHM,
    };
  }

  decryptQodiPayload(qodiPayload: string): SuccessDecryptResponse | InvalidDecryptResponse {
    try {
      const ciphertext = Buffer.from(qodiPayload, 'base64');
      if (ciphertext.length === 0) {
        return {
          success: false,
          error: 'TOKEN_INVALID',
        };
      }

      const decrypted = privateDecrypt(
        {
          key: this.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: this.oaepHash,
        },
        ciphertext,
      );

      const payload = parsePayload(decrypted.toString('utf8'));
      if (!payload) {
        return {
          success: false,
          error: 'TOKEN_INVALID',
        };
      }

      const now = Math.floor(Date.now() / 1000);
      if (now >= payload.exp + config.QODI_CLOCK_SKEW_SECONDS) {
        return {
          success: false,
          error: 'TOKEN_INVALID',
        };
      }

      return {
        success: true,
        data: payload.data,
        exp: payload.exp,
      };
    } catch {
      return {
        success: false,
        error: 'TOKEN_INVALID',
      };
    }
  }

  getServerTime(): { epochMs: number; iso: string } {
    const now = new Date();
    return {
      epochMs: now.getTime(),
      iso: now.toISOString(),
    };
  }
}
