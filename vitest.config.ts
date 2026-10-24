import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Default environment is node (core is pure and browser/Node-safe). UI tests (M4) opt into jsdom
// with a `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
