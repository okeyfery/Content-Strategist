import { createApiApp } from '../server.ts';

const app = createApiApp();

export const config = {
  maxDuration: 60,
};

export default app;
