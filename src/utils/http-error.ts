export class HttpError extends Error {
  status: number;
  errors?: unknown;

  constructor(status: number, message: string, errors?: unknown) {
    super(message);
    this.name = 'HTTP_ERROR';
    this.status = status;
    this.errors = errors;
  }
}

export class UpstreamUnavailableError extends HttpError {
  constructor(message = 'Upstream service unavailable') {
    super(503, message);
    this.name = 'UPSTREAM_UNAVAILABLE';
  }
}
