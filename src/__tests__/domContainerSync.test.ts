import { describe, expect, it, vi } from 'vitest';
import {
  buildDomContainerTransform,
  installDomContainerSync,
  syncDomContainerToCanvas,
  type DomSyncGame,
  type DomSyncRect,
} from '../core/domContainerSync';

/**
 * Tests del sync contenedor DOM ↔ canvas (issue #21).
 *
 * El bug: Phaser 4.2.1 posiciona el contenedor DOM con `scale` + márgenes
 * heredados del canvas, asumiendo flujo CSS desde la esquina del parent; con
 * el flex + letterbox de index.html el contenedor queda afuera del viewport
 * y los inputs (nombre del menú, palabra del lobby, DMs del chat) aparecen
 * recortados. El fix re-ancla el contenedor al viewport con
 * `translate(rect.left, rect.top) scale(rect.width / 720)` tras cada refresh.
 *
 * Se testea la parte PURA (rect → transform) y la parte de aplicación con
 * fakes estructurales (sin Phaser real): canvas con `getBoundingClientRect`
 * stubbeado y un div del happy-dom como contenedor.
 */

/** Resolución base del juego (misma constante de gameConfig, en línea acá
 * para que el test no dependa de la fábrica de config de Phaser). */
const GAME_WIDTH = 720;

/** Rect real medido en un viewport 390×844 con letterbox (issue #21). */
const LETTERBOX_RECT: DomSyncRect = { left: 0, top: 113, width: 390 };

/** Canvas fake: devuelve el rect que le pasen. */
function fakeCanvas(rect: DomSyncRect | { width: number }): HTMLCanvasElement {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      height: 0,
      toJSON: () => ({}),
      ...rect,
    }),
  } as unknown as HTMLCanvasElement;
}

/** Juego fake con contenedor DOM real (happy-dom) y canvas stubbeado. */
function fakeGame(rect: DomSyncRect, overrides: Partial<DomSyncGame> = {}): DomSyncGame {
  return {
    canvas: fakeCanvas(rect),
    domContainer: document.createElement('div'),
    scale: { on: vi.fn() },
    ...overrides,
  };
}

describe('buildDomContainerTransform (pura: rect → transform CSS)', () => {
  it('translate al left/top del rect + escala por ancho de juego (números redondos)', () => {
    // Canvas de 360 CSS px para un juego de 720: escala exactamente 0.5.
    expect(buildDomContainerTransform({ left: 75, top: 0, width: 360 }, GAME_WIDTH)).toBe(
      'translate(75px, 0px) scale(0.5)',
    );
  });

  it('con letterbox (viewport 390×844, issue #21) cubre el rect real del canvas', () => {
    // 390/720 = 0.541666…: el transform esperado tal como lo escribe el sync.
    expect(buildDomContainerTransform(LETTERBOX_RECT, GAME_WIDTH)).toBe(
      `translate(0px, 113px) scale(${390 / 720})`,
    );
  });

  it('acepta offsets negativos (el caso roto pre-fix: contenedor en (-165, -180))', () => {
    expect(buildDomContainerTransform({ left: -165, top: -180, width: 720 }, GAME_WIDTH)).toBe(
      'translate(-165px, -180px) scale(1)',
    );
  });
});

describe('syncDomContainerToCanvas (aplica el transform al contenedor)', () => {
  it('ancla el contenedor al viewport y le aplica el transform del rect', () => {
    const game = fakeGame(LETTERBOX_RECT);
    syncDomContainerToCanvas(game, GAME_WIDTH);

    const style = game.domContainer?.style;
    // position: fixed + left/top/margin en 0 → el translate usa coordenadas de
    // viewport puro, sin depender del layout flex/safe-areas de #game.
    expect(style?.position).toBe('fixed');
    expect(style?.left).toBe('0px');
    expect(style?.top).toBe('0px');
    expect(style?.marginLeft).toBe('0px');
    expect(style?.marginTop).toBe('0px');
    expect(style?.transformOrigin).toBe('0 0');
    expect(style?.transform).toBe('translate(0px, 113px) scale(0.5416666666666666)');
  });

  it('rect sin layout (ancho 0): deja el transform previo, no aplica basura', () => {
    const game = fakeGame({ left: 0, top: 0, width: 0 });
    game.domContainer?.style.setProperty('transform', 'scale(0.5)');
    syncDomContainerToCanvas(game, GAME_WIDTH);

    expect(game.domContainer?.style.transform).toBe('scale(0.5)');
  });

  it('sin contenedor DOM (fake de Phaser.Game de mainDebugMode) es no-op', () => {
    const game = fakeGame(LETTERBOX_RECT, { domContainer: null });
    expect(() => syncDomContainerToCanvas(game, GAME_WIDTH)).not.toThrow();
  });

  it('si leer el rect del canvas lanza, la sincronización no toca el juego', () => {
    const game = fakeGame(LETTERBOX_RECT);
    game.canvas = {
      getBoundingClientRect: () => {
        throw new Error('rect roto (fake)');
      },
    } as unknown as HTMLCanvasElement;

    expect(() => syncDomContainerToCanvas(game, GAME_WIDTH)).not.toThrow();
  });
});

describe('installDomContainerSync (enganche al ScaleManager)', () => {
  it('se subscribe a `resize` (Phaser.Scale.Events.RESIZE) y sincroniza al instante', () => {
    const game = fakeGame(LETTERBOX_RECT);
    installDomContainerSync(game, GAME_WIDTH);

    expect(game.scale?.on).toHaveBeenCalledWith('resize', expect.any(Function));
    // Sync inmediato: cubre el caso de un RESIZE de boot ya emitido.
    expect(game.domContainer?.style.transform).toBe('translate(0px, 113px) scale(0.5416666666666666)');
  });

  it('cada `resize` posterior re-aplica el transform con el rect vigente', () => {
    const game = fakeGame(LETTERBOX_RECT);
    installDomContainerSync(game, GAME_WIDTH);

    // Rotación/reflow: el canvas cambia de rect y "llega" un resize.
    (game.canvas as unknown as { getBoundingClientRect: () => DomSyncRect }).getBoundingClientRect =
      () => ({ left: 75, top: 20, width: 360 });
    const handler = (game.scale?.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as () => void;
    handler();

    expect(game.domContainer?.style.transform).toBe('translate(75px, 20px) scale(0.5)');
  });

  it('un scale sin `on` (fakes de main.ts) no rompe el arranque', () => {
    const game = fakeGame(LETTERBOX_RECT, { scale: undefined });
    expect(() => installDomContainerSync(game, GAME_WIDTH)).not.toThrow();
    expect(game.domContainer?.style.transform).toBe('translate(0px, 113px) scale(0.5416666666666666)');
  });
});
