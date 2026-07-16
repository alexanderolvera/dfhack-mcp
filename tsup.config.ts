import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Ship a directly-runnable CLI: the stdio server is the bin entry.
  banner: { js: '#!/usr/bin/env node' },
  // Don't bundle runtime deps — they're installed alongside dist/.
  external: ['dfhack-remote-node', '@modelcontextprotocol/sdk'],
});
