import { defineConfig } from 'tsup';
import { cp } from 'node:fs/promises';

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
  // The query layer is REAL .lua files loaded at runtime relative to the bundle
  // (dfclient computes dist/dfhack-queries/ via import.meta.url), so copy them
  // into the build output. Without this, the built server can't find the scripts.
  async onSuccess() {
    await cp('src/dfhack-queries', 'dist/dfhack-queries', {
      recursive: true,
      filter: (src) => !src.endsWith('.ts'),
    });
  },
});
