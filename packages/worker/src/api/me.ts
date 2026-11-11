import { Hono } from 'hono';
import type { AppEnv } from '../auth/access';

// Task 2 ships only GET /; Task 3 builds out the rest of the Me API here.
export const me = new Hono<AppEnv>();

me.get('/', (c) => {
  const { id, email, username, isAdmin, settings } = c.var.user;
  return c.json({ id, email, username, isAdmin, settings });
});
