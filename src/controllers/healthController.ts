import type { NextFunction, Request, Response } from 'express';

/**
 * Health check endpoint
 *
 * @route GET /health
 */
export const getHealth = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'qodi',
    });
  } catch (error) {
    next(error);
  }
};
