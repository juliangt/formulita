import { describe, expect, it, vi } from 'vitest';
import { MenuScene } from '../scenes/MenuScene';
import { ChatScene } from '../scenes/ChatScene';
import { LobbyScene } from '../scenes/LobbyScene';
import { PLAYER_PROFILE_REGISTRY_KEY, type PlayerProfile } from '../data/PlayerProfileRepository';
import { syncDomContainerToCanvas, type DomSyncGame } from '../core/domContainerSync';

/**
 * Tests de REGRESIÓN del issue #21 (adaptados a la subpantalla EN LÍNEA del
 * issue #22) — flujo online del menú + matemática del letterbox del
 * contenedor DOM.
 *
 * Dos comportamientos medidos en el issue:
 *
 * 1. FEEDBACK SIN NOMBRE: tocar CREAR SALA/UNIRSE con el input vacío era un
 *    `return` silencioso (botones que parecían muertos). Ahora muestra el
 *    texto "INGRESÁ TU NOMBRE" en la escena y se apaga apenas se escribe.
 *    Con nombre: arranca LobbyScene con `{ mode, name }`.
 *    Issue #22 — el botón CHAT de la subpantalla EN LÍNEA comparte el MISMO
 *    contrato de identidad: sin nombre muestra el aviso y NO abre el chat;
 *    con nombre guarda el perfil y lanza ChatScene (tab PÚBLICO).
 *
 * 2. LETTERBOX (el corazón): en un viewport 390×844 el canvas queda en
 *    (0, 113) de 390×693, pero Phaser 4.2.1 dejaba el contenedor DOM afuera
 *    del viewport (medido: (-165, -180) con scale 0.5417) → los inputs DOM
 *    invisibles. El fix (`syncDomContainerToCanvas`) re-ancla el contenedor al
 *    rect REAL del canvas; acá se verifica que un elemento colocado en
 *    coordenadas de juego caiga EXACTAMENTE donde el canvas pinta ese punto.
 *
 * CÓMO SE TESTEA LA ESCENA: como en el resto del repo (chatPanel.test.ts lo
 * documenta, menuButton.test.ts lo aplica) los objetos Phaser NO son
 * instanciables con layout en happy-dom. Acá se usa la clase MenuScene REAL
 * (sus closures `openOnlineOverlay`/`goLobby`/`goChat`/
 * `closeOnlineOverlay` son el comportamiento bajo test) con plomería
 * estructural fake: `add`, `scale`, `tweens`, `scene.start`/`scene.launch`
 * espiados y el repositorio de perfil pre-inyectado en el registry (los
 * botones del overlay son MenuButton reales sobre contenedores fake y se
 * activan emitiendo `pointerdown`).
 */

/* ------------------------------------------------------------------ */
/* Fakes estructurales de los GameObjects que usa el overlay           */
/* ------------------------------------------------------------------ */

type Handler = (...args: unknown[]) => void;

/** Texto fake: guarda estado (`.text`, `visible`, `alpha`) para asertar. */
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

/** Rectángulo fake (dim del overlay): chainable + handlers de pointerdown. */
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

/** Contenedor fake (overlay y botones MenuButton): lista de hijos + eventos. */
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
      // Igual que el mock de menuButton.test.ts: guarda el hit area.
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

/** Wrapper del nodo DOM (Phaser.GameObjects.DOMElement fake). */
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

/* ------------------------------------------------------------------ */
/* Harness: MenuScene REAL + plomería fake                             */
/* ------------------------------------------------------------------ */

/** Acceso a los miembros privados del overlay que los tests asertan. */
interface OverlayInternals {
  openOnlineOverlay(): void;
  onlineOverlay: FakeContainer | null;
  onlineNameInput: FakeDomElement | null;
  onlineNameWarning: FakeText | null;
}

interface MenuHarness {
  openOverlay(): void;
  /** Dispara el `pointerdown` del botón del overlay con esa etiqueta. */
  press(label: string): void;
  /** Nodo `<input>` del nombre (el primero creado por el overlay). */
  nameInput(): HTMLInputElement;
  /** Wrapper DOM del input (para asertar el destroy al cerrar el overlay). */
  domInput(): FakeDomElement;
  findText(content: string): FakeText | undefined;
  sceneStart: ReturnType<typeof vi.fn>;
  sceneLaunch: ReturnType<typeof vi.fn>;
  savedProfiles: PlayerProfile[];
  overlayContainer(): FakeContainer;
  tweensAdded: Record<string, unknown>[];
}

/**
 * Instancia la MenuScene real y le inyecta SOLO la plomería que toca el flujo
 * del overlay (add/scale/tweens/scene/registry). `create()` no corre: el
 * fondo, texturas y botones del menú base quedan fuera del test.
 */
function createMenuHarness(options: { storedName?: string } = {}): MenuHarness {
  const texts: FakeText[] = [];
  const containers: FakeContainer[] = [];
  const domWrappers: ReturnType<typeof makeFakeDomElement>[] = [];
  const savedProfiles: PlayerProfile[] = [];
  const tweensAdded: Record<string, unknown>[] = [];
  const sceneStart = vi.fn();
  const sceneLaunch = vi.fn();

  const add = {
    container: (x: number, y: number): FakeContainer => makeFakeContainer(containers, x, y),
    rectangle: (): FakeRectangle => makeFakeRectangle(),
    text: (x: number, y: number, content: string): FakeText => makeFakeText(texts, x, y, content),
    dom: (_x: number, _y: number, tag: string): FakeDomElement => {
      const wrapper = makeFakeDomElement(tag);
      domWrappers.push(wrapper);
      return wrapper;
    },
  };

  const registryData = new Map<string, unknown>();
  registryData.set(PLAYER_PROFILE_REGISTRY_KEY, {
    // El nombre precargado que mostraría el input al abrir el overlay.
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
      // openChatOverlay pregunta si ChatScene ya está registrada; null la
      // obliga a pasar por scene.add (que el flujo real de Phaser resuelve).
      get: vi.fn(() => null),
      add: vi.fn(),
    },
    tweens: {
      killTweensOf: vi.fn(),
      add: (config: Record<string, unknown>): Record<string, unknown> => {
        tweensAdded.push(config);
        return config;
      },
    },
  });

  const internals = scene as unknown as OverlayInternals;

  return {
    openOverlay: () => internals.openOnlineOverlay(),
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
        throw new Error(`botón "${label}" no encontrado en el overlay`);
      }
      button.emit('pointerdown');
    },
    nameInput: () => {
      expect(domWrappers.length, 'el overlay aún no creó el input de nombre').toBeGreaterThan(0);
      return domWrappers[0].node;
    },
    domInput: () => {
      expect(domWrappers.length, 'el overlay aún no creó el input de nombre').toBeGreaterThan(0);
      return domWrappers[0];
    },
    findText: (content) => texts.find((candidate) => candidate.text === content),
    sceneStart,
    sceneLaunch,
    savedProfiles,
    overlayContainer: () => {
      // El overlay es el primer contenedor creado (depth 100).
      expect(containers.length).toBeGreaterThan(0);
      return containers[0];
    },
    tweensAdded,
  };
}

/** Abre el overlay y devuelve el texto del aviso (debe existir y estar oculto). */
function openOverlayAndGetWarning(harness: MenuHarness): FakeText {
  harness.openOverlay();
  const warning = harness.findText('INGRESÁ TU NOMBRE');
  if (!warning) {
    throw new Error('el overlay debe crear el texto del aviso "INGRESÁ TU NOMBRE"');
  }
  expect(warning.visible).toBe(false);
  return warning;
}

/* ------------------------------------------------------------------ */
/* #22 — la entrada EN LÍNEA abre la subpantalla compartida            */
/* ------------------------------------------------------------------ */

describe('MenuScene → subpantalla EN LÍNEA (issue #22)', () => {
  it('la subpantalla se abre con título EN LÍNEA, identidad precargada y las 4 acciones', () => {
    const harness = createMenuHarness({ storedName: 'Ana' });

    harness.openOverlay();

    expect(harness.findText('EN LÍNEA')).toBeDefined();
    expect(harness.findText('TU NOMBRE')).toBeDefined();
    // La identidad precargada del perfil llega al input (una sola vez).
    expect(harness.nameInput().value).toBe('Ana');
    // CREAR SALA / UNIRSE (lobby), CHAT (chat) y CERRAR: los 4 botones están
    // (sus labels son textos de la escena).
    for (const label of ['CREAR SALA', 'UNIRSE', 'CHAT', 'CERRAR']) {
      expect(harness.findText(label), `falta el botón ${label}`).toBeDefined();
    }
    // CERRAR cierra la subpantalla sin navegar ni lanzar nada.
    harness.press('CERRAR');
    expect(harness.sceneStart).not.toHaveBeenCalled();
    expect(harness.sceneLaunch).not.toHaveBeenCalled();
    expect(harness.overlayContainer().destroyed).toBe(true);
  });

  it('abrir dos veces no duplica la subpantalla', () => {
    const harness = createMenuHarness();
    harness.openOverlay();
    const first = harness.overlayContainer();

    harness.openOverlay();

    expect(first.destroyed).toBe(false);
    expect(harness.findText('EN LÍNEA')).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* goLobby sin nombre (issue #21: feedback en vez de `return` mudo)    */
/* ------------------------------------------------------------------ */

describe('MenuScene → EN LÍNEA: CREAR SALA sin nombre', () => {
  it('input vacío: NO arranca LobbyScene y SÍ muestra "INGRESÁ TU NOMBRE"', () => {
    const harness = createMenuHarness();
    const warning = openOverlayAndGetWarning(harness);

    harness.press('CREAR SALA');

    expect(harness.sceneStart).not.toHaveBeenCalled();
    expect(warning.visible).toBe(true);
    expect(warning.alpha).toBe(1);
    // El fade de 2.2s queda agendado sobre el propio aviso.
    expect(harness.tweensAdded.length).toBe(1);
    expect(harness.tweensAdded[0].targets).toBe(warning);
    expect(harness.tweensAdded[0].delay).toBe(2200);
  });

  it('nombre de solo espacios también cuenta como sin nombre (sanitize)', () => {
    const harness = createMenuHarness();
    const warning = openOverlayAndGetWarning(harness);
    harness.nameInput().value = '   ';

    harness.press('CREAR SALA');

    expect(harness.sceneStart).not.toHaveBeenCalled();
    expect(warning.visible).toBe(true);
  });

  it('escribir en el input apaga el aviso al instante (sin esperar el fade)', () => {
    const harness = createMenuHarness();
    const warning = openOverlayAndGetWarning(harness);
    harness.press('CREAR SALA');
    expect(warning.visible).toBe(true);

    harness.nameInput().value = 'A';
    harness.nameInput().dispatchEvent(new Event('input'));

    expect(warning.visible).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* goLobby con nombre (el flujo feliz que el issue no debía romper)    */
/* ------------------------------------------------------------------ */

describe('MenuScene → EN LÍNEA: con nombre arranca LobbyScene', () => {
  it('CREAR SALA: scene.start(Lobby, { mode: "create", name }) con el nombre sanitizado', () => {
    const harness = createMenuHarness();
    harness.openOverlay();
    harness.nameInput().value = '  Ana  ';
    harness.nameInput().dispatchEvent(new Event('input'));

    harness.press('CREAR SALA');

    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(LobbyScene.KEY, { mode: 'create', name: 'Ana' });
    // El nombre elegido queda persistido en el perfil (la próxima vez se precarga).
    expect(harness.savedProfiles).toEqual([{ name: 'Ana' }]);
    // El overlay se cierra ANTES del cambio de escena: input y overlay destruidos.
    expect(harness.domInput().destroyed).toBe(true);
    expect(harness.overlayContainer().destroyed).toBe(true);
  });

  it('UNIRSE: scene.start(Lobby, { mode: "join", name })', () => {
    const harness = createMenuHarness();
    harness.openOverlay();
    harness.nameInput().value = 'Beto';

    harness.press('UNIRSE');

    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(LobbyScene.KEY, { mode: 'join', name: 'Beto' });
  });
});

/* ------------------------------------------------------------------ */
/* #22 — CHAT con identidad compartida (el nombre de la sala ES el     */
/* del chat: se guarda en el perfil antes de lanzar ChatScene)         */
/* ------------------------------------------------------------------ */

describe('MenuScene → EN LÍNEA: botón CHAT', () => {
  it('sin nombre: muestra "INGRESÁ TU NOMBRE" y NO lanza ChatScene', () => {
    const harness = createMenuHarness();
    const warning = openOverlayAndGetWarning(harness);

    harness.press('CHAT');

    expect(warning.visible).toBe(true);
    expect(warning.alpha).toBe(1);
    expect(harness.tweensAdded.length).toBe(1);
    expect(harness.tweensAdded[0].targets).toBe(warning);
    expect(harness.tweensAdded[0].delay).toBe(2200);
    // Ni chat ni lobby: el nombre es requisito de TODO lo online.
    expect(harness.sceneLaunch).not.toHaveBeenCalled();
    expect(harness.sceneStart).not.toHaveBeenCalled();
    expect(harness.savedProfiles).toEqual([]);
  });

  it('nombre de solo espacios también cuenta como sin nombre (sanitize)', () => {
    const harness = createMenuHarness();
    const warning = openOverlayAndGetWarning(harness);
    harness.nameInput().value = '   ';

    harness.press('CHAT');

    expect(warning.visible).toBe(true);
    expect(harness.sceneLaunch).not.toHaveBeenCalled();
  });

  it('con nombre: guarda el perfil y lanza ChatScene en tab PÚBLICO', () => {
    const harness = createMenuHarness();
    harness.openOverlay();
    harness.nameInput().value = '  Ana  ';
    harness.nameInput().dispatchEvent(new Event('input'));

    harness.press('CHAT');

    // Identidad compartida: el MISMO nombre que usaría la sala queda
    // persistido (la tab PÚBLICO de ChatScene anuncia el nombre del perfil).
    expect(harness.savedProfiles).toEqual([{ name: 'Ana' }]);
    expect(harness.sceneLaunch).toHaveBeenCalledTimes(1);
    expect(harness.sceneLaunch).toHaveBeenCalledWith(ChatScene.KEY, { tab: 'public' });
    // El lobby NO arranca: CHAT no es una salida al multijugador.
    expect(harness.sceneStart).not.toHaveBeenCalled();
    // La subpantalla se cierra ANTES del launch: input y contenedor muertos.
    expect(harness.domInput().destroyed).toBe(true);
    expect(harness.overlayContainer().destroyed).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Letterbox (el corazón del issue): contenedor DOM ↔ rect del canvas  */
/* ------------------------------------------------------------------ */

/** Resolución base del juego (gameConfig). */
const GAME_WIDTH = 720;
const GAME_HEIGHT = 1280;

/** Rect REAL del canvas medido en un viewport 390×844 con letterbox (#21). */
const CANVAS_RECT = { left: 0, top: 113, width: 390, height: 693 };

/** Contenedor DOM real (happy-dom) + canvas fake con el rect letterboxed. */
function letterboxedGame(): { game: DomSyncGame; container: HTMLDivElement } {
  const container = document.createElement('div');
  const canvas = {
    getBoundingClientRect: () => ({
      left: CANVAS_RECT.left,
      top: CANVAS_RECT.top,
      right: CANVAS_RECT.left + CANVAS_RECT.width,
      bottom: CANVAS_RECT.top + CANVAS_RECT.height,
      x: CANVAS_RECT.left,
      y: CANVAS_RECT.top,
      width: CANVAS_RECT.width,
      height: CANVAS_RECT.height,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
  return { game: { canvas, domContainer: container }, container };
}

/**
 * Aplica a mano el transform `translate(tx, ty) scale(s)` (transform-origin
 * 0 0) que escribe el sync: happy-dom no computa matrices CSS, así que el
 * punto de juego se proyecta con la matemática exacta del transform.
 */
function gamePointToViewport(transform: string, gameX: number, gameY: number): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.eE+-]+)\)/.exec(transform);
  if (!match) {
    throw new Error(`transform inesperado: "${transform}"`);
  }
  const tx = Number.parseFloat(match[1]);
  const ty = Number.parseFloat(match[2]);
  const scale = Number.parseFloat(match[3]);
  return { x: tx + gameX * scale, y: ty + gameY * scale };
}

/** Dónde pinta el CANVAS un punto de juego (mapeo por rect, como Phaser). */
function gamePointToCanvasViewport(gameX: number, gameY: number): { x: number; y: number } {
  return {
    x: CANVAS_RECT.left + (gameX / GAME_WIDTH) * CANVAS_RECT.width,
    y: CANVAS_RECT.top + (gameY / GAME_HEIGHT) * CANVAS_RECT.height,
  };
}

describe('issue #21 — contenedor DOM alineado con el canvas letterboxed', () => {
  it('tras el sync: position fixed, translate(0, 113) scale(390/720) y márgenes 0', () => {
    const { game, container } = letterboxedGame();

    syncDomContainerToCanvas(game, GAME_WIDTH);

    const style = container.style;
    expect(style.position).toBe('fixed');
    expect(style.left).toBe('0px');
    expect(style.top).toBe('0px');
    expect(style.marginLeft).toBe('0px');
    expect(style.marginTop).toBe('0px');
    // 390/720 = 0.541666…, la escala medida en el issue.
    expect(style.transform).toBe(`translate(0px, 113px) scale(${CANVAS_RECT.width / GAME_WIDTH})`);
  });

  it('las esquinas del espacio de juego caen en las esquinas del canvas', () => {
    const { game, container } = letterboxedGame();
    syncDomContainerToCanvas(game, GAME_WIDTH);

    const topLeft = gamePointToViewport(container.style.transform, 0, 0);
    const topRight = gamePointToViewport(container.style.transform, GAME_WIDTH, 0);

    expect(topLeft.x).toBeCloseTo(CANVAS_RECT.left, 5);
    expect(topLeft.y).toBeCloseTo(CANVAS_RECT.top, 5);
    expect(topRight.x).toBeCloseTo(CANVAS_RECT.left + CANVAS_RECT.width, 5);
    expect(topRight.y).toBeCloseTo(CANVAS_RECT.top, 5);
  });

  it('el input de nombre en juego (360, 570) cae EXACTAMENTE donde el canvas lo pinta (±1px)', () => {
    const { game, container } = letterboxedGame();
    syncDomContainerToCanvas(game, GAME_WIDTH);

    // Los DOM elements de Phaser viven en coordenadas de juego DENTRO del
    // contenedor (DOMElementCSSRenderer los pinta con la matriz de la escena):
    // un hijo absoluto en game-px es la traducción fiel del input del menú.
    const input = document.createElement('input');
    input.style.position = 'absolute';
    input.style.left = '360px';
    input.style.top = '570px';
    container.appendChild(input);

    const domPoint = gamePointToViewport(container.style.transform, 360, 570);
    const canvasPoint = gamePointToCanvasViewport(360, 570);

    // La matemática exacta del contenedor (escala única por ancho):
    expect(domPoint.x).toBeCloseTo(195, 5); // 360 × 390/720
    expect(domPoint.y).toBeCloseTo(421.75, 5); // 113 + 570 × 390/720
    // REGRESIÓN del issue: antes el contenedor vivía en (-165, -180) y este
    // punto caía en ≈(30, 129), a >290px del lugar real. Debe coincidir (±1px)
    // con donde el canvas dibuja ese mismo punto de juego.
    expect(Math.abs(domPoint.x - canvasPoint.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(domPoint.y - canvasPoint.y)).toBeLessThanOrEqual(1);
    // Y el punto cae dentro del área visible del canvas (bajo el letterbox).
    expect(domPoint.y).toBeGreaterThanOrEqual(CANVAS_RECT.top);
    expect(domPoint.y).toBeLessThanOrEqual(CANVAS_RECT.top + CANVAS_RECT.height);
  });
});
