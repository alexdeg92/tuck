import js from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Code held to the full type-safety rule set (except explicit-module-boundary-types,
 * which stays on api/contracts only — web UI exports are numerous and presentational).
 * Test files stay off this list so fixture casts remain readable.
 */
const STRICT_TS = [
  'apps/api/**/*.ts',
  'packages/*/src/**/*.ts',
  'apps/web/src/**/*.{ts,tsx}',
  'e2e/**/*.ts',
];
const EXPLICIT_EXPORTS = ['apps/api/src/**/*.ts', 'packages/*/src/**/*.ts'];

export default tseslint.config(
  { ignores: ['**/dist/', '**/coverage/', '**/playwright-report/', '**/test-results/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Synchronous adapters (SQLite, memory) implement async ports; `async` turns throws into rejections.
      '@typescript-eslint/require-await': 'off',
      // Express recognises error middleware by arity, so unused leading params stay, prefixed with _.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // CSS modules: naming only — no TS project service parse.
    files: ['**/*.css'],
    extends: [tseslint.configs.disableTypeChecked],
    processor: checkFile.processors['eslint-processor-check-file'],
  },
  {
    files: STRICT_TS,
    ignores: ['**/*.test.{ts,tsx}', '**/test/**'],
    rules: {
      // A switch over a closed union (TaskStatus, ApiErrorCode, HTTP method) must handle every member.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // No truthiness on string | undefined or numbers: say `!== undefined` or `!== ''`.
      '@typescript-eslint/strict-boolean-expressions': 'error',
      // `as` may not narrow a type; parse or guard instead (one documented exception in route()).
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    },
  },
  {
    files: EXPLICIT_EXPORTS,
    ignores: ['**/*.test.ts'],
    rules: {
      // Exported functions declare what they return, so no inferred `| undefined` leaks out.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    files: ['apps/api/src/modules/**/http/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(json|send)$/]',
          message:
            'Answer through route(router, endpoint, …) so the reply is parsed against the contract.',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/shared/api/http.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Use call(endpoints.x, …) from shared/api/http.',
        },
      ],
      // No native browser UI: every control is custom and styled with the design tokens. Closes the
      // ordinary-syntax routes too: braced/template/conditional types, any element's type prop
      // (our Input forwards it), createElement, and alert/confirm/prompt off any global.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'No native <select>: use the custom Select (shared/ui/Select).',
        },
        {
          selector:
            "JSXAttribute[name.name='type'] :matches(Literal[value=/^(date|time|datetime-local|month|week|color)$/], TemplateElement[value.cooked=/^(date|time|datetime-local|month|week|color)$/])",
          message: 'No native date/time/colour picker: use the custom DatePicker (shared/ui).',
        },
        {
          selector:
            "CallExpression:matches([callee.name='createElement'], [callee.property.name='createElement']) > Literal.arguments:first-child[value='select']",
          message: 'No native <select> by createElement: use the custom Select (shared/ui/Select).',
        },
        {
          selector:
            'MemberExpression[object.name=/^(window|globalThis|self)$/]:matches([property.name=/^(alert|confirm|prompt)$/], [property.value=/^(alert|confirm|prompt)$/])',
          message: 'No native alert/confirm/prompt: use the styled Dialog or a toast.',
        },
        {
          selector: 'CallExpression[callee.name=/^(alert|confirm|prompt)$/]',
          message: 'No native alert/confirm/prompt: use the styled Dialog or a toast.',
        },
      ],
    },
  },
  // check-file patterns must not overlap: the rule evaluates every matching glob.
  {
    files: [
      'apps/web/src/**/{components,pages,ui}/**/*.{tsx,css}',
      'apps/web/src/app/App.tsx',
      'apps/web/src/app/App.test.tsx',
    ],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{tsx,css}': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { '**/src/**/': 'CAMEL_CASE' }],
    },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/**/{components,pages,ui}/**',
      'apps/web/src/app/App.tsx',
      'apps/web/src/app/App.test.tsx',
    ],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'CAMEL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { '**/src/**/': 'CAMEL_CASE' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
  },
);
