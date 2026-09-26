import { AppError } from '../lib/errors.js';

const log = (level, message, meta) => {
  const line = `${new Date().toISOString()} ${level} ${message}`;
  if (meta !== undefined) console[level === 'ERROR' ? 'error' : 'log'](line, meta);
  else console[level === 'ERROR' ? 'error' : 'log'](line);
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

/** Unexpected failures: full detail server-side only; generic message out. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    log('WARN', `${err.status} ${err.code} ${req.method} ${req.path}`, err.details ?? undefined);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Multer size/type failures surface as generic errors, treat as bad input.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the 15 MB limit' },
    });
  }
  if (err?.name === 'PayloadTooLargeError') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
  }

  log('ERROR', `500 INTERNAL ${req.method} ${req.path}`, {
    message: err?.message,
    stack: err?.stack,
  });
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' },
  });
}
