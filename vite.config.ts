import { defineConfig } from 'vitest/config';

// Configuración compartida entre Vite (dev/build) y Vitest (tests).
export default defineConfig({
  server: {
    // Expone el dev server en la red local (0.0.0.0) para probar desde el celular vía IP LAN.
    host: true,
  },
  test: {
    // happy-dom provee window/document para poder importar Phaser en los tests.
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // Stub de contexto 2D: happy-dom no implementa canvas y Phaser lo consulta al importarse.
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
