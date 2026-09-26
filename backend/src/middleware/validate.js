import { badRequest } from '../lib/errors.js';

/** Zod validation middleware, parses { body, query, params } per schema. */
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body ?? {},
      query: req.query ?? {},
      params: req.params ?? {},
    });
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: [i.path[0], ...i.path.slice(1)].join('.'),
        message: i.message,
      }));
      return next(badRequest('Please check the highlighted fields', details));
    }
    req.data = result.data;
    next();
  };
}
