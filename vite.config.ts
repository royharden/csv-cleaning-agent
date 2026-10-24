import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run demo` = `vite --mode demo`, which loads the committed `.env.demo` (VITE_DEMO_MODE=1 only).
// Dev-server port: claim one through the agent-ports ledger before the first `npm run dev` (deferred).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
