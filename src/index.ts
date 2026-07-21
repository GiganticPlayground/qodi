import { readFileSync } from 'fs';
import { join } from 'path';

import { apiReference } from '@scalar/express-api-reference';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import YAML from 'yaml';

import { config } from './config/index';
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

app.use('/qodi', authMiddleware);
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
