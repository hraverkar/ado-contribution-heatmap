import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage targets the pure logic; DOM rendering and the SDK bridge are
      // exercised in the browser, not here.
      include: [
        'src/util/**',
        'src/heatmap/**',
        'src/services/**',
        'src/api/commitService.ts',
        'src/api/repositoryService.ts',
        'src/api/httpClient.ts',
        'src/ui/theme.ts',
        'src/ui/format.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
