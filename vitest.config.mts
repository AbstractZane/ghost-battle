import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.tflite'],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setupSvg.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/exercises/**/*.ts', 'src/game/**/*.ts', 'src/pose/poseMath.ts'],
    },
  },
  resolve: {
    alias: {
      // Metro resolves this platform-only module. Vite needs an explicit target for UI mocks.
      '@/components/PoseCamera': new URL('./src/components/PoseCamera.native.tsx', import.meta.url)
        .pathname,
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
