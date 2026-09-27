import { defineConfig } from 'vitest/config';

/**
 * Coverage ratchet strategy:
 * - `include` содержит ТОЛЬКО модули, у которых уже есть тесты.
 * - По мере написания тестов новые модули добавляются в `include`.
 * - Порог 80% применяется ко всем модулям в `include`.
 *
 * Это не позволяет покрытию незаметно падать, но и не блокирует CI,
 * пока не покрыты интеграционные модули (vision, instagram, scanner).
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Только модули с тестами
      include: [
        'agent/planner.js',
        'agent/matcher.js',
        'agent/hashtags.js',
        'agent/usage.js',
      ],
      exclude: ['**/node_modules/**', 'tests/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 60,
        statements: 80,
      },
    },
  },
});
