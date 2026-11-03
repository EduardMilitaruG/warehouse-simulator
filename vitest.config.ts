import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
    // Integration files all reset the same database, so files run one at a time.
    fileParallelism: false,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
    ],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/index.ts'] },
  },
});
