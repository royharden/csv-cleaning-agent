// ESLint flat config (PLAN.md M1). Runs only after an authorized `npm install` (deferred, Dirty Mode).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'data/external/**', 'results/**', 'supabase/functions/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render model and file text as escaped text (PLAN.md M4 AC2).',
        },
        {
          selector: 'TSEnumDeclaration',
          message: 'Erasable TypeScript only (PLAN.md row 18): use a const array/object and a union type.',
        },
        {
          selector: "TSModuleDeclaration[kind='namespace']",
          message: 'Erasable TypeScript only (PLAN.md row 18): no namespaces.',
        },
        {
          selector: 'TSParameterProperty',
          message: 'Erasable TypeScript only (PLAN.md row 18): no parameter properties.',
        },
        {
          selector: 'TSImportEqualsDeclaration',
          message: 'Erasable TypeScript only (PLAN.md row 18): no `import x = require()`.',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
