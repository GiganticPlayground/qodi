import { existsSync } from 'node:fs';

import { createAnalytics, loadConfig, type AnalyticsHandle } from 'reqcast';

import { logger } from './logger';
import { config } from '../config/index';

/** Loads reqcast.config.json (or REQCAST_CONFIG). Returns null if no config file is present. */
export function buildAnalytics(): AnalyticsHandle | null {
  const path = config.REQCAST_CONFIG ?? './reqcast.config.json';
  if (!config.REQCAST_CONFIG && !existsSync(path)) {
    return null;
  }
  const reqcastConfig = loadConfig(path);
  return createAnalytics(reqcastConfig, {
    logger,
    onError: (err, sinkName) => logger.error('analytics sink error', { sinkName, err }),
  });
}
