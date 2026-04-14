import type { NextFunction } from 'express';

import { qodiService } from '../services/index';
import type { ApiRequest, ApiResponse } from '../types/api-helpers';

export const getPublicKey = async (
  _req: ApiRequest<'getPublicKey'>,
  res: ApiResponse<'getPublicKey'>,
  next: NextFunction,
): Promise<void> => {
  try {
    res.status(200).json(qodiService.getPublicKeyResponse());
  } catch (error) {
    next(error);
  }
};

export const postDecrypt = async (
  req: ApiRequest<'postDecrypt'>,
  res: ApiResponse<'postDecrypt'>,
  next: NextFunction,
): Promise<void> => {
  try {
    res.status(200).json(qodiService.decryptQodiPayload(req.body.qodiPayload));
  } catch (error) {
    next(error);
  }
};

export const getServerTime = async (
  _req: ApiRequest<'getServerTime'>,
  res: ApiResponse<'getServerTime'>,
  next: NextFunction,
): Promise<void> => {
  try {
    res.status(200).json(qodiService.getServerTime());
  } catch (error) {
    next(error);
  }
};
