import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Coverage ratchet — только модули с тестами
      include: [
        'agent/planner.js',
        'agent/matcher.js',
        'agent/hashtags.js',
        'agent/usage.js',
        'agent/queue.js',
        'agent/telegram.js',
        'agent/vision-cache.js',
      ],
      exclude: ['**/node_modules/**', 'tests/**'],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 60,
        statements: 75,
      },
    },
  },
});
