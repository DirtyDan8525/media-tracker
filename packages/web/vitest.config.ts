import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects: the existing import/backfill logic tests run in node; the React app tests
// (src/**/*.test.ts(x)) run in jsdom with Testing Library and an in-memory IndexedDB.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', environment: 'node', include: ['test/**/*.test.ts'] } },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
