import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MENU, TRACK_PICKER } from '../config/balance';
import { onlineMenuButtonLabel } from '../chat/dmView';
import { PLAYER_PROFILE_REGISTRY_KEY, type PlayerProfile } from '../data/PlayerProfileRepository';
import { TRACKS } from '../race/tracks';
import { GameScene } from '../scenes/GameScene';
import { MenuScene } from '../scenes/MenuScene';
import { RaceScene } from '../scenes/RaceScene';

/**
 * Tests de REGRESIÓN de la sección EN LÍNEA (issue #22, Fase 2): lo que la
 * unificación de MULTIJUGADOR + CHAT en un solo botón NO debía romper, más
 * los invariantes del nuevo diseño.
 *
 * Cobertura que vive en otros archivos y NO se duplica acá:
 * - El flujo completo de identidad (abrir subpantalla, escribir nombre,
 *   CHAT guarda el perfil Y lanza ChatScene) y el feedback "INGRESÁ TU
 *   NOMBRE" de #21 (goLobby y goChat sin nombre) están en
 *   `multiplayerInputFlow.test.ts`, que aserta AMBOS contratos del CHAT
 *   (perfil guardado + `launch(ChatScene.KEY, { tab: 'public' })`).
 * - El contrato del badge con 0/1/7/-1 no leídos está en `dmView.test.ts`.
 * - La geometría (EN LÍNEA no se pisa con JUGAR ni con la ayuda) está en
 *   `scoreSystem.test.ts`.
 *
 * Lo que SÍ vive acá:
 * 1. Config: MENU ya no define las claves del cuarto y quinto botón
 *    (multiY/chatY y familia) y define las nuevas online*; helpY en su nuevo
 *    valor 1180. Regresión de config: que nadie vuelva a agregar el cuarto
 *    botón sin quitar los otros.
 * 2. El caso faltante del contrato del label: `totalUnread` undefined
 *    (sesión a medio armar / store viejo) debe mostrar el label limpio, no
 *    "EN LÍNEA · undefined".
 * 3. El resto del menú intacto: JUGAR arranca GameScene y GRAN PREMIO abre
 *    el selector de pistas que lanza RaceScene (nadie los testea con el
 *    layout nuevo). Incluye la guarda cruzada: con la subpantalla EN LÍNEA
 *    abierta, ni Enter ni GRAN PREMIO navegan por debajo.
 * 4. Sin código muerto del viejo overlay multijugador de M1.
 * 5. Telemetría #27: los DOS arranques locales del menú reportan
 *    `partida_iniciada` — JUGAR como 'entrenar' y elegir pista en GRAN
 *    PREMIO como 'gran_premio' (pista + dificultad seleccionada).
 */

/* ------------------------------------------------------------------ */
/* 1. Config — un solo botón en línea (regresión de balance.ts)        */
/* ------------------------------------------------------------------ */

describe('MENU — un solo botón EN LÍNEA (issue #22)', () => {
  it('ya NO define las claves del viejo MULTIJUGADOR/CHAT del menú', () => {
    // Nombres exactos de las claves que el botón unificado reemplazó (git:
    // ad6fe73~1). Si alguien re-agrega un cuarto/quinto botón reusando estos
    // nombres sin quitar los otros, el layout vuelve a tener dos entradas
    // online: este test lo corta.
    const clavesMuertas = [
      'multiY',
      'multiWidth',
      'multiFontSize',
      'chatY',
      'chatWidth',
      'chatFontSize',
    ];
    for (const clave of clavesMuertas) {
      expect(clave in MENU, `MENU no debería volver a definir "${clave}"`).toBe(false);
    }
  });

  it('SÍ define el botón EN LÍNEA completo (onlineY/Width/Height/FontSize numéricos)', () => {
    for (const clave of ['onlineY', 'onlineWidth', 'onlineHeight', 'onlineFontSize'] as const) {
      expect(typeof MENU[clave], `MENU.${clave} debe ser un número`).toBe('number');
    }
  });

  it('helpY quedó en su nuevo valor 1180 (el aire del quinto botón se repartió)', () => {
    expect(MENU.helpY).toBe(1180);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Label del botón EN LÍNEA — el caso que dmView.test no cubre      */
/* ------------------------------------------------------------------ */

describe('onlineMenuButtonLabel — totalUnread undefined', () => {
  it('con undefined muestra el label limpio "EN LÍNEA", nunca "· undefined"', () => {
    // La firma pide `number`, pero el valor llega de
    // `social.store.totalUnread` a través de una cadena de módulos: un store
    // a medio inicializar o viejo puede entregar undefined. El badge es una
    // superficie SIEMPRE visible: pintar "EN LÍNEA · undefined" en el menú
    // sería un bug de presentacion visible; el contrato defensivo es caer al
    // label base (igual que ya hace con 0 y negativos, ver dmView.test.ts).
    expect(onlineMenuButtonLabel(undefined as unknown as number)).toBe('EN LÍNEA');
  });
});

/* ------------------------------------------------------------------ */
/* Harness mínimo de MenuScene (misma técnica que                     */
/* multiplayerInputFlow.test.ts): escena REAL + plomería fake.        */
/* Acá no corre create(): se invocan los handlers privados            */
/* `startGame`/`openTrackPicker`/`openOnlineOverlay` directamente.    */
/* ------------------------------------------------------------------ */

type Handler = (...args: unknown[]) => void;

/** Texto fake: guarda estado mínimo (`.text`, `visible`, `alpha`). */
interface FakeText {
  text: string;
  x: number;
  y: number;
  alpha: number;
  visible: boolean;
  setOrigin(..._args: unknown[]): FakeText;
  setStroke(..._args: unknown[]): FakeText;
  setColor(..._args: unknown[]): FakeText;
  setText(value: string): FakeText;
  setVisible(value: boolean): FakeText;
  setAlpha(value: number): FakeText;
}

function makeFakeText(texts: FakeText[], x: number, y: number, content: string): FakeText {
  const self: FakeText = {
    x,
    y,
    text: content,
    alpha: 1,
    visible: true,
    setOrigin: () => self,
    setStroke: () => self,
    setColor: () => self,
    setText: (value) => {
      self.text = value;
      return self;
    },
    setVisible: (value) => {
      self.visible = value;
      return self;
    },
    setAlpha: (value) => {
      self.alpha = value;
      return self;
    },
  };
  texts.push(self);
  return self;
}

/** Rectángulo fake (velo/paneles): chainable + handlers de pointerdown. */
interface FakeRectangle {
  setStrokeStyle(..._args: unknown[]): FakeRectangle;
  setInteractive(): FakeRectangle;
  on(event: string, handler: Handler): FakeRectangle;
}

function makeFakeRectangle(): FakeRectangle {
  const handlers = new Map<string, Handler[]>();
  const rect: FakeRectangle = {
    setStrokeStyle: () => rect,
    setInteractive: () => rect,
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return rect;
    },
  };
  return rect;
}

/** Contenedor fake (overlays y contenedores de MenuButton). */
interface FakeContainer {
  x: number;
  y: number;
  depth: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  list: unknown[];
  input: { cursor: string } | null;
  destroyed: boolean;
  add(children: unknown): FakeContainer;
  setDepth(depth: number): FakeContainer;
  setSize(width: number, height: number): FakeContainer;
  setScale(scale: number): FakeContainer;
  setInteractive(shape: unknown, callback: unknown): FakeContainer;
  on(event: string, handler: Handler): FakeContainer;
  emit(event: string, ...args: unknown[]): void;
  destroy(): void;
}

function makeFakeContainer(containers: FakeContainer[], x: number, y: number): FakeContainer {
  const handlers = new Map<string, Handler[]>();
  const container: FakeContainer = {
    x,
    y,
    depth: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    list: [],
    input: null,
    destroyed: false,
    add: (children) => {
      if (Array.isArray(children)) {
        container.list.push(...children);
      } else {
        container.list.push(children);
      }
      return container;
    },
    setDepth: (depth) => {
      container.depth = depth;
      return container;
    },
    setSize: (width, height) => {
      container.width = width;
      container.height = height;
      return container;
    },
    setScale: (scale) => {
      container.scaleX = scale;
      container.scaleY = scale;
      return container;
    },
    setInteractive: (shape, callback) => {
      container.input = {
        cursor: 'default',
        ...(shape !== undefined ? { hitArea: shape } : {}),
        ...(callback !== undefined ? { hitAreaCallback: callback } : {}),
      };
      return container;
    },
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return container;
    },
    emit: (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    destroy: () => {
      container.destroyed = true;
    },
  };
  containers.push(container);
  return container;
}

/** Wrapper DOM del input de nombre (solo se crea al abrir EN LÍNEA). */
interface FakeDomElement {
  node: HTMLInputElement;
  destroyed: boolean;
  setOrigin(): FakeDomElement;
  setDepth(): FakeDomElement;
  destroy(): void;
}

function makeFakeDomElement(tag: string): FakeDomElement {
  const el: FakeDomElement = {
    node: document.createElement(tag) as HTMLInputElement,
    destroyed: false,
    setOrigin: () => el,
    setDepth: () => el,
    destroy: () => {
      el.destroyed = true;
    },
  };
  return el;
}

interface MenuHarness {
  /** Handlers privados de la escena (el comportamiento bajo test). */
  startGame(): void;
  openTrackPicker(): void;
  openOnlineOverlay(): void;
  /** Dispara el `pointerdown` del botón (dentro del overlay) con esa etiqueta. */
  press(label: string): void;
  findText(content: string): FakeText | undefined;
  sceneStart: ReturnType<typeof vi.fn>;
  sceneLaunch: ReturnType<typeof vi.fn>;
  /** El overlay EN LÍNEA (campo privado `onlineOverlay`). */
  overlayContainer(): FakeContainer;
  /** El overlay del selector de pistas (campo privado `trackOverlay`). */
  trackOverlayContainer(): FakeContainer;
}

function createMenuHarness(options: { storedName?: string } = {}): MenuHarness {
  const texts: FakeText[] = [];
  const containers: FakeContainer[] = [];
  const savedProfiles: PlayerProfile[] = [];
  const sceneStart = vi.fn();
  const sceneLaunch = vi.fn();

  const add = {
    container: (x: number, y: number): FakeContainer => makeFakeContainer(containers, x, y),
    rectangle: (): FakeRectangle => makeFakeRectangle(),
    text: (x: number, y: number, content: string): FakeText => makeFakeText(texts, x, y, content),
    dom: (_x: number, _y: number, tag: string): FakeDomElement => makeFakeDomElement(tag),
    image: (): { setScale(): unknown } => ({ setScale: () => undefined }),
    tileSprite: (): { tilePositionY: number } => ({ tilePositionY: 0 }),
  };

  const registryData = new Map<string, unknown>();
  registryData.set(PLAYER_PROFILE_REGISTRY_KEY, {
    load: (): PlayerProfile => ({ name: options.storedName ?? '' }),
    save: (profile: PlayerProfile): void => {
      savedProfiles.push({ ...profile });
    },
  });

  const scene = new MenuScene();
  Object.assign(scene, {
    add,
    scale: { width: 720, height: 1280 },
    registry: {
      get: (key: string): unknown => registryData.get(key),
      set: (key: string, value: unknown): unknown => registryData.set(key, value),
    },
    scene: {
      start: sceneStart,
      launch: sceneLaunch,
      get: vi.fn(() => null),
      add: vi.fn(),
    },
    tweens: {
      killTweensOf: vi.fn(),
      add: (config: Record<string, unknown>): Record<string, unknown> => config,
    },
  });

  const internals = scene as unknown as {
    startGame(): void;
    openTrackPicker(): void;
    openOnlineOverlay(): void;
    onlineOverlay: FakeContainer | null;
    trackOverlay: FakeContainer | null;
  };

  return {
    startGame: () => internals.startGame(),
    openTrackPicker: () => internals.openTrackPicker(),
    openOnlineOverlay: () => internals.openOnlineOverlay(),
    press: (label) => {
      const button = containers.find((candidate) =>
        candidate.list.some(
          (child) =>
            typeof child === 'object' &&
            child !== null &&
            'text' in child &&
            (child as FakeText).text === label,
        ),
      );
      if (!button) {
        throw new Error(`botón "${label}" no encontrado`);
      }
      button.emit('pointerdown');
    },
    findText: (content) => texts.find((candidate) => candidate.text === content),
    sceneStart,
    sceneLaunch,
    overlayContainer: () => {
      // El campo privado `onlineOverlay` apunta al contenedor raíz abierto.
      expect(internals.onlineOverlay).not.toBeNull();
      return internals.onlineOverlay as FakeContainer;
    },
    trackOverlayContainer: () => {
      // Ídem para `trackOverlay`: el contenedor raíz del selector.
      expect(internals.trackOverlay).not.toBeNull();
      return internals.trackOverlay as FakeContainer;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 3. El resto del menú intacto                                        */
/* ------------------------------------------------------------------ */

describe('MenuScene — JUGAR sigue arrancando GameScene (layout #22)', () => {
  it('Enter/JUGAR arranca GameScene cuando no hay subpantalla abierta', () => {
    const harness = createMenuHarness();

    harness.startGame();

    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(GameScene.KEY);
    expect(harness.sceneLaunch).not.toHaveBeenCalled();
  });

  it('con la subpantalla EN LÍNEA abierta, Enter NO arranca una carrera atravesada', () => {
    const harness = createMenuHarness();
    harness.openOnlineOverlay();
    expect(harness.findText('EN LÍNEA')).toBeDefined();

    harness.startGame();
    expect(harness.sceneStart).not.toHaveBeenCalled();

    // Cerrada la subpantalla, el camino normal vuelve a estar vivo.
    harness.press('CERRAR');
    harness.startGame();
    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(GameScene.KEY);
  });
});

describe('MenuScene — GRAN PREMIO sigue abriendo el selector de pistas', () => {
  it('abre el overlay GRAN PREMIO con las 6 pistas del registro', () => {
    const harness = createMenuHarness();

    harness.openTrackPicker();

    expect(harness.findText('GRAN PREMIO')).toBeDefined();
    for (const track of TRACKS) {
      expect(harness.findText(track.name), `falta la fila de ${track.name}`).toBeDefined();
    }
  });

  it('tocar una pista lanza RaceScene en VS CPU (con dificultad default) y cierra el selector', () => {
    const harness = createMenuHarness();
    harness.openTrackPicker();
    // Referencia previa al tap: al lanzar la carrera el selector ya se cerró
    // (el campo privado queda en null) y el destroy es lo que hay que asertar.
    const overlay = harness.trackOverlayContainer();

    harness.press(TRACKS[0].name);

    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(
      RaceScene.KEY,
      expect.objectContaining({
        trackId: TRACKS[0].id,
        mode: 'vs-cpu',
        difficulty: 'normal',
      }),
    );
    const [, data] = harness.sceneStart.mock.calls[0] as [string, { seed: unknown }];
    expect(typeof data.seed).toBe('number');
    expect(overlay.destroyed).toBe(true);
  });

  it('con la subpantalla EN LÍNEA abierta, GRAN PREMIO no apila su overlay encima', () => {
    const harness = createMenuHarness();
    harness.openOnlineOverlay();

    harness.openTrackPicker();

    expect(harness.findText('GRAN PREMIO')).toBeUndefined();
    expect(harness.sceneStart).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 3c. Telemetría #27 — partida_iniciada en los arranques del menú     */
/* ------------------------------------------------------------------ */

/**
 * El menú tiene DOS entradas de partida y cada una reporta UN
 * `partida_iniciada` con properties agregadas y sin PII (issue #27):
 * - JUGAR (modo infinito/práctica libre, GameScene) → modo 'entrenar'.
 * - Elegir pista en GRAN PREMIO (RaceScene vs CPU) → modo 'gran_premio' +
 *   pista (TrackId) + dificultad (id `CpuDifficulty`: 'easy'|'normal'|'hard').
 * El espía es `window.posthog.capture` (el mismo contrato que usa el
 * wrapper), instalado por test y borrado en afterEach para no contaminar
 * al resto de la suite.
 */
describe('MenuScene — telemetría partida_iniciada (issue #27)', () => {
  afterEach(() => {
    delete window.posthog;
  });

  function installCapture(): ReturnType<typeof vi.fn> {
    const capture = vi.fn();
    window.posthog = { capture };
    return capture;
  }

  it('JUGAR (modo entrenar) reporta exactamente { modo: "entrenar" }', () => {
    const capture = installCapture();
    const harness = createMenuHarness();

    harness.startGame();

    expect(capture).toHaveBeenCalledTimes(1);
    // Igualdad EXACTA: sin properties de más (sin pista/dificultad, que acá
    // no aplican, y sin nada que huela a PII).
    expect(capture).toHaveBeenCalledWith('partida_iniciada', { modo: 'entrenar' });
  });

  it('elegir pista en GRAN PREMIO reporta { modo, pista, dificultad } con la dificultad default', () => {
    const capture = installCapture();
    const harness = createMenuHarness();

    harness.openTrackPicker();
    harness.press(TRACKS[0].name);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('partida_iniciada', {
      modo: 'gran_premio',
      pista: TRACKS[0].id,
      dificultad: 'normal', // DEFAULT_CPU_DIFFICULTY, la misma que viaja a RaceScene
    });
  });

  it('la dificultad elegida en el selector viaja como su id (DIFÍCIL → "hard")', () => {
    const capture = installCapture();
    const harness = createMenuHarness();

    harness.openTrackPicker();
    harness.press('DIFÍCIL');
    harness.press(TRACKS[TRACKS.length - 1].name);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('partida_iniciada', {
      modo: 'gran_premio',
      pista: TRACKS[TRACKS.length - 1].id,
      dificultad: 'hard',
    });
  });

  it('con una subpantalla abierta, Enter NO reporta partida (guarda previa al trackEvent)', () => {
    const capture = installCapture();
    const harness = createMenuHarness();
    harness.openOnlineOverlay();

    harness.startGame();

    expect(capture).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 3b. Layout del selector de GRAN PREMIO con 6 pistas (issue #26)     */
/* ------------------------------------------------------------------ */

/**
 * El registro pasó a 6 pistas y el overlay compactó sus filas para que la
 * última no pise el bloque de DIFICULTAD (#26). Los invariantes de las
 * CONSTANTES viven en `balance.test.ts` (aritmética pura sobre
 * `TRACK_PICKER`); acá se verifica la otra mitad del contrato: que la escena
 * pinta las filas EN las posiciones de esas constantes (nadie hardcodeó un
 * `y` paralelo) y que lo dibujado — leído del contenedor real del overlay —
 * no se solapa.
 */
describe('MenuScene — GRAN PREMIO: las 6 filas viven dentro del panel (#26)', () => {
  /** Type guards sobre los fakes del harness. */
  const isContainer = (child: unknown): child is FakeContainer =>
    typeof child === 'object' && child !== null && 'list' in child;
  const isText = (child: unknown): child is FakeText =>
    typeof child === 'object' && child !== null && 'text' in child;

  /** Textos hijos directos de un contenedor (la etiqueta de un botón). */
  const ownTexts = (container: FakeContainer): FakeText[] => container.list.filter(isText);

  /** Borde inferior de una fila completa: el hint cuelga bajo el botón. */
  const rowBottom = (rowY: number): number =>
    rowY + TRACK_PICKER.rowHeight / 2 + TRACK_PICKER.hintGap + TRACK_PICKER.hintFontSize;

  it('pinta una fila por pista en las Y de TRACK_PICKER y sin solapamientos', () => {
    const harness = createMenuHarness();
    harness.openTrackPicker();
    const overlay = harness.trackOverlayContainer();

    // Cada fila es un contenedor con exactamente 2 hijos: el botón
    // (MenuButton) y el hint del circuito inspirador.
    const rowContainers = overlay.list.filter(isContainer).filter((candidate) => candidate.list.length === 2);
    expect(rowContainers, 'una fila por pista del registro').toHaveLength(TRACKS.length);

    // El centro Y de cada fila es el que dicta la constante (orden TRACKS).
    const rowYs = rowContainers.map((row) => {
      const button = row.list.filter(isContainer).find((candidate) =>
        ownTexts(candidate).some((label) => TRACKS.some((track) => track.name === label.text)),
      );
      expect(button, 'cada fila contiene el botón con el nombre de una pista').toBeDefined();
      return (button as FakeContainer).y;
    });
    rowYs.forEach((y, index) => {
      expect(y).toBe(TRACK_PICKER.rowStartY + index * TRACK_PICKER.rowStep);
    });

    // Sin solapamientos entre filas (botón arranca debajo del hint previo).
    for (let index = 1; index < rowYs.length; index += 1) {
      expect(rowYs[index] - TRACK_PICKER.rowHeight / 2, `la fila ${index} pisa la fila ${index - 1}`)
        .toBeGreaterThanOrEqual(rowBottom(rowYs[index - 1]));
    }

    // Condición dura del issue: hint de la última fila ≥ 16 px arriba del
    // rótulo DIFICULTAD DEL RIVAL (que la escena dibuja en difficultyLabelY).
    const label = harness.findText('DIFICULTAD DEL RIVAL');
    expect(label, 'falta el rótulo DIFICULTAD DEL RIVAL').toBeDefined();
    expect(label?.y).toBe(TRACK_PICKER.difficultyLabelY);
    expect(
      rowBottom(rowYs[rowYs.length - 1]) + 16,
      'el hint de la última fila pisa el rótulo de dificultad',
    ).toBeLessThanOrEqual(label!.y - TRACK_PICKER.difficultyLabelFontSize / 2);

    // CERRAR debajo de los botones de dificultad y completo dentro del panel.
    expect(
      TRACK_PICKER.closeY - TRACK_PICKER.closeHeight / 2,
      'CERRAR pisa los botones de dificultad',
    ).toBeGreaterThanOrEqual(TRACK_PICKER.difficultyRowY + TRACK_PICKER.difficultyButtonHeight / 2);
    expect(TRACK_PICKER.closeY + TRACK_PICKER.closeHeight / 2).toBeLessThanOrEqual(
      TRACK_PICKER.panelY + TRACK_PICKER.panelHeight / 2,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 4. Sin código muerto del viejo overlay multijugador (M1)            */
/* ------------------------------------------------------------------ */

/**
 * El issue #22 RENOMBRÓ el overlay multijugador de M1 a la subpantalla EN
 * LÍNEA (`multi*` → `online*`). Si cualquiera de estos identificadores
 * vuelve por un merge de una rama vieja, es un camino zombi que puede
 * convivir con el nuevo (dos overlays, dos inputs de nombre) sin romper un
 * test de comportamiento. Un test de contenido con readFileSync + regex es
 * válido y barato acá: no necesita bootear nada y documenta que el viejo
 * API NO debe existir ni siquiera como código muerto.
 */

/** npm test corre desde la raíz del repo (mismo supuesto que previewConfig). */
const SRC_ROOT = resolve(process.cwd(), 'src');

/** Regex de los identificadores del viejo overlay multijugador. */
const DEAD_MULTI_IDENTIFIERS =
  /openMultiplayerOverlay|closeMultiplayerOverlay|multiNameInput|multiOverlay/;

function collectTsSourceFiles(dir: string, skipDir = '__tests__'): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Los tests mencionan los viejos nombres en comentarios/documentación:
      // el contrato vale para el código de producción.
      if (entry.name === skipDir) {
        continue;
      }
      files.push(...collectTsSourceFiles(join(dir, entry.name), skipDir));
    } else if (entry.name.endsWith('.ts')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe('sin código muerto del viejo overlay multijugador (issue #22)', () => {
  it('ningún .ts de src (fuera de tests) menciona el API multi* reemplazado', () => {
    const offenders = collectTsSourceFiles(SRC_ROOT)
      .filter((file) => DEAD_MULTI_IDENTIFIERS.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${SRC_ROOT}/`, ''));

    expect(offenders).toEqual([]);
  });
});
