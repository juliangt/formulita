import { defineConfig } from 'vitest/config';

// Configuración compartida entre Vite (dev/build) y Vitest (tests).
export default defineConfig({
  server: {
    // Expone el dev server en la red local (0.0.0.0) para probar desde el celular vía IP LAN.
    host: true,
  },
  preview: {
    // Igual que en dev: sin esto Vite preview escucha solo en localhost y el build no
    // alcanza desde el teléfono en la misma red (caso de uso del script `serve` eliminado).
    host: true,
    headers: {
      // Safari/iOS cachea agresivamente el HTML y el bundle: al iterar fixes de input,
      // sin esta cabecera el teléfono puede seguir corriendo un build viejo sin que nadie lo note.
      'Cache-Control': 'no-store',
    },
  },
  test: {
    // happy-dom provee window/document para poder importar Phaser en los tests.
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // Stub de contexto 2D: happy-dom no implementa canvas y Phaser lo consulta al importarse.
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
