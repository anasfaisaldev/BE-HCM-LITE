import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export const notFound = (req, _res, next) => next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong on our side';
  let details;
  let code = 'INTERNAL_ERROR';

  if (err instanceof ApiError) ({ status, message, details, code } = err);
  else if (err instanceof ZodError) { status = 422; message = 'Validation failed'; code = 'VALIDATION_ERROR'; details = err.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })); }
  else if (err?.code === 11000) { status = 409; message = `Already exists: ${Object.keys(err.keyPattern || {}).join(', ') || 'duplicate value'}`; code = 'DUPLICATE'; }
  else if (err?.name === 'ValidationError') { status = 422; message = 'Validation failed'; code = 'VALIDATION_ERROR'; details = Object.values(err.errors).map((e) => ({ field: e.path, reason: e.message })); }
  else if (err?.name === 'CastError') { status = 422; message = `Invalid value for ${err.path}`; code = 'VALIDATION_ERROR'; }
  else if (err?.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body'; code = 'BAD_JSON'; }

  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}
