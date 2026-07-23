import { readFileSync } from 'fs';
import { join } from 'path';

import { apiReference } from '@scalar/express-api-reference';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { createAuthMiddleware } from 'token-weaver/auth';
import YAML from 'yaml';

import { config } from './config/index';
import { loadQodiConfig } from './config/qodi-config';
import {
  authMiddleware,
  createOpenApiValidatorMiddleware,
  errorHandlerMiddleware,
  requestContextMiddleware,
} from './middlewares/index';
import { buildAnalytics, logger } from './utils/index';

export const apiSpecPath: string = join(process.cwd(), 'api/openapi.yaml');
const apiSpecContent: string = readFileSync(apiSpecPath, 'utf8');
const apiSpec = YAML.parse(apiSpecContent) as Record<string, unknown>;
const apiDocsCspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https:'],
  workerSrc: ["'self'", 'blob:'],
} as const;

const app = express();
app.set('trust proxy', config.TRUST_PROXY);

const corsOptions =
  !config.CORS_ORIGINS || config.CORS_ORIGINS === '*'
    ? undefined
    : {
        origin: config.CORS_ORIGINS,
      };

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestContextMiddleware);

const analytics = buildAnalytics();
if (analytics?.enabled) {
  app.use(analytics.middleware);
  logger.info('request analytics enabled');
}

app.use(
  '/api-docs',
  helmet({
    contentSecurityPolicy: {
      directives: apiDocsCspDirectives,
    },
  }),
  apiReference({
    content: apiSpec,
    theme: 'default',
    hideClientButton: true,
    showDeveloperTools: 'never',
    agent: {
      disabled: true,
    },
    mcp: {
      disabled: true,
    },
    telemetry: false,
  }),
);

// Auth selection (fail fast): a YAML config file (QODI_CONFIG_PATH) enables the shared
// token-weaver/auth middleware with one or more strategies; otherwise fall back to the
// env-driven single-mode auth (QODI_AUTH_MODE). One of the two must be configured.
const qodiConfig = loadQodiConfig(config.QODI_CONFIG_PATH);
let qodiAuth: RequestHandler;
if (qodiConfig) {
  qodiAuth = createAuthMiddleware({ strategies: qodiConfig.strategies });
  logger.info(
    `qodi auth: config file (${config.QODI_CONFIG_PATH}), ${qodiConfig.strategies.length} strateg${
      qodiConfig.strategies.length === 1 ? 'y' : 'ies'
    }`,
  );
} else if (config.QODI_AUTH_MODE) {
  qodiAuth = authMiddleware;
  logger.info(`qodi auth: env mode (${config.QODI_AUTH_MODE})`);
} else {
  throw new Error(
    `No authentication configured: set QODI_AUTH_MODE or provide a config file at ${config.QODI_CONFIG_PATH}`,
  );
}

app.use('/qodi', qodiAuth);
app.use(createOpenApiValidatorMiddleware(apiSpecPath));
app.use(errorHandlerMiddleware);

const server = app.listen(config.QODI_PORT, () => {
  logger.info(`Server is running on port ${config.QODI_PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  // Drain in-flight requests first so their analytics records get dispatched,
  // then flush/close the sinks before exiting.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (analytics) await analytics.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
