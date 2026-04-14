import { randomUUID } from 'crypto';

import type { NextFunction, Request, Response } from 'express';
import { addLogContext, runLogContext } from 'logra';

import { logger } from '../utils/index';

function getRouteGroup(path: string): string | null {
  if (path.startsWith('/qodi/')) {
    return 'qodi';
  }

  if (path === '/health') {
    return 'health';
  }

  return null;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header('x-request-id') ?? randomUUID();
  const startedAt = Date.now();

  runLogContext(() => {
    addLogContext('requestId', requestId);
    addLogContext('method', req.method);
    addLogContext('path', req.path);
    addLogContext('routeGroup', getRouteGroup(req.path));
    addLogContext('ip', req.ip);

    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      logger.info('request completed', {
        durationMs: Date.now() - startedAt,
        statusCode: res.statusCode,
      });
    });

    next();
  });
}
