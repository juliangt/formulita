import Phaser from 'phaser';
import { createGameConfig, GAME_HEIGHT, GAME_WIDTH } from './config/gameConfig';
import { isDebugMode } from './config/debugFlags';
import { installDomContainerSync } from './core/domContainerSync';
import { loadPostHogTelemetry } from './telemetry/posthogLoader';

/** Contenedor DOM donde Phaser monta el canvas. */
const GAME_CONTAINER_ID = 'game';

/**
 * Bloquea los gestos del navegador que arruinan la experiencia de juego en
 * móvil (Fase 7 — robustez): menú contextual de long-press, zoom por
 * double-tap (belt-and-suspenders sobre `touch-action: none` y
 * `user-scalable=no`), gesto de pizña propio de iOS (`gesturestart`) y
 * selección de texto al mantener presionado. El CSS base de index.html hace
 * la mayor parte; estos listeners cubren los huecos que quedan en algunos
 * WebViews viejos. Nunca lanza: si `document` no existe (SSR/tests), no-op.
 */
function installGestureGuards(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const block = (event: Event): void => {
    event.preventDefault();
  };
  // Los tipos de eventos no estándar (iOS) no viven en HTMLElementEventMap:
  // se registran por la sobrecarga de string que acepta cualquier listener.
  document.addEventListener('contextmenu', block);
  document.addEventListener('dblclick', block);
  document.addEventListener('gesturestart', block);
  document.addEventListener('selectstart', block);
}

/**
 * Mantiene el mapeo de toques → coordenadas de juego fresco (iOS Safari).
 *
 * Phaser cachea el rect del canvas y solo lo actualiza en window.resize y
 * orientationchange. Al colapsar/expander la barra de URL, iOS cambia el
 * layout viewport SIN disparar resize (página sin scroll): el canvas se
 * re-centra por CSS pero las bounds cacheadas quedan viejas y los toques
 * caen desplazados — la mitad de un botón "no responde". Dos redes:
 * - `visualViewport` resize/scroll: iOS lo dispara en cada cambio de barra.
 * - refresh en fase de CAPTURA por touchstart/pointerdown: cada toque se
 *   mapea con el rect recién leído, dispare o no ningún evento.
 */
function installViewportSync(game: Phaser.Game): void {
  const refresh = (): void => {
    try {
      game.scale.refresh();
    } catch {
      // Sin refresh el mapeo cae al último estado conocido: el juego sigue.
    }
  };
  window.visualViewport?.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('scroll', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('touchstart', refresh, true);
  window.addEventListener('pointerdown', refresh, true);
}

function bootstrap(): Phaser.Game {
  const container = document.getElementById(GAME_CONTAINER_ID);
  if (!container) {
    throw new Error(`No se encontró el contenedor #${GAME_CONTAINER_ID} en el DOM`);
  }
  const game = new Phaser.Game(createGameConfig(container));
  installViewportSync(game);
  // Issue #21: el contenedor DOM de Phaser (inputs de nombre/palabra/DM de
  // chat) NO acompaña el letterbox del canvas — Phaser solo le escribe
  // `scale` + márgenes heredados y el flex de index.html lo manda afuera del
  // viewport. Cada refresh del ScaleManager emite `resize` DESPUÉS de escribir
  // el contenedor, así que una sola suscripción re-alinea el contenedor con el
  // rect real del canvas en todos los caminos (boot, READY, rotaciones y los
  // refresh de arriba). Ver core/domContainerSync.ts.
  installDomContainerSync(game, GAME_WIDTH);
  // El modo debug (issue #16) se resuelve UNA vez al arrancar y solo gobierna
  // los artefactos de diagnóstico (tag de build + anillo de tap). El refresh
  // de escala — el fix de iOS — corre SIEMPRE, con o sin debug.
  const debug = isDebugMode();
  installTransformGuard(game, { echo: debug });
  installBuildTag(debug);
  return game;
}

/** Opciones de `installTransformGuard`. */
export interface TransformGuardOptions {
  /** Eco visual del tap: solo con el modo debug ON (issue #16). */
  echo: boolean;
}

/**
 * Guardia del mapeo toque → coordenadas de juego (SOLUCIÓN de raíz).
 *
 * Phaser transforma las coordenadas del toque con el rect del canvas y la
 * escala cacheados por el ScaleManager; en iOS Safari esos valores quedan
 * viejos (la barra de URL cambia el viewport sin disparar resize, el canvas
 * se re-centra por CSS, etc.) y los toques se registran desplazados: media
 * superficie del botón "no responde" aunque el hit area sea correcto.
 *
 * Acá se envuelve `InputManager.transformPointer` — el ÚNICO punto por el
 * que pasa todo input (mouse/touch, down/move/up) — para que CADA evento:
 * 1. refresque el rect y la escala con `game.scale.refresh()` (lectura en
 *    vivo de getBoundingClientRect, cero caché). Esto SIEMPRE corre: es el
 *    fix de iOS, no depende del modo debug, y
 * 2. si el modo debug está ON (`options.echo`, issue #16), deje un anillo en
 *    pantalla exactamente donde el juego registró el toque (proyección del
 *    mapeo de vuelta a CSS px). Si el anillo no aparece debajo del dedo, el
 *    desvío queda a la vista — diagnóstico sin conjeturas. Con debug OFF el
 *    div del anillo NI SIQUIERA se crea: un test de DOM puede verificar su
 *    ausencia directamente.
 */
function installTransformGuard(game: Phaser.Game, options: TransformGuardOptions): void {
  const inputManager = game.input;
  const baseTransform = inputManager.transformPointer.bind(inputManager);

  // El eco existe SOLO con debug ON: con OFF no hay div en el DOM.
  const echo: HTMLDivElement | null = options.echo ? createEchoRing() : null;

  let echoTimer: ReturnType<typeof setTimeout> | undefined;

  inputManager.transformPointer = (
    pointer: Phaser.Input.Pointer,
    pageX: number,
    pageY: number,
    wasMove: boolean,
  ): void => {
    try {
      game.scale.refresh();
    } catch {
      // Sin refresh el mapeo cae al último estado conocido: el juego sigue.
    }
    baseTransform(pointer, pageX, pageY, wasMove);

    // Con debug OFF acá termina el wrapper: el refresh de arriba ya corrió
    // (fix de iOS, jamás detrás del flag); solo el eco es diagnóstico.
    if (!echo) {
      return;
    }
    // Alias ya estrechado a HTMLDivElement: usable sin guarda dentro del timer.
    const ring = echo;
    if (wasMove || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
      return;
    }
    try {
      const rect = game.canvas.getBoundingClientRect();
      ring.style.left = `${rect.left + (pointer.x / GAME_WIDTH) * rect.width}px`;
      ring.style.top = `${rect.top + (pointer.y / GAME_HEIGHT) * rect.height}px`;
      ring.style.opacity = '1';
      if (echoTimer !== undefined) {
        clearTimeout(echoTimer);
      }
      echoTimer = setTimeout(() => {
        ring.style.opacity = '0';
      }, 250);
    } catch {
      // El eco es solo diagnóstico: su fallo no toca el input.
    }
  };
}

/**
 * Crea el div del anillo de diagnóstico y lo cuelga del body. Solo se llama
 * con debug ON; su fallo no toca el input (el caller ya está en try/catch).
 */
function createEchoRing(): HTMLDivElement {
  const echo = document.createElement('div');
  echo.style.cssText = [
    'position:fixed',
    'width:18px',
    'height:18px',
    'border:2px solid rgba(255,255,255,0.9)',
    'border-radius:50%',
    'box-shadow:0 0 5px rgba(0,0,0,0.7)',
    'pointer-events:none',
    'z-index:30',
    'opacity:0',
    'transform:translate(-50%,-50%)',
    'transition:opacity 0.25s ease-out',
  ].join(';');
  document.body.appendChild(echo);
  return echo;
}

/**
 * Marcador de build visible SOLO con el modo debug ON (?debug=1|true en la
 * URL o `DEBUG_STORAGE_KEY` en localStorage — issue #16; antes quedaba
 * siempre a la vista, DIAGNÓSTICO del debugging del input móvil): muestra el
 * hash del bundle servido en una esquina, para poder confirmar SIN ambigüedad
 * qué versión corre cada dispositivo. En dev muestra "dev" (import.meta.url
 * no lleva hash). pointer-events: none → no interfiere.
 */
function installBuildTag(debug: boolean): void {
  if (typeof document === 'undefined' || !debug) {
    return;
  }
  const hash = import.meta.url.split('/').pop()?.match(/index-([\w-]+)\.js/)?.[1] ?? 'dev';
  const tag = document.createElement('div');
  tag.textContent = `build ${hash}`;
  tag.style.cssText =
    'position:fixed;right:8px;bottom:6px;font:11px monospace;color:rgba(255,255,255,0.35);pointer-events:none;z-index:20;letter-spacing:0.5px';
  document.body.appendChild(tag);
}

// El script es un módulo (defer), por lo que el DOM ya está disponible.
// Telemetría (issues #27 y #41): agenda primero la carga diferida del SDK de
// PostHog — gateada por hostname y por VITE_POSTHOG_TOKEN, y con la descarga
// real recién en idle (requestIdleCallback), así que no compite con Phaser.
// Ir antes del bootstrap garantiza el pageview aunque el juego rompa al
// arrancar. Nunca lanza: con gates en falso o cualquier error es no-op.
loadPostHogTelemetry();
installGestureGuards();
bootstrap();
