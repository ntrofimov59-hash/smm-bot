import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'agent/planner.js',
        'agent/matcher.js',
        'agent/hashtags.js',
        'agent/usage.js',
        'agent/queue.js',
        'agent/telegram.js',
        'agent/vision-cache.js',
        'agent/caption.js',
        'agent/vision.js',
        'agent/publishers/instagram.js',
        'agent/scanner.js',
        'cli.js',
      ],
      exclude: ['**/node_modules/**', 'tests/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 50,
        statements: 70,
      },
    },
  },
});
