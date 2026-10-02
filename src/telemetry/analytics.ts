/**
 * analytics — punto ÚNICO de contacto con el proveedor de telemetría
 * (PostHog Cloud EU, issue #27).
 *
 * Privacidad, por qué este módulo es tan paranoico:
 * - Modo cookieless 'always': PostHog no le pega un ID anónimo al visitante;
 *   identifica cada evento con un hash server-side IRREVERSIBLE con sal
 *   diaria. No escribe cookies ni localStorage/sessionStorage ⇒ cero storage
 *   en el dispositivo y, por lo mismo, NO hace falta banner de consentimiento
 *   (el juego no tiene ninguno y así queda).
 * - Cloud EU: API y assets en la UE (https://eu.i.posthog.com).
 * - JAMÁS llamar identify()/alias() desde este repo: asociar los eventos a
 *   una identidad persistente anularía todo el beneficio del modo cookieless.
 * - Nunca PII: los ganchos de juego (otra fase, issue #27) solo mandan el
 *   nombre del evento y properties agregadas/anónimas — sin nombres de
 *   jugador, salas ni contenido de chat.
 *
 * El SDK NO se bundlea (posthog-js no está en package.json): index.html lo
 * carga diferido desde el CDN EU, gateado por hostname y por token. Este
 * wrapper es el único archivo que conoce la forma del proveedor, y es
 * NO-OP SEGURO en todos los bordes:
 * - dev (`npm run dev`), script bloqueado (uBlock) o sin red: no hay
 *   `window.posthog` ⇒ no-op.
 * - SDK a medio cargar (`posthog` sin `capture`) ⇒ no-op.
 * - `capture` lanza por cualquier motivo ⇒ el error se traga acá: la
 *   telemetría jamás puede romper el juego (mismo contrato que
 *   `isDebugMode`/`ChatSettingsRepository`: nunca lanza).
 */

/**
 * Contrato mínimo del SDK que este repo consume. El resto de posthog-js no
 * nos interesa: mientras no exista esta superficie, `trackEvent` no hace nada.
 */
declare global {
  interface Window {
    posthog?: {
      capture: (name: string, properties?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Registra un evento de juego en PostHog. Delega en `window.posthog.capture`
 * y es no-op seguro si el SDK no está cargado o si `capture` falla: NUNCA
 * lanza, NUNCA rompe al caller (arranque, loop de carrera, tests).
 */
export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  try {
    window.posthog?.capture(name, properties);
  } catch {
    // Telemetría herida (SDK parcial, red caída, mock roto) no tumba el juego.
  }
}
