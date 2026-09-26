
export class AppError extends Error {
  constructor(status, code, message, { details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'VALIDATION_FAILED', msg, { details });
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg) => new AppError(409, 'CONFLICT', msg);
