import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVICE_WORKER_URL } from '../pwa/serviceWorkerRegistration';

/**
 * Contrato PWA de los archivos estáticos (issue #43).
 *
 * El issue #41 reemplazó los guardarraíles del HTML crudo por tests del
 * loader; acá la FUENTE del contrato ES el archivo estático (manifest,
 * iconos, metas del shell y el SW de public/, que no pasa por tsc), así
 * que los tests leen los bytes y validan la instalabilidad: un solo error
 * en cualquiera de estas piezas y el juego deja de ser instalable u
 * offline sin que nadie lo note hasta probar en el teléfono.
 */

// Vitest corre con cwd = raíz del repo (npm test): las rutas del contrato
// se anclan ahí. (import.meta.url no sirve: vite-node lo reescribe sin
// esquema file:// y fileURLToPath lo rechaza.)
const ROOT = process.cwd();
const readBytes = (relative: string): Buffer =>
  readFileSync(join(ROOT, relative)) as unknown as Buffer;
const readText = (relative: string): string => readFileSync(join(ROOT, relative), 'utf-8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface WebAppManifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

/** Dimensiones reales de un PNG leyendo el IHDR (bytes 16-23, big-endian). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const manifest: WebAppManifest = JSON.parse(readText('public/manifest.webmanifest'));

describe('contrato PWA — manifest.webmanifest (issue #43)', () => {
  it('declara nombre, standalone, portrait y colores del theme', () => {
    expect(manifest.name).toBe('Formulita');
    expect(manifest.short_name).toBe('Formulita');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.background_color).toBe('#000000');
    expect(manifest.theme_color).toBe('#000000');
  });

  it('start_url y scope son RELATIVOS (sobreviven al subpath /formulita/ de Pages)', () => {
    for (const [field, value] of [
      ['id', manifest.id],
      ['start_url', manifest.start_url],
      ['scope', manifest.scope],
    ] as const) {
      expect(value, field).toBe('./');
      expect(value.startsWith('/'), `${field} no debe ser absoluto`).toBe(false);
    }
  });

  it('cubre los iconos que exige la instalabilidad: 192 any, 512 any y 512 maskable', () => {
    const byKey = (icon: ManifestIcon): string => `${icon.sizes}|${icon.purpose}`;
    const keys = new Set(manifest.icons.map(byKey));
    expect(keys.has('192x192|any')).toBe(true);
    expect(keys.has('512x512|any')).toBe(true);
    expect(keys.has('512x512|maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/'), 'los src deben ser relativos').toBe(false);
    }
  });

  it('cada icono del manifest EXISTE y mide lo que declara', () => {
    for (const icon of manifest.icons) {
      const bytes = readBytes(`public/${icon.src.replace(/^\.\//, '')}`);
      const [sizes] = icon.sizes.split(' ');
      const [declaredWidth, declaredHeight] = sizes.split('x').map(Number);
      expect(pngSize(bytes), icon.src).toEqual({
        width: declaredWidth,
        height: declaredHeight,
      });
    }
  });

  it('el apple-touch-icon de iOS existe y mide 180x180', () => {
    expect(pngSize(readBytes('public/icons/apple-touch-icon.png'))).toEqual({
      width: 180,
      height: 180,
    });
  });
});

describe('contrato PWA — index.html (issue #43)', () => {
  const html = readText('index.html');

  it('linkea el manifest y el favicon con rutas relativas', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="./manifest.webmanifest"');
    expect(html).toContain('href="./icons/icon-192.png"');
  });

  it('declara las metas de iOS para "Agregar a pantalla de inicio"', () => {
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('href="./icons/apple-touch-icon.png"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(html).toContain('content="black-translucent"');
    expect(html).toContain('name="apple-mobile-web-app-title"');
    expect(html).toContain('content="Formulita"');
    // Alias moderno (Chromium lo usa para el modo standalone sin manifest).
    expect(html).toContain('name="mobile-web-app-capable"');
  });
});

describe('contrato PWA — public/sw.js (issue #43)', () => {
  // sw.js es vanilla a propósito (Vite lo copia sin tocarlo, así el scope
  // cae en la raíz del juego): no pasa por tsc ni por el bundler, así que
  // el test ata el contrato offline a su texto — handlers, estrategia y
  // shell. Frases, no firmas: si cambia la estrategia que esto avisa.
  const sw = readText('public/sw.js');

  it(' instala el shell, se reclama y versiona la caché con limpieza', () => {
    expect(sw).toContain("addEventListener('install'");
    expect(sw).toContain('addAll');
    expect(sw).toContain('skipWaiting');
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toContain('clients.claim');
    expect(sw).toContain('caches.delete');
    // Precachea el HTML y el manifest (el resto se revalida en runtime).
    expect(sw).toContain("'./index.html'");
    expect(sw).toContain("'./manifest.webmanifest'");
  });

  it('usa network-first para navegaciones y stale-while-revalidate para assets', () => {
    expect(sw).toContain("addEventListener('fetch'");
    expect(sw).toContain("request.mode === 'navigate'");
    expect(sw).toContain('networkFirstNavigation');
    expect(sw).toContain('staleWhileRevalidate');
    expect(sw).toContain('cache.match');
    expect(sw).toContain('cache.put');
  });

  it('deja afuera lo que NO debe tocar la caché: no-GET y cross-origin', () => {
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('url.origin !== self.location.origin');
    // PostHog (analítica) y Trystero (trackers) son cross-origin por diseño.
    expect(sw).toContain("request.headers.has('range')");
  });

  it('el registro apunta a este archivo con la URL relativa acordada', () => {
    expect(readText('index.html')).toContain('src/main.ts'); // el shell sigue montando el juego
    expect(SERVICE_WORKER_URL).toBe('sw.js');
    expect(sw).toContain('formulita-v1');
  });
});
