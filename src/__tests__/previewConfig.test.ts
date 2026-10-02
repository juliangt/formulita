import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

/**
 * Tests de regresión del issue #17 (eliminar `scripts/` y `npm run serve`).
 *
 * Fase 1 borró `scripts/serve-dist.mjs` y el script `serve` de package.json;
 * `npm run preview` es su reemplazo oficial. Para que el reemplazo sirva de
 * verdad, `preview` heredó del script eliminado sus dos propiedades clave:
 * host LAN (probar desde el teléfono) y `Cache-Control: no-store` (Safari/iOS
 * cachea el HTML y el bundle: sin esta cabecera el teléfono puede seguir
 * corriendo un build viejo sin que nadie lo note). Estos tests fijan ese
 * contrato para que nadie lo regrese sin notarse.
 */

// Ojo: `import.meta.url` no es una URL file:// bajo el transform de vitest
// (rompe fileURLToPath), pero `npm test` siempre corre desde la raíz del repo,
// así que process.cwd() es la ruta base estable.
const repoRoot = process.cwd();

const packageJson = JSON.parse(
  readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
) as { scripts?: Record<string, string | undefined> };

describe('vite.config — preview (reemplazo del script `serve` eliminado)', () => {
  it('sirve el build con Cache-Control: no-store (razón de ser del script eliminado)', () => {
    expect(viteConfig.preview?.headers?.['Cache-Control']).toBe('no-store');
  });

  it('expone preview en la red local (host: true) para alcanzarlo desde el teléfono', () => {
    expect(viteConfig.preview?.host).toBe(true);
  });
});

describe('vite.config — sección test (vitest) quedó intacta', () => {
  it('usa happy-dom como environment (window/document para importar Phaser)', () => {
    expect(viteConfig.test?.environment).toBe('happy-dom');
  });

  it('incluye los tests de src/**/*.test.ts', () => {
    expect(viteConfig.test?.include).toEqual(['src/**/*.test.ts']);
  });

  it('conserva el setup de tests (stub de contexto 2D para Phaser)', () => {
    expect(viteConfig.test?.setupFiles).toEqual(['src/__tests__/setup.ts']);
  });
});

describe('package.json — el script `serve` fue eliminado sin dañar los demás', () => {
  it('NO define scripts.serve (el reemplazo es npm run preview)', () => {
    expect(packageJson.scripts?.serve).toBeUndefined();
    expect('serve' in (packageJson.scripts ?? {})).toBe(false);
  });

  it('conserva los scripts dev, build, preview y test', () => {
    for (const name of ['dev', 'build', 'preview', 'test']) {
      expect(packageJson.scripts?.[name], `scripts.${name}`).toBeTruthy();
    }
  });
});

describe('scripts/ — eliminado del repositorio', () => {
  it('scripts/serve-dist.mjs ya no existe', () => {
    expect(existsSync(resolve(repoRoot, 'scripts', 'serve-dist.mjs'))).toBe(false);
  });

  it('el directorio scripts/ completo ya no existe', () => {
    expect(existsSync(resolve(repoRoot, 'scripts'))).toBe(false);
  });
});
