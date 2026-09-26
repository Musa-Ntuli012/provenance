import { z } from 'zod';

export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address');
export const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');
export const uuidField = z.string().uuid();
export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Lowercase letters, numbers and hyphens only');
