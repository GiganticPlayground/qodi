import assert from 'node:assert/strict';
import {
  constants,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  sign,
  type JsonWebKey,
} from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';

type RunningService = {
  port: number;
  process: ChildProcessWithoutNullStreams;
  url: string;
};

const supportedQodiAlgorithms = [
  'RSA-OAEP',
  'RSA-OAEP-SHA256',
  'RSA-OAEP-SHA384',
  'RSA-OAEP-SHA512',
] as const;

type SupportedQodiAlgorithm = (typeof supportedQodiAlgorithms)[number];

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createHs256Jwt(
  secret: string,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function createRs256Jwt(
  privateKeyPem: string,
  payload: Record<string, unknown>,
  kid?: string,
): string {
  const encodedHeader = encodeBase64Url(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
      ...(kid ? { kid } : {}),
    }),
  );
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function encryptQodiPayload(
  publicKeyPem: string,
  payload: Record<string, unknown>,
  algorithm: SupportedQodiAlgorithm = 'RSA-OAEP-SHA256',
): string {
  const oaepHash =
    algorithm === 'RSA-OAEP'
      ? 'sha1'
      : algorithm === 'RSA-OAEP-SHA384'
        ? 'sha384'
        : algorithm === 'RSA-OAEP-SHA512'
          ? 'sha512'
          : 'sha256';
  const ciphertext = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash,
    },
    Buffer.from(JSON.stringify(payload), 'utf8'),
  );

  return ciphertext.toString('base64');
}

async function findOpenPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate port'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore startup failures and retry
    }

    await delay(200);
  }

  throw new Error(`Service did not become healthy at ${url}`);
}

async function startService(extraEnv: Record<string, string>): Promise<RunningService> {
  const port = await findOpenPort();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_TYPE: 'hidden',
    LOG_LEVEL: 'error',
    QODI_PORT: String(port),
    ...extraEnv,
  };

  const child = spawn('node', ['--import=tsx', 'src/index.ts'], {
    cwd: process.cwd(),
    env,
    stdio: 'pipe',
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Qodi test service exited with code ${code}\n${stderr}`);
    }
  });

  const service = {
    port,
    process: child,
    url: `http://127.0.0.1:${port}`,
  };

  try {
    await waitForHealth(service.url);
    return service;
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

async function stopService(service: RunningService): Promise<void> {
  if (service.process.killed || service.process.exitCode !== null) {
    return;
  }

  service.process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => {
      service.process.once('exit', () => resolve());
    }),
    delay(5_000).then(() => {
      service.process.kill('SIGKILL');
    }),
  ]);
}

async function startJwksServer(jwks: object): Promise<{ server: Server; url: string }> {
  const port = await findOpenPort();
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jwks));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  return {
    server,
    url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
  };
}

const qodiKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

test('qodi end-to-end flows', async (t) => {
  await t.test('all supported QODI_ALGORITHM values decrypt successfully', async (t) => {
    for (const algorithm of supportedQodiAlgorithms) {
      await t.test(algorithm, async () => {
        const service = await startService({
          QODI_AUTH_MODE: 'static-token',
          QODI_STATIC_TOKEN: 'static-secret',
          QODI_ALGORITHM: algorithm,
          QODI_PRIVATE_KEY: qodiKeys.privateKey,
          QODI_PUBLIC_KEY: qodiKeys.publicKey,
        });

        try {
          const headers = {
            Authorization: 'Bearer static-secret',
          };

          const publicKeyResponse = await fetch(`${service.url}/qodi/publickey`, { headers });
          assert.equal(publicKeyResponse.status, 200);
          const publicKeyPayload = (await publicKeyResponse.json()) as {
            publicKey: string;
            algorithm: string;
          };
          assert.equal(publicKeyPayload.algorithm, algorithm);

          const exp = Math.floor(Date.now() / 1000) + 120;
          const qodiPayload = encryptQodiPayload(
            publicKeyPayload.publicKey,
            {
              data: {
                algorithm,
                purpose: 'e2e-coverage',
              },
              exp,
            },
            algorithm,
          );

          const decryptResponse = await fetch(`${service.url}/qodi/decrypt`, {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ qodiPayload }),
          });

          assert.equal(decryptResponse.status, 200);
          assert.deepEqual(await decryptResponse.json(), {
            success: true,
            data: {
              algorithm,
              purpose: 'e2e-coverage',
            },
            exp,
          });
        } finally {
          await stopService(service);
        }
      });
    }
  });

  await t.test('static-token auth: public key, server time, decrypt success, decrypt expiry, unauthorized', async () => {
    const service = await startService({
      QODI_AUTH_MODE: 'static-token',
      QODI_STATIC_TOKEN: 'static-secret',
      QODI_ALGORITHM: 'RSA-OAEP-SHA256',
      QODI_PRIVATE_KEY: qodiKeys.privateKey,
      QODI_PUBLIC_KEY: qodiKeys.publicKey,
    });

    try {
      const unauthenticatedResponse = await fetch(`${service.url}/qodi/publickey`);
      assert.equal(unauthenticatedResponse.status, 401);

      const headers = {
        Authorization: 'Bearer static-secret',
      };

      const publicKeyResponse = await fetch(`${service.url}/qodi/publickey`, { headers });
      assert.equal(publicKeyResponse.status, 200);
      const publicKeyPayload = (await publicKeyResponse.json()) as {
        publicKey: string;
        algorithm: string;
      };
      assert.equal(publicKeyPayload.algorithm, 'RSA-OAEP-SHA256');
      assert.match(publicKeyPayload.publicKey, /BEGIN PUBLIC KEY/);

      const serverTimeResponse = await fetch(`${service.url}/qodi/servertime`, { headers });
      assert.equal(serverTimeResponse.status, 200);
      const serverTimePayload = (await serverTimeResponse.json()) as {
        epochMs: number;
        iso: string;
      };
      assert.equal(typeof serverTimePayload.epochMs, 'number');
      assert.ok(serverTimePayload.epochMs > 1_000_000_000_000);
      assert.match(serverTimePayload.iso, /\d{4}-\d{2}-\d{2}T/);

      const validExp = Math.floor(Date.now() / 1000) + 120;
      const validQodiPayload = encryptQodiPayload(publicKeyPayload.publicKey, {
        data: { badgeId: 'guest-42', venue: 'hall-a' },
        exp: validExp,
      });

      const decryptSuccess = await fetch(`${service.url}/qodi/decrypt`, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ qodiPayload: validQodiPayload }),
      });
      assert.equal(decryptSuccess.status, 200);
      assert.deepEqual(await decryptSuccess.json(), {
        success: true,
        data: { badgeId: 'guest-42', venue: 'hall-a' },
        exp: validExp,
      });

      const expiredExp = Math.floor(Date.now() / 1000) - 5;
      const expiredQodiPayload = encryptQodiPayload(publicKeyPayload.publicKey, {
        data: { badgeId: 'expired' },
        exp: expiredExp,
      });

      const decryptExpired = await fetch(`${service.url}/qodi/decrypt`, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ qodiPayload: expiredQodiPayload }),
      });
      assert.equal(decryptExpired.status, 200);
      assert.deepEqual(await decryptExpired.json(), {
        success: false,
        error: 'PAYLOAD_INVALID',
      });
    } finally {
      await stopService(service);
    }
  });

  await t.test('jwt-static auth accepts HS256 bearer token', async () => {
    const jwtSecret = 'jwt-static-secret';
    const service = await startService({
      QODI_AUTH_MODE: 'jwt-static',
      QODI_JWT_SECRET: jwtSecret,
      QODI_JWT_ALGORITHM: 'HS256',
      QODI_JWT_ISSUER: 'https://issuer.example.test/',
      QODI_JWT_AUDIENCE: 'qodi-tests',
      QODI_PRIVATE_KEY: qodiKeys.privateKey,
      QODI_PUBLIC_KEY: qodiKeys.publicKey,
    });

    try {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createHs256Jwt(jwtSecret, {
        iss: 'https://issuer.example.test/',
        aud: 'qodi-tests',
        sub: 'tester',
        exp: now + 120,
      });

      const response = await fetch(`${service.url}/qodi/publickey`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { algorithm: string };
      assert.equal(body.algorithm, 'RSA-OAEP-SHA256');
    } finally {
      await stopService(service);
    }
  });

  await t.test('jwt-jwks auth accepts RS256 bearer token resolved through JWKS', async () => {
    const authKeys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    const jwk = createPublicKey(authKeys.publicKey).export({
      format: 'jwk',
    }) as JsonWebKey;

    const kid = 'jwks-test-key';
    const jwksServer = await startJwksServer({
      keys: [
        {
          ...jwk,
          kid,
          use: 'sig',
          alg: 'RS256',
        },
      ],
    });

    const service = await startService({
      QODI_AUTH_MODE: 'jwt-jwks',
      QODI_JWKS_URI: jwksServer.url,
      QODI_JWT_ISSUER: 'https://issuer.example.test/',
      QODI_JWT_AUDIENCE: 'qodi-tests',
      QODI_PRIVATE_KEY: qodiKeys.privateKey,
      QODI_PUBLIC_KEY: qodiKeys.publicKey,
    });

    try {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createRs256Jwt(authKeys.privateKey, {
        iss: 'https://issuer.example.test/',
        aud: 'qodi-tests',
        sub: 'tester',
        exp: now + 120,
      }, kid);

      const response = await fetch(`${service.url}/qodi/publickey`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { publicKey: string };
      assert.match(body.publicKey, /BEGIN PUBLIC KEY/);
    } finally {
      await stopService(service);
      await new Promise<void>((resolve, reject) => {
        jwksServer.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
