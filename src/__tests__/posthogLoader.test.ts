import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POSTHOG_CDN_SCRIPT_URL,
  loadPostHogTelemetry,
  type PostHogLoaderDeps,
} from '../telemetry/posthogLoader';

/**
 * Tests del loader de telemetría PostHog (issue #41).
 *
 * Desde el #41 el arranque de la analítica vive en
 * `src/telemetry/posthogLoader.ts` — pasa por tsc y se testea DIRECTAMENTE
 * (gates, config exacta del `init`, diferido, no-op seguro). Reemplaza a
 * `analyticsSnippet.test.ts`, que afirmaba sobre el HTML crudo con
 * `indexOf` porque el snippet inline no pasaba por el compilador.
 *
 * Quedan acá los guardarraíles ESTÁTICOS que siguen teniendo sentido porque
 * cruzan archivos: `index.html` es solo shell (cero posthog), el loader está
 * cableado en `main.ts`, y no hay tokens reales ni cloud US ni
 * `identify()`/`alias()` en el repo.
 */

// OJO: happy-dom pisa el `URL` global (resuelve rutas relativas contra su
// ubicación falsa http://localhost:3000/), así que `new URL(relative,
// import.meta.url)` produce un http: y readFileSync explota. Convertimos
// import.meta.url a ruta real con node:path/node:url, que no dependen del
// global pisaú.
const testDir = dirname(fileURLToPath(import.meta.url));
const readFile = (relative: string): string =>
  readFileSync(resolve(testDir, '..', '..', relative), 'utf8');

/** Script falso: el loader solo escribe `async`, `src` y `onload`. */
interface FakeScript {
  async: boolean;
  src: string;
  onload: (() => void) | null;
}

/**
 * Sustituye la inyección DOM por grabación en un array: NUNCA se cuelga un
 * <script> real en happy-dom (evita que intente bajar el CDN) y queda
 * inspeccionable. Devuelve los scripts "creados".
 */
function stubScriptInjection(): FakeScript[] {
  const created: FakeScript[] = [];
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() === 'script') {
      const script: FakeScript = { async: false, src: '', onload: null };
      created.push(script);
      return script as unknown as HTMLScriptElement;
    }
    return originalCreateElement(tagName);
  }) as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node);
  return created;
}

/** Agenda la carga en memoria (sin tocar idle/timeout del entorno). */
function recordingSchedule(): { schedule: NonNullable<PostHogLoaderDeps['schedule']>; loads: Array<() => void> } {
  const loads: Array<() => void> = [];
  const schedule: NonNullable<PostHogLoaderDeps['schedule']> = (load) => {
    loads.push(load);
  };
  return { schedule, loads };
}

const envWith = (token?: string): PostHogLoaderDeps['env'] => ({ VITE_POSTHOG_TOKEN: token });

/** Hostname "de producción" para los tests que pasan el gate. */
const PROD_HOSTNAME = 'juliangt.github.io';

const setReadyState = (value: Document['readyState']): void => {
  Object.defineProperty(document, 'readyState', { value, configurable: true });
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'posthog');
  // Por si un test definió requestIdleCallback (happy-dom NO lo tiene: el
  // default del loader cae a los fallbacks de window load en este entorno).
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(document, 'readyState');
});

describe('posthogLoader — gates (nada se agenda si no corresponde)', () => {
  it('bloquea localhost, 127.0.0.1, [::1], ::1 y hostname vacío (file://)', () => {
    const { schedule, loads } = recordingSchedule();
    for (const hostname of ['', 'localhost', '127.0.0.1', '[::1]', '::1']) {
      expect(loadPostHogTelemetry({ env: envWith('phc_token'), hostname, schedule })).toBe(false);
    }
    expect(loads).toHaveLength(0);
  });

  it('con el hostname DEFAULT del entorno (happy-dom = localhost) tampoco agenda', () => {
    // Misma garantía que el snippet viejo en `npm run dev`: el gate corre
    // sobre window.location real, no sobre un parámetro que nadie pasa.
    const { schedule, loads } = recordingSchedule();
    expect(loadPostHogTelemetry({ env: envWith('phc_token'), schedule })).toBe(false);
    expect(loads).toHaveLength(0);
  });

  it('bloquea token ausente, vacío o de espacios (analítica apagada por default)', () => {
    const { schedule, loads } = recordingSchedule();
    for (const token of [undefined, '', '   ']) {
      expect(loadPostHogTelemetry({ env: envWith(token), hostname: PROD_HOSTNAME, schedule })).toBe(false);
    }
    expect(loads).toHaveLength(0);
  });

  it('el gate corre ANTES de tocar el DOM: sin scripts inyectados si no agenda', () => {
    const created = stubScriptInjection();
    loadPostHogTelemetry({ env: envWith(undefined), hostname: PROD_HOSTNAME });
    expect(created).toHaveLength(0);
  });
});

describe('posthogLoader — carga del CDN e init exacto (issue #27 intacto)', () => {
  it('hostname habilitado + token: agenda UNA carga y devuelve true', () => {
    const { schedule, loads } = recordingSchedule();
    expect(loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule })).toBe(true);
    expect(loads).toHaveLength(1);
  });

  it('la carga inyecta async el script del CDN EU, y el init corre en su onload', () => {
    const { schedule, loads } = recordingSchedule();
    const created = stubScriptInjection();
    loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule });

    // Recién cuando el navegador queda idle corre la inyección (diferido).
    expect(created).toHaveLength(0);
    loads[0]();

    expect(created).toHaveLength(1);
    expect(created[0].async).toBe(true);
    expect(created[0].src).toBe('https://eu-assets.i.posthog.com/static/array.js');

    // El init NO corre al inyectar: solo en el onload del script.
    const sdk = { init: vi.fn<(token: string, config: Record<string, unknown>) => void>(), capture: vi.fn() };
    window.posthog = sdk;
    created[0].onload?.();

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith('phc_token', {
      api_host: 'https://eu.i.posthog.com',
      cookieless_mode: 'always',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: true,
      defaults: '2026-08-30',
    });
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it('SDK a medio cargar (sin init): el onload es no-op y no lanza', () => {
    const { schedule, loads } = recordingSchedule();
    const created = stubScriptInjection();
    loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule });
    loads[0]();

    const capture = vi.fn();
    window.posthog = { capture };
    expect(() => created[0].onload?.()).not.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });

  it('SDK ausente (script bloqueado, dev, sin red): no-op sin lanzar', () => {
    const { schedule, loads } = recordingSchedule();
    const created = stubScriptInjection();
    loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule });
    loads[0]();

    expect(window.posthog).toBeUndefined();
    expect(() => created[0].onload?.()).not.toThrow();
  });

  it('un init que lanza se traga: la telemetría nunca rompe al juego', () => {
    const { schedule, loads } = recordingSchedule();
    const created = stubScriptInjection();
    loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule });
    loads[0]();

    window.posthog = {
      init: () => {
        throw new Error('SDK herido');
      },
      capture: vi.fn(),
    };
    expect(() => created[0].onload?.()).not.toThrow();
  });

  it('DOM herido (createElement/appendChild lanzan): la carga agendada no tumba nada', () => {
    const { schedule, loads } = recordingSchedule();
    loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME, schedule });

    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('DOM herido');
    });
    expect(() => loads[0]()).not.toThrow();

    vi.restoreAllMocks();
    stubScriptInjection();
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      throw new Error('DOM herido');
    });
    expect(() => loads[0]()).not.toThrow();
  });
});

describe('posthogLoader — diferido por defecto (no compite con el arranque)', () => {
  it('usa requestIdleCallback con timeout generoso cuando existe', () => {
    const idle = vi.fn();
    Object.defineProperty(window, 'requestIdleCallback', { value: idle, configurable: true, writable: true });

    expect(loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME })).toBe(true);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 8000 });
  });

  it('sin requestIdleCallback y página ya cargada: window load + setTimeout', () => {
    // happy-dom NO implementa requestIdleCallback: este es el camino default.
    setReadyState('complete');
    const timeout = vi.spyOn(window, 'setTimeout');

    expect(loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME })).toBe(true);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it('sin requestIdleCallback y página cargándose: difiere al evento load', () => {
    setReadyState('loading');
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const timeout = vi.spyOn(window, 'setTimeout');

    expect(loadPostHogTelemetry({ env: envWith('phc_token'), hostname: PROD_HOSTNAME })).toBe(true);
    expect(timeout).not.toHaveBeenCalled();

    const onLoad = addEventListener.mock.calls.find(([type]) => type === 'load')?.[1];
    expect(onLoad).toBeTypeOf('function');
    (onLoad as () => void)();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});

describe('guardarraíles estáticos (cruzan archivos: se leen los fuentes)', () => {
  it('index.html es SOLO shell: cero rastro de posthog (issue #41)', () => {
    expect(readFile('index.html')).not.toMatch(/posthog/i);
  });

  it('el loader está cableado en main.ts (no queda huérfano)', () => {
    expect(readFile('src/main.ts')).toContain('loadPostHogTelemetry()');
  });

  it('CDN EU y solo EU en toda la telemetría (jamás el cloud US)', () => {
    expect(POSTHOG_CDN_SCRIPT_URL).toBe('https://eu-assets.i.posthog.com/static/array.js');
    const telemetry = readFile('src/telemetry/posthogLoader.ts') + readFile('src/telemetry/analytics.ts');
    expect(telemetry).not.toContain('us.i.posthog.com');
    expect(telemetry).not.toContain('us-assets.i.posthog.com');
  });

  it('sin tokens reales commiteados en HTML ni telemetría (32 chars alfanum)', () => {
    const files = readFile('index.html') + readFile('src/telemetry/posthogLoader.ts');
    expect(files).not.toMatch(/phc_[A-Za-z0-9]{20,}/);
  });

  it('sin identify()/alias() en la telemetría (anularían el cookieless)', () => {
    const telemetry = readFile('src/telemetry/posthogLoader.ts') + readFile('src/telemetry/analytics.ts');
    expect(telemetry).not.toMatch(/\bidentify\s*\(/);
    expect(telemetry).not.toMatch(/\balias\s*\(/);
  });
});
