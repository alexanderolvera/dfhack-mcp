import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'cache/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Source: strict TypeScript.
    files: ['src/**/*.ts'],
    rules: {
      // DFHack JSON crosses the boundary untyped; parsed query results are `any`
      // by nature and re-typed at the tool layer, so allow pragmatic `any` here.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Harness scripts + build config: plain JS/TS run under Node.
    files: ['scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
  prettier
);
