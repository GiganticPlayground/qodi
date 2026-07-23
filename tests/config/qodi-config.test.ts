import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadQodiConfig } from '../../src/config/qodi-config';

let dir: string;
const write = (name: string, contents: string): string => {
  const p = join(dir, name);
  writeFileSync(p, contents);
  return p;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qodi-config-'));
  process.env.QODI_STATIC_TOKEN = 'internal-token-xyz';
  process.env.QODI_JWKS_URL = 'https://tw.example/.well-known/jwks.json';
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.QODI_STATIC_TOKEN;
  delete process.env.QODI_JWKS_URL;
});

void describe('loadQodiConfig', () => {
  void it('returns null when the file does not exist', () => {
    assert.equal(loadQodiConfig(join(dir, 'nope.yaml')), null);
  });

  void it('compiles a single static strategy with inline path scoping', () => {
    const p = write(
      'single.yaml',
      `auth:
  type: static
  token: \${env:QODI_STATIC_TOKEN}
  paths:
    whitelist:
      - /qodi/decrypt
`,
    );
    const cfg = loadQodiConfig(p);
    assert.ok(cfg);
    assert.equal(cfg.strategies.length, 1);
    assert.deepEqual(cfg.strategies[0], {
      mode: 'static',
      staticToken: 'internal-token-xyz',
      paths: { whitelist: ['/qodi/decrypt'] },
    });
  });

  void it('compiles a multi-strategy list (static + jwks), mapping YAML → lib options', () => {
    const p = write(
      'multi.yaml',
      `auth:
  - type: static
    token: \${env:QODI_STATIC_TOKEN}
  - type: jwks
    issuer: token-weaver
    jwks_url: \${env:QODI_JWKS_URL}
    requirements:
      - type: scope
        value: qodi:decrypt
`,
    );
    const cfg = loadQodiConfig(p);
    assert.ok(cfg);
    assert.equal(cfg.strategies.length, 2);
    assert.equal(cfg.strategies[0]?.mode, 'static');
    assert.deepEqual(cfg.strategies[1], {
      mode: 'jwt-jwks',
      jwksUri: 'https://tw.example/.well-known/jwks.json',
      issuer: 'token-weaver',
      requirements: [{ type: 'scope', value: 'qodi:decrypt' }],
    });
  });

  void it('maps hs256 secret and optional audience', () => {
    process.env.QODI_HS_SECRET = 'shared-secret';
    const p = write(
      'hs.yaml',
      `auth:
  type: hs256
  issuer: token-weaver
  audience: qodi-api
  secret: \${env:QODI_HS_SECRET}
`,
    );
    const cfg = loadQodiConfig(p);
    assert.deepEqual(cfg?.strategies[0], {
      mode: 'jwt-hs256',
      secret: 'shared-secret',
      issuer: 'token-weaver',
      audience: 'qodi-api',
    });
    delete process.env.QODI_HS_SECRET;
  });

  void it('throws when a referenced env var is unset', () => {
    const p = write(
      'missing-env.yaml',
      `auth:
  type: static
  token: \${env:DEFINITELY_NOT_SET_VAR}
`,
    );
    assert.throws(() => loadQodiConfig(p), /DEFINITELY_NOT_SET_VAR/);
  });

  void it('throws on an unknown strategy type', () => {
    const p = write(
      'bad-type.yaml',
      `auth:
  type: mtls
  token: x
`,
    );
    assert.throws(() => loadQodiConfig(p), /validation failed/i);
  });

  void it('throws on an empty strategies array', () => {
    const p = write('empty.yaml', `auth: []\n`);
    assert.throws(() => loadQodiConfig(p), /validation failed/i);
  });
});
