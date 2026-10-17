import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-lambda/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/cdk.out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use a const array plus a Zod enum instead of a TypeScript enum.',
        },
      ],
    },
  },
  {
    // @c32/core must stay pure: no I/O, no AWS, no Express, no Node built-ins (ADR 3).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'core must not use Node built-ins.' },
            { group: ['fs', 'path', 'crypto', 'http', 'os'], message: 'core must not do I/O.' },
            { group: ['@aws-sdk/*', 'aws-*'], message: 'core must not depend on AWS.' },
            { group: ['express', 'express/*'], message: 'core must not depend on Express.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require'],
    },
  },
  {
    // Plain Node build scripts.
    files: ['**/scripts/**/*.mjs', 'docs/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
