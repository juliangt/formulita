import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardarraíl estático del snippet de PostHog en index.html (issue #27).
 *
 * El snippet inline no pasa por tsc ni por el bundle, así que estos tests
 * leen el HTML crudo con node:fs y afirman que la config EXACTA que exige el
 * issue sigue ahí: cookieless 'always' (sin banner, cero storage), sin
 * perfiles de persona, sin autocapture, pageview on, cloud EU. También
 * cuidan el gate por hostname (npm run dev 100% limpio), el diferido real y
 * el token placeholder vacío (hasta pegarlo no se carga nada).
 */

// OJO: happy-dom pisa el `URL` global (resuelve rutas relativas contra su
// ubicación falsa http://localhost:3000/), así que `new URL(relative,
// import.meta.url)` produce un http: y readFileSync explota. Convertimos
// import.meta.url a ruta real con node:path/node:url, que no dependen del
// global pisaú.
const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(testDir, '..', '..', 'index.html'), 'utf8');

/** Extrae el bloque <script> inline de telemetría (el único con POSTHOG). */
function snippet(): string {
  const start = html.indexOf('POSTHOG_TOKEN');
  expect(start, 'index.html debe contener el snippet con POSTHOG_TOKEN').toBeGreaterThan(-1);
  const scriptStart = html.lastIndexOf('<script>', start);
  const scriptEnd = html.indexOf('</script>', start);
  expect(scriptStart).toBeGreaterThan(-1);
  expect(scriptEnd).toBeGreaterThan(scriptStart);
  return html.slice(scriptStart, scriptEnd);
}

describe('snippet PostHog EU — config exigida por el issue #27', () => {
  it('cookieless estricto: cookieless_mode always + person_profiles never', () => {
    expect(snippet()).toContain("cookieless_mode: 'always'");
    expect(snippet()).toContain("person_profiles: 'never'");
  });

  it('sin autocapture y con pageview explícito', () => {
    expect(snippet()).toContain('autocapture: false');
    expect(snippet()).toContain('capture_pageview: true');
  });

  it('cloud EU: api_host eu.i.posthog.com y assets del CDN EU', () => {
    expect(snippet()).toContain("api_host: 'https://eu.i.posthog.com'");
    expect(snippet()).toContain('https://eu-assets.i.posthog.com/static/array.js');
    // Jamás el cloud US, ni por accidente.
    expect(html).not.toContain('us.i.posthog.com');
    expect(html).not.toContain('us-assets.i.posthog.com');
  });

  it('defaults SDK vigente documentado (snapshot 2026-08-30)', () => {
    expect(snippet()).toContain("defaults: '2026-08-30'");
  });

  it('sin identify()/alias() en todo el repo-HTML (anularían el cookieless)', () => {
    expect(html).not.toMatch(/\bidentify\s*\(/);
    expect(html).not.toMatch(/\balias\s*\(/);
  });

  it('carga async e init recién en el onload del script del CDN', () => {
    expect(snippet()).toContain('script.async = true');
    expect(snippet()).toContain('script.onload = initPostHog');
  });
});

describe('snippet PostHog EU — gate por hostname (dev 100% limpio)', () => {
  it('bloquea localhost, 127.0.0.1, [::1] y ::1', () => {
    expect(snippet()).toContain("'localhost'");
    expect(snippet()).toContain("'127.0.0.1'");
    expect(snippet()).toContain("'[::1]'");
    expect(snippet()).toContain("'::1'");
  });

  it('bloquea hostname vacío (file:// y contextos sin origen)', () => {
    expect(snippet()).toMatch(/hostname\s*===\s*''/);
  });

  it('el gate corre ANTES de agendar cualquier carga (return temprano)', () => {
    const code = snippet();
    // Occurrencias en CÓDIGO (no en los comentarios de cabecera): el check
    // del gate y el feature-detect del diferido.
    const gate = code.indexOf("hostname === ''");
    const idle = code.indexOf("'requestIdleCallback' in window");
    expect(gate).toBeGreaterThan(-1);
    expect(idle).toBeGreaterThan(gate);
  });
});

describe('snippet PostHog EU — diferido real (no compite con el arranque)', () => {
  it('usa requestIdleCallback con timeout generoso', () => {
    expect(snippet()).toContain('requestIdleCallback');
    expect(snippet()).toMatch(/timeout:\s*\d{3,}/);
  });

  it('tiene fallback a window load + setTimeout', () => {
    expect(snippet()).toContain("addEventListener('load'");
    expect(snippet()).toContain('setTimeout');
  });
});

describe('snippet PostHog EU — token placeholder (paso manual del issue)', () => {
  it('el token viene VACÍO: hasta pegarlo no se carga nada del SDK', () => {
    expect(snippet()).toMatch(/POSTHOG_TOKEN\s*=\s*''/);
  });

  it('el check de token vacío corta antes de tocar el DOM/CDN', () => {
    const code = snippet();
    const tokenCheck = code.indexOf('if (!POSTHOG_TOKEN)');
    const createElement = code.indexOf("createElement('script')");
    expect(tokenCheck).toBeGreaterThan(-1);
    expect(createElement).toBeGreaterThan(tokenCheck);
  });

  it('no hay tokens reales commiteados por accidente (32 chars alfanum)', () => {
    expect(html).not.toMatch(/phc_[A-Za-z0-9]{20,}/);
  });
});
