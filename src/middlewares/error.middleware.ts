import { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/index';

interface CustomError extends Error {
  status?: number;
  errors?: unknown;
}

interface ExpressHandler<T extends Error> {
  (err: T, req: Request, res: Response, next: NextFunction): void;
}

export const errorHandlerMiddleware: ExpressHandler<CustomError> = (err, _req, res, _next) => {
  logger.error('Request error', err);

  if (err.status === 400 && err.errors) {
    return res.status(400).json({
      message: 'Validation error',
      errors: err.errors,
    });
  }

  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      message: err.message || 'Request failed',
      ...(err.name ? { code: err.name } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }

  if (err.status === 503) {
    return res.status(503).json({
      message: err.message || 'Service unavailable',
      code: err.name || 'SERVICE_UNAVAILABLE',
    });
  }

  return res.status(500).json({
    message: 'Internal server error',
  });
};
