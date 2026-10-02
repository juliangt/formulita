import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEBUG_STORAGE_KEY } from '../config/debugFlags';

/**
 * Tests del gating del modo debug en `main.ts` (issue #16).
 *
 * `main.ts` ejecuta `bootstrap()` al IMPORTARSE (efecto de módulo), así que
 * cada test re-importa el módulo fresco (`vi.resetModules` + `import()`)
 * después de armar el DOM con el contenedor `#game` que bootstrap exige.
 * Para que el import sea liviano y observable se mockean:
 * - `phaser`: `Phaser.Game` queda reemplazado por un fake que registra las
 *   instancias en `games` (con `scale.refresh` y `canvas.getBoundingClientRect`
 *   espiables, y el `transformPointer` original guardado en `baseTransform`).
 * - `../config/gameConfig`: main solo necesita las constantes y la fábrica de
 *   config; mockearla evita arrastrar todas las escenas.
 *
 * El flag se prende por la vía persistente (localStorage) antes del import,
 * que es exactamente cómo lo hace quien depura en el teléfono.
 */

/** Forma de los juegos fake creados por el mock de Phaser.Game. */
interface FakeGame {
  config: unknown;
  /** transformPointer ORIGINAL, capturado antes de que main.ts lo envuelva. */
  baseTransform: Mock;
  input: { transformPointer: unknown };
  scale: { refresh: Mock };
  canvas: { getBoundingClientRect: Mock };
}

/** Instancias creadas por el mock de Phaser.Game durante cada import. */
const { games } = vi.hoisted(() => {
  return {
    games: [] as Array<{
      config: unknown;
      baseTransform: Mock;
      input: { transformPointer: unknown };
      scale: { refresh: Mock };
      canvas: { getBoundingClientRect: Mock };
    }>,
  };
});

vi.mock('phaser', () => {
  class FakeGame {
    config: unknown;
    baseTransform: Mock;
    input: { transformPointer: unknown };
    scale: { refresh: Mock };
    canvas: { getBoundingClientRect: Mock };

    constructor(config: unknown) {
      this.config = config;
      this.baseTransform = vi.fn();
      this.input = { transformPointer: this.baseTransform };
      this.scale = { refresh: vi.fn() };
      // Rect fijo: el canvas mide 360x640 CSS px y cuelga en (10, 20).
      this.canvas = {
        getBoundingClientRect: vi.fn(() => ({
          left: 10,
          top: 20,
          width: 360,
          height: 640,
          right: 370,
          bottom: 660,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        })),
      };
      games.push(this);
    }
  }

  return { default: { Game: FakeGame } };
});

vi.mock('../config/gameConfig', () => ({
  GAME_WIDTH: 720,
  GAME_HEIGHT: 1280,
  createGameConfig: () => ({ fake: true }),
}));

/** Firma del wrapper que installTransformGuard instala sobre transformPointer. */
type TransformWrapper = (
  pointer: { x: number; y: number },
  pageX: number,
  pageY: number,
  wasMove: boolean,
) => void;

function wrapperOf(game: FakeGame): TransformWrapper {
  return game.input.transformPointer as TransformWrapper;
}

/** El div del anillo de tap (z-index 30, único en el DOM creado por main). */
function echoRing(): HTMLDivElement | undefined {
  return [...document.body.querySelectorAll('div')].find((d) => d.style.zIndex === '30');
}

/** El div del tag de build (z-index 20, esquina inferior derecha). */
function buildTag(): HTMLDivElement | undefined {
  return [...document.body.querySelectorAll('div')].find((d) => d.style.zIndex === '20');
}

/** Importa main.ts fresco: dispara installGestureGuards() + bootstrap(). */
async function importMain(): Promise<FakeGame> {
  await import('../main');
  expect(games.length).toBe(1);
  return games[0];
}

beforeEach(() => {
  vi.resetModules();
  games.length = 0;
  localStorage.clear();
  document.body.innerHTML = '<div id="game"></div>';
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('main.ts — debug OFF por defecto (issue #16)', () => {
  it('sin flag no deja rastro de diagnóstico: ni el anillo ni el tag de build', async () => {
    await importMain();

    expect(echoRing()).toBeUndefined();
    expect(buildTag()).toBeUndefined();
    // En el body solo vive el contenedor del juego que armó el test.
    expect(document.body.querySelectorAll('div')).toHaveLength(1);
  });

  it('el fix iOS NO está detrás del flag: cada transform refresca la escala y delega', async () => {
    const game = await importMain();
    const wrapper = wrapperOf(game);

    const pointer = { x: 100, y: 200 };
    wrapper(pointer, 100, 200, false);
    wrapper(pointer, 100, 200, true);

    // Un refresh por evento de input (el fix de iOS corre siempre).
    expect(game.scale.refresh).toHaveBeenCalledTimes(2);
    // El wrapper ENVUELVE al transform original: la delegación sigue intacta.
    expect(game.baseTransform).toHaveBeenCalledTimes(2);
    expect(game.baseTransform).toHaveBeenNthCalledWith(1, pointer, 100, 200, false);
    expect(game.baseTransform).toHaveBeenNthCalledWith(2, pointer, 100, 200, true);
  });

  it('el modo debug se resuelve una sola vez al arrancar (no en cada transform)', async () => {
    const game = await importMain();
    const wrapper = wrapperOf(game);

    // "Alguien" prende el flag DESPUÉS del arranque: no debe aparecer nada.
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    wrapper({ x: 100, y: 200 }, 100, 200, false);

    expect(echoRing()).toBeUndefined();
    expect(buildTag()).toBeUndefined();
  });
});

describe('main.ts — debug ON: anillo de tap', () => {
  it('el anillo se crea al arrancar y marca la proyección del tap en CSS px', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    const game = await importMain();

    const ring = echoRing();
    expect(ring).toBeDefined();
    expect(ring?.style.opacity).toBe('0'); // nace apagado

    // Proyección con rect {left:10, top:20, 360x640} y juego base 720x1280:
    // tap en (100, 200) de juego → (10 + 100/720*360, 20 + 200/1280*640).
    vi.useFakeTimers();
    wrapperOf(game)({ x: 100, y: 200 }, 100, 200, false);

    expect(ring?.style.left).toBe('60px');
    expect(ring?.style.top).toBe('120px');
    expect(ring?.style.opacity).toBe('1');

    // El eco se apaga solo a los 250 ms.
    vi.advanceTimersByTime(260);
    expect(ring?.style.opacity).toBe('0');
  });

  it('un segundo tap reposiciona el anillo', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    const game = await importMain();
    const ring = echoRing();
    expect(ring).toBeDefined();

    wrapperOf(game)({ x: 100, y: 200 }, 100, 200, false);
    expect(ring?.style.left).toBe('60px');

    wrapperOf(game)({ x: 0, y: 0 }, 0, 0, false);
    expect(ring?.style.left).toBe('10px');
    expect(ring?.style.top).toBe('20px');
    expect(ring?.style.opacity).toBe('1');
  });

  it('los moves y las coordenadas no finitas no actualizan el anillo', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    const game = await importMain();
    const ring = echoRing();
    expect(ring).toBeDefined();

    wrapperOf(game)({ x: 0, y: 0 }, 0, 0, false);
    expect(ring?.style.left).toBe('10px');
    expect(ring?.style.top).toBe('20px');

    // Move: solo refresca la escala, no toca el anillo.
    wrapperOf(game)({ x: 500, y: 500 }, 500, 500, true);
    expect(ring?.style.left).toBe('10px');
    expect(ring?.style.top).toBe('20px');

    // Puntero sin coordenadas válidas: tampoco.
    wrapperOf(game)({ x: Number.NaN, y: 500 }, 0, 0, false);
    expect(ring?.style.left).toBe('10px');
    expect(ring?.style.top).toBe('20px');

    // Pero el refresh del fix iOS corrió en los tres eventos.
    expect(game.scale.refresh).toHaveBeenCalledTimes(3);
  });

  it('si leer el rect del canvas falla, el input sigue (el eco es solo diagnóstico)', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    const game = await importMain();

    game.canvas.getBoundingClientRect.mockImplementation(() => {
      throw new Error('rect roto (fake)');
    });

    expect(() => wrapperOf(game)({ x: 1, y: 1 }, 1, 1, false)).not.toThrow();
    // El fix iOS corre ANTES del eco: igual se refrescó la escala.
    expect(game.scale.refresh).toHaveBeenCalledTimes(1);
    expect(game.baseTransform).toHaveBeenCalledTimes(1);
  });
});

describe('main.ts — debug ON: tag de build', () => {
  it('el tag de build aparece en el DOM al arrancar con debug', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    await importMain();

    const tag = buildTag();
    expect(tag).toBeDefined();
    // En tests import.meta.url no es un bundle con hash → el fallback es "dev".
    expect(tag?.textContent).toMatch(/^build /);
    expect(tag?.style.pointerEvents).toBe('none');
  });
});
