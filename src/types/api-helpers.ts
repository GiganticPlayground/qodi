/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Type helpers for OpenAPI-first Express development
 *
 * These utilities extract types from the auto-generated OpenAPI schema
 * and provide developer-friendly type aliases for Express request handlers.
 *
 * @example
 * ```typescript
 * // Instead of complex nested types:
 * const handler = (req: Request<{}, any, operations["getUsers"]["requestBody"], ...>, res: Response) => {}
 *
 * // Use simple operation-based types:
 * const handler = (req: ApiRequest<'getUsers'>, res: ApiResponse<'getUsers'>) => {}
 * ```
 */

import type { Request, Response } from 'express';

import type { operations } from './schema';

// ============================================
// INDIVIDUAL TYPE EXTRACTORS
// ============================================

/**
 * Extract path parameters for an OpenAPI operation
 *
 * Falls back to empty object if the operation has no path parameters.
 *
 * @example
 * ```typescript
 * type Params = PathParams<'getUserById'>;  // { id: string }
 * type NoParams = PathParams<'getUsers'>;   // Record<string, never>
 * ```
 */
export type PathParams<T extends keyof operations> = operations[T] extends {
  parameters: { path: infer P };
}
  ? P
  : Record<string, never>;

/**
 * Extract query parameters for an OpenAPI operation
 *
 * Falls back to empty object if the operation has no query parameters.
 *
 * @example
 * ```typescript
 * type Query = QueryParams<'getUsers'>;  // { limit?: number; page?: number }
 * ```
 */
export type QueryParams<T extends keyof operations> = operations[T] extends {
  parameters: { query: infer Q };
}
  ? Q
  : Record<string, never>;

/**
 * Extract request body type for an OpenAPI operation
 *
 * Handles the nested content/application-json structure automatically.
 * Falls back to undefined if the operation has no request body.
 *
 * @example
 * ```typescript
 * type Body = RequestBody<'createUser'>;  // UserCreate
 * type NoBody = RequestBody<'getUsers'>;  // undefined
 * ```
 */
export type RequestBody<T extends keyof operations> = operations[T] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : undefined;

/**
 * Extract response body type for an OpenAPI operation and status code
 *
 * Falls back to void if the response has no content (e.g., 204 No Content).
 *
 * @example
 * ```typescript
 * type Response200 = ResponseBody<'getUsers', 200>;     // { data?: User[]; total?: number; ... }
 * type Response204 = ResponseBody<'deleteUser', 204>;   // void
 * type Response404 = ResponseBody<'getUserById', 404>;  // Error
 * ```
 */
export type ResponseBody<
  T extends keyof operations,
  Status extends number = 200,
> = operations[T] extends {
  responses: {
    [K in Status]: { content: { 'application/json': infer R } };
  };
}
  ? R
  : void;

// ============================================
// TYPED REQUEST AND RESPONSE HELPERS
// ============================================

/**
 * Fully typed Express Request for an OpenAPI operation
 *
 * Automatically extracts and applies the correct types for:
 * - Path parameters (req.params)
 * - Query parameters (req.query)
 * - Request body (req.body)
 *
 * @example
 * ```typescript
 * export const getUsers = async (
 *   req: ApiRequest<'getUsers'>,
 *   res: ApiResponse<'getUsers'>,
 *   next: NextFunction
 * ): Promise<void> => {
 *   // req.query is typed as { limit?: number; page?: number }
 *   const { limit, page } = req.query;
 * };
 *
 * export const getUserById = async (
 *   req: ApiRequest<'getUserById'>,
 *   res: ApiResponse<'getUserById'>,
 *   next: NextFunction
 * ): Promise<void> => {
 *   // req.params is typed as { id: string }
 *   const { id } = req.params;
 * };
 * ```
 */
export type ApiRequest<T extends keyof operations> = Request<
  PathParams<T>,
  any,
  RequestBody<T>,
  QueryParams<T>
>;

/**
 * Fully typed Express Response for an OpenAPI operation
 *
 * Types the response body based on the operation and status code.
 * Defaults to status code 200 if not specified.
 *
 * @example
 * ```typescript
 * export const createUser = async (
 *   req: ApiRequest<'createUser'>,
 *   res: ApiResponse<'createUser', 201>,  // Response type for 201 status
 *   next: NextFunction
 * ): Promise<void> => {
 *   // res.json() expects User type
 *   res.status(201).json(newUser);
 * };
 * ```
 */
export type ApiResponse<T extends keyof operations, Status extends number = 200> = Response<
  ResponseBody<T, Status>
>;

// ============================================
// OPERATION TYPE BUNDLE (ADVANCED USAGE)
// ============================================

/**
 * Complete type information bundle for an operation
 *
 * Useful when you need to extract multiple types from the same operation
 * or when building utilities that work with operation metadata.
 *
 * @example
 * ```typescript
 * type GetUsersOp = Operation<'getUsers'>;
 * // {
 * //   pathParams: Record<string, never>;
 * //   queryParams: { limit?: number; page?: number };
 * //   requestBody: undefined;
 * //   response200: { data?: User[]; total?: number; page?: number; limit?: number };
 * //   response201: void;
 * //   response400: void;
 * //   response404: void;
 * // }
 * ```
 */
export type Operation<T extends keyof operations> = {
  pathParams: PathParams<T>;
  queryParams: QueryParams<T>;
  requestBody: RequestBody<T>;
  response200: ResponseBody<T, 200>;
  response201: ResponseBody<T, 201>;
  response400: ResponseBody<T, 400>;
  response404: ResponseBody<T, 404>;
  response500: ResponseBody<T, 500>;
};
