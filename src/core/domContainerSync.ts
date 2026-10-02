/**
 * Sincronización del contenedor DOM de Phaser con el rect REAL del canvas
 * (issue #21 — inputs de nombre/palabra/DM invisibles con letterbox).
 *
 * POR QUÉ FALLA PHASER 4.2.1 CON LETTERBOX:
 * - `CreateDOMContainer` (node_modules/phaser/src/dom/CreateDOMContainer.js)
 *   crea el contenedor como `position: absolute` de 720×1280 (caja base) con
 *   `transform-origin: left top` y SIN `top`/`left`, colgado de `#game`.
 * - En cada `ScaleManager.refresh()` (src/scale/ScaleManager.js ~976-991) solo
 *   le escribe `transform: scale(displaySize/baseSize)` y copia los márgenes
 *   del canvas. Esos márgenes salen de `updateCenter()`, que asume que el
 *   canvas FLUYE desde la esquina del parent y que Phaser lo centra a mano.
 * - Pero el CSS de index.html centra `#game` con FLEX (y le suma safe-area
 *   insets): un absoluto sin top/left toma su "static position" de hijo de un
 *   contenedor flex, que lo centra usando la caja SIN escalar (720×1280) →
 *   el contenedor queda AFUERA del viewport (medido en 390×844: (-165, -180)
 *   con scale(0.5417), mientras el canvas vive en (0, 113) de 390×693). Los
 *   elementos DOM de juego (input de nombre del menú, palabra del lobby, DMs
 *   del chat) se pintan en coordenadas del contenedor y caen recortados.
 *
 * CÓMO SE ARREGLA: después de CADA refresh del ScaleManager se re-lee el rect
 * real del canvas y se re-escribe el contenedor anclado al viewport:
 * `position: fixed; left/top: 0; margin: 0` + `translate(left, top)
 * scale(ancho_rect / 720)`. Así el contenedor cubre EXACTAMENTE el canvas y
 * las coordenadas de juego se vuelven coordenadas CSS del contenedor.
 *
 * ENGANCHED: `ScaleManager.refresh()` emite `resize` (Phaser.Scale.Events.
 * RESIZE) como ÚLTIMO paso, después de escribir el contenedor → un handler
 * del evento corre después de Phaser y es el último escritor. Ahí pasan TODOS
 * los caminos: boot, el re-refresh de READY, rotaciones/orientationchange y
 * los refresh que ya dispara el fix de iOS de main.ts (touchstart,
 * visualViewport, cada transformPointer) — no hace falta tocar nada más.
 */

/** Porción del rect del canvas que la sincronización necesita (CSS px). */
export interface DomSyncRect {
  left: number;
  top: number;
  width: number;
}

/**
 * Subconjunto de Phaser.Game que la sincronización necesita. Estructural
 * (no importa Phaser acá): un fake de test con estas formas funciona igual.
 */
export interface DomSyncGame {
  canvas: HTMLCanvasElement;
  domContainer?: HTMLDivElement | null;
  scale?: {
    on?(event: string, handler: () => void): unknown;
  };
}

/**
 * Transform CSS que alinea el contenedor con el rect del canvas. PURA (la
 * testea issue #21; la Fase 2 refuerza): translate al left/top del rect +
 * escala por ancho. Requiere que el origen SIN transformar del contenedor sea
 * la esquina del viewport (lo garantiza `syncDomContainerToCanvas` al fijar
 * `position: fixed; left/top: 0`).
 */
export function buildDomContainerTransform(rect: DomSyncRect, gameWidth: number): string {
  const scale = rect.width / gameWidth;
  return `translate(${rect.left}px, ${rect.top}px) scale(${scale})`;
}

/**
 * Aplica el transform del contenedor DOM a partir del rect actual del canvas.
 * Nunca lanza ni toca el input del juego: si algo falta (fake de test, canvas
 * sin layout) deja el contenedor como esté y el juego sigue.
 */
export function syncDomContainerToCanvas(game: DomSyncGame, gameWidth: number): void {
  const container = game.domContainer;
  if (!container) {
    // Sin contenedor no hay nada que alinear (arranque sin `createContainer`,
    // o los fakes de Phaser.Game de los tests de main.ts).
    return;
  }
  try {
    const rect = game.canvas.getBoundingClientRect();
    // Layout aún sin resolver (rect vacío) o escala basura: no aplicar nada.
    // El siguiente refresh (READY, touchstart, visualViewport) lo corrige.
    const scale = rect.width / gameWidth;
    if (!(rect.width > 0) || !Number.isFinite(scale) || scale <= 0) {
      return;
    }
    const style = container.style;
    // Anclado al viewport: el origen sin transformar pasa a ser la esquina de
    // la pantalla, así el translate usa coordenadas de viewport puro (el rect
    // del canvas) sin depender del layout flex/safe-areas de #game. Phaser
    // re-escribe transform y margins en cada refresh; esto corre después
    // (evento `resize`), pero re-afirmamos todo por robustez entre versiones.
    style.position = 'fixed';
    style.left = '0px';
    style.top = '0px';
    style.marginLeft = '0px';
    style.marginTop = '0px';
    style.transformOrigin = '0 0';
    style.transform = buildDomContainerTransform(rect, gameWidth);
  } catch {
    // Sin sync el contenedor cae en el comportamiento viejo de Phaser: el
    // juego (canvas + toques) sigue funcionando igual.
  }
}

/**
 * Engancha la sincronización al ciclo de vida del juego: subscribe un handler
 * al evento `resize` del ScaleManager (Phaser.Scale.Events.RESIZE, valor
 * string 'resize' — literal acá para no importar Phaser en este módulo) y
 * corre una vez al instante, por si el RESIZE del boot ya se emitió antes de
 * la suscripción (el re-refresh de READY lo cubre igual, esto es cinturón y
 * suspenders).
 */
export function installDomContainerSync(game: DomSyncGame, gameWidth: number): void {
  const sync = (): void => syncDomContainerToCanvas(game, gameWidth);
  if (typeof game.scale?.on === 'function') {
    game.scale.on('resize', sync);
  }
  sync();
}
