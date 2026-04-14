import { LOG_TYPES, createLogger } from 'logra';

import { config } from '../config/index';

const logStyleMap = {
  json: LOG_TYPES.JSON,
  pretty: LOG_TYPES.PRETTY,
  hidden: LOG_TYPES.HIDDEN,
} as const;

export const logger = createLogger('qodi', {
  level: config.LOG_LEVEL,
  style: logStyleMap[config.LOG_TYPE],
});
