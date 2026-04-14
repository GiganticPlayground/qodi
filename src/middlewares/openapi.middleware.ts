import { existsSync } from 'fs';
import { join } from 'path';

import * as OpenApiValidator from 'express-openapi-validator';

function resolveOperationHandlersPath(): string {
  const sourcePath = join(process.cwd(), 'src/controllers');
  if (existsSync(sourcePath)) {
    return sourcePath;
  }

  return join(process.cwd(), 'dist/src/controllers');
}

export const createOpenApiValidatorMiddleware = (apiSpec: unknown) =>
  OpenApiValidator.middleware({
    apiSpec: apiSpec as string,
    validateApiSpec: true,
    validateRequests: true, // (default)
    validateResponses: false, // false by default
    operationHandlers: resolveOperationHandlersPath(),
  });
