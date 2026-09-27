// ESLint flat config (v9+)
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Игнорируем служебное
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'agent/data/**',
      'projects/**',
      'tmp/**',
      'logs/**',
      '.husky/**',
      'dist/**',
    ],
  },

  // База — recommended
  js.configs.recommended,

  // Настройки для продакшн-кода
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Осознанные предупреждения
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': 'off',           // бот пишет в stdout — это ок
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Стиль (минимальный, без фанатизма)
      'eqeqeq': ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // Тестовые файлы — vitest-глобалы + свободнее
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        // vitest-глобалы, если используем без импорта (у нас импорт, но на всякий)
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',        // в тестах бывает мок-параметр не нужен
    },
  },
];
