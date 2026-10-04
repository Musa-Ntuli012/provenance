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

  // Missing schema: the API was started before migrations ran.
  if (err?.code === '42P01') {
    log('ERROR', '500 SCHEMA_NOT_INITIALIZED (run: npm run db:setup)');
    return res.status(500).json({
      error: {
        code: 'SCHEMA_NOT_INITIALIZED',
        message: 'The database schema is not initialized. Stop the API and run: npm run db:setup',
      },
    });
  }
  // The runtime role lacks its grants (bootstrap not run on this database).
  if (err?.code === '42501') {
    log('ERROR', '500 DB_PERMISSION (run: APP_ROLE_PASSWORD=... npm run db:bootstrap)');
    return res.status(500).json({
      error: {
        code: 'DB_PERMISSION',
        message: 'The runtime database role is missing permissions. Run: APP_ROLE_PASSWORD=<runtime password> npm run db:bootstrap',
      },
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
