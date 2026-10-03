/**
 * posthogLoader — arranque de la telemetría PostHog Cloud EU (issue #41:
 * ex-snippet inline de index.html del issue #27, ahora módulo TS chequeado
 * por tsc y testeado directamente).
 *
 * Privacidad (misma config EXACTA que exigió el issue #27, no se toca):
 * - Cookieless 'always': PostHog identifica cada evento con un hash
 *   server-side IRREVERSIBLE con sal diaria. No escribe cookies ni
 *   localStorage/sessionStorage ⇒ cero storage en el dispositivo y sin
 *   banner de consentimiento.
 * - Cloud EU: API y assets en la UE (eu.i.posthog.com / eu-assets...).
 * - person_profiles: 'never' y sin identify ni alias de por vida (ver
 *   src/telemetry/analytics.ts): nadie puede asociar los eventos a una
 *   identidad persistente — eso anularía el beneficio cookieless.
 * - Sin PII: los ganchos de juego solo mandan eventos agregados/anónimos
 *   vía src/telemetry/analytics.ts.
 *
 * Carga NO bloqueante y diferida para no competir con el arranque del juego:
 * el script del CDN se inyecta async recién cuando el navegador queda idle
 * (requestIdleCallback con timeout generoso; en su defecto, window load +
 * setTimeout). El SDK NO se bundlea (posthog-js no está en package.json):
 * sigue viniendo diferido del CDN EU.
 *
 * Gates (en orden, ANTES de agendar cualquier carga):
 * - Hostname: cero telemetría en desarrollo local (localhost, 127.0.0.1,
 *   [::1], ::1 y hostname vacío — este último cubre file:// y contextos sin
 *   origen).
 * - Token: sin `VITE_POSTHOG_TOKEN` (o vacío) no se pide ni un byte del SDK
 *   — analítica apagada por default, opt-in del administrador del deploy.
 *
 * El token es público por diseño (viaja al navegador dentro del bundle, como
 * viajaba en el HTML estático antes del #41): NO es un secreto. Se define en
 * `.env.local` para dev (aunque en localhost el gate igual lo bloquea) y
 * como variable de repo en el deploy de Pages (ver deploy.yml).
 *
 * NO-OP SEGURO en todos los bordes: hostname bloqueado, token vacío, DOM sin
 * `document.body`, SDK a medio cargar o cualquier excepción — la telemetría
 * jamás puede romper el arranque del juego (mismo contrato que
 * `trackEvent`/`isDebugMode`: nunca lanza).
 */

/** Entorno de Vite que consume el loader (por defecto el real; tests inyectan el suyo). */
export interface TelemetryEnvSource {
  /** Project API token de PostHog EU. Vacío/ausente = analítica apagada. */
  readonly VITE_POSTHOG_TOKEN?: string;
}

/** Dependencias inyectables del loader (tests; en runtime los defaults). */
export interface PostHogLoaderDeps {
  /** Entorno de Vite. Default: `import.meta.env`. */
  readonly env?: TelemetryEnvSource;
  /** Hostname de la página. Default: `window.location.hostname`. */
  readonly hostname?: string;
  /** Agenda la carga diferida. Default: idle del navegador (ver abajo). */
  readonly schedule?: (load: () => void) => void;
}

/** CDN EU de assets de posthog-js (NUNCA el cloud US). */
export const POSTHOG_CDN_SCRIPT_URL = 'https://eu-assets.i.posthog.com/static/array.js';

/** Techo del diferido por requestIdleCallback (ms): generoso, pero acotado. */
const IDLE_TIMEOUT_MS = 8000;

/** Hostnames sin telemetría: dev local, file:// y contextos sin origen. */
const BLOCKED_HOSTNAMES: readonly string[] = ['', 'localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * Agenda la carga de la telemetría PostHog si corresponde. Devuelve `true`
 * solo si quedó agendada (hostname habilitado + token presente). Nunca lanza.
 *
 * Llamar UNA vez al arrancar (src/main.ts), ANTES del bootstrap de Phaser:
 * si el juego llegara a romper al arrancar, el pageview ya quedó agendado.
 * La descarga real ocurre en idle y no compite con el arranque.
 */
export function loadPostHogTelemetry(deps: PostHogLoaderDeps = {}): boolean {
  try {
    const token = (deps.env ?? import.meta.env).VITE_POSTHOG_TOKEN?.trim();
    const hostname = deps.hostname ?? window.location.hostname;
    if (!token || BLOCKED_HOSTNAMES.includes(hostname)) {
      return false;
    }
    const schedule = deps.schedule ?? defaultDeferredSchedule;
    schedule(() => injectPostHogScript(token));
    return true;
  } catch {
    // La telemetría no puede romper el juego. Nunca.
    return false;
  }
}

/**
 * Diferido real: idle del navegador con techo generoso; si no hay
 * requestIdleCallback (Safari viejo), window load + setTimeout.
 */
function defaultDeferredSchedule(load: () => void): void {
  // typeof (y no `in`): lib.dom tipa requestIdleCallback como siempre
  // presente, y el `in` estrecharía `window` a `never` en la rama falsa.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS });
  } else if (document.readyState === 'complete') {
    window.setTimeout(load, 0);
  } else {
    window.addEventListener('load', () => window.setTimeout(load, 0));
  }
}

/** Inyecta el script del CDN async; el `init` corre recién en su onload. */
function injectPostHogScript(token: string): void {
  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = POSTHOG_CDN_SCRIPT_URL;
    script.onload = () => initPostHog(token);
    (document.body || document.head).appendChild(script);
  } catch {
    // Si no se puede inyectar el script, no pasa nada.
  }
}

/** Config EXACTA del `init` (issue #27): privacidad por defecto del proyecto. */
function initPostHog(token: string): void {
  try {
    if (typeof window.posthog?.init === 'function') {
      window.posthog.init(token, {
        api_host: 'https://eu.i.posthog.com',
        cookieless_mode: 'always',
        person_profiles: 'never',
        autocapture: false,
        capture_pageview: true,
        // Snapshot de defaults SDK vigente de posthog-js: el más nuevo
        // documentado en posthog.com/docs/libraries/js/config (verificado
        // contra el tipo ConfigDefaults de posthog-js).
        defaults: '2026-08-30',
      });
    }
  } catch {
    // La telemetría no puede romper el juego. Nunca.
  }
}
