import type { NextFunction, Request, Response } from 'express';

import { authService } from '../services/index';

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.authenticateRequest(req);
    next();
  } catch (error) {
    next(error);
  }
}
