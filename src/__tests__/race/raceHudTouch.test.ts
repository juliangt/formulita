import { afterEach, describe, expect, it } from 'vitest';

/**
 * Tests de REGRESIÓN del HUD táctil del circuito (issue #19).
 *
 * El issue: con el zoom de cámara sobre RaceScene, el HUD (scrollFactor 0) se
 * dibujaba desplazado respecto de los toques y el botón de pausa caía debajo
 * del minimapa. El fix estructural (PR #25, issue #18) fue la cámara de UI
 * `uiCam` (zoom 1): el HUD se dibuja en px de pantalla 1:1, y los hit-tests
 * de `TouchButton`/`SteerJoystick` comparan px de pantalla crudos → dibujo ==
 * hit. La separación de cámaras YA está cubierta por
 * `raceCameraSplit.test.ts` (acá NO se repite); lo nuevo de #19 es la
 * GEOMETRÍA y el FLUJO:
 *
 * 1. Hit-test de GAS/FRENO y de la ZONA DEL JOYSTICK (issue #37) en px de
 *    pantalla con el pipeline REAL de Phaser: un toque en el centro del rect
 *    dibujado activa ESE control y uno a 10 px fuera no activa nada (el
 *    hitPadding de dedos imprecisos es 8 < 10). El joystick además responde
 *    a `pointermove` real con el eje analógico.
 * 2. Geometría pausa-vs-minimapa: el rect clicable real del botón II (leído
 *    del hitArea que Phaser registró) NO intersecta el panel real del
 *    minimapa — "quedó debajo del minimapa" no puede volver.
 * 3. Flujo de pausa completo por toque: II → PauseScene lanzada y RaceScene
 *    congelada; REANUDAR → carrera activa con el input táctil re-armado;
 *    MENÚ → carrera apagada y MenuScene en pantalla.
 *
 * Igual que en raceCameraSplit: se arranca un Phaser REAL en modo CANVAS
 * (happy-dom no expone `CanvasRenderingContext2D`; el polyfill corre ANTES
 * del import, y los imports van dinámicos por el hoisting).
 */

((globalThis as Record<string, unknown>).CanvasRenderingContext2D ??= class {});

const [
  { default: Phaser },
  { RaceScene },
  { PauseScene },
  { MenuScene },
  { RACE, RACE_HUD, TOUCH_HUD, PAUSE },
  { computeRaceTouchLayout },
  { ALL_TEXTURE_KEYS },
] = await Promise.all([
  import('phaser'),
  import('../../scenes/RaceScene'),
  import('../../scenes/PauseScene'),
  import('../../scenes/MenuScene'),
  import('../../config/balance'),
  import('../../race/raceControls'),
  import('../../systems/TextureFactory'),
]);

/** Shape interno de RaceScene que este test lee (privados TS, público en runtime). */
interface RaceSceneInternals {
  miniMap: { container: Phaser.GameObjects.Container };
  hudWidgets: { container?: Phaser.GameObjects.Container }[];
  touch: {
    /** Botones GAS FRENO (TouchButton: action/rect/isPressed públicos). */
    buttons: {
      action: string;
      rect: { x: number; y: number; width: number; height: number };
      isPressed: boolean;
      visual: { container: Phaser.GameObjects.Container };
    }[];
    /** Zona del joystick deslizable (issue #37): isPressed y eje −1..1. */
    joystick: {
      rect: { x: number; y: number; width: number; height: number };
      isPressed: boolean;
      steerAxis: number;
    };
    /** true mientras los listeners de pointer estén attachados a la escena. */
    attached: boolean;
  };
}

/**
 * Escena booteable mínima: hornea texturas EN BLANCO (a RaceScene sólo le
 * importa que la key EXISTA) y registra TAMBIÉN PauseScene y MenuScene — el
 * flujo de pausa de #19 las lanza/enciende de verdad.
 */
class TextureStubScene extends Phaser.Scene {
  constructor(private readonly raceInit: Record<string, unknown>) {
    super('race-touch-textures-stub');
  }

  create(): void {
    for (const key of ALL_TEXTURE_KEYS) {
      if (!this.textures.exists(key)) {
        this.textures.createCanvas(key, 8, 8);
      }
    }
    this.scene.add(RaceScene.KEY, RaceScene, true, this.raceInit);
    this.scene.add(PauseScene.KEY, PauseScene, false);
    this.scene.add(MenuScene.KEY, MenuScene, false);
  }
}

/** Arranca un juego CANVAS real y espera a que RaceScene termine create(). */
async function bootRaceScene(raceInit: Record<string, unknown> = { trackId: 'monaco', mode: 'practice' }): Promise<{
  game: Phaser.Game;
  scene: Phaser.Scene;
  internals: RaceSceneInternals;
}> {
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: 720,
    height: 1280,
    banner: false,
    audio: { noAudio: true },
    scene: [new TextureStubScene(raceInit)],
  });
  const deadline = Date.now() + 10_000;
  for (;;) {
    const scene = game.scene.getScene<Phaser.Scene>(RaceScene.KEY);
    if (scene && scene.sys.settings.status === Phaser.Scenes.RUNNING) {
      // Mismo atajo que raceCameraSplit.test.ts: sin el re-emit de SYSTEM_READY
      // el TextureManager queda sin `stamp` y game.destroy() revienta.
      const textures = game.textures as unknown as { stamp?: unknown };
      if (textures.stamp === undefined) {
        game.events.emit(Phaser.Core.Events.SYSTEM_READY, scene);
      }
      // Esperamos unos frames: la lista de interactivos del InputPlugin se
      // vuelca de la cola al PRE_UPDATE del frame siguiente al create.
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { game, scene, internals: scene as unknown as RaceSceneInternals };
    }
    if (Date.now() > deadline) {
      throw new Error(`RaceScene no llegó a RUNNING (status ${scene?.sys.settings.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Simula un toque REAL de Phaser sobre la escena: posición del activePointer
 * en px de pantalla + el pipeline completo del InputPlugin (`update` con el
 * CONST.MOUSE_DOWN/UP que el framework usa por frame) — así el tap recorre
 * hitTest por cámara → sort → eventos 'pointerdown' del plugin (los que
 * escucha RaceTouchControls) y 'pointerdown' de los objetos interactivos
 * (los que escucha MenuButton). `downElement`/`upElement` hacen de canvas:
 * sin ellos Phaser despacharía las variantes *_OUTSIDE.
 */
function tap(scene: Phaser.Scene, x: number, y: number, down: boolean): void {
  const pointer = scene.input.manager.activePointer;
  pointer.x = x;
  pointer.y = y;
  (pointer as unknown as { downElement: unknown }).downElement = scene.game.canvas;
  (pointer as unknown as { upElement: unknown }).upElement = scene.game.canvas;
  // `InputPlugin.update` no está en el .d.ts (Phaser la trata de interna) pero
  // es la MISMA que el step del framework llama por frame con el CONST de
  // MOUSE_DOWN/UP y la lista de pointers — por eso el cast angosto.
  const plugin = scene.input as unknown as {
    update: (type: number, pointers: Phaser.Input.Pointer[]) => boolean;
  };
  plugin.update(down ? Phaser.Input.MOUSE_DOWN : Phaser.Input.MOUSE_UP, [pointer]);
}

/**
 * Simula un ARRASTRE REAL de Phaser (el `pointermove` que consume el joystick
 * deslizable, issue #37): reposiciona el activePointer y corre `update` con
 * el CONST.MOUSE_MOVE que el framework usa por frame.
 */
function dragTo(scene: Phaser.Scene, x: number, y: number): void {
  const pointer = scene.input.manager.activePointer;
  pointer.x = x;
  pointer.y = y;
  const plugin = scene.input as unknown as {
    update: (type: number, pointers: Phaser.Input.Pointer[]) => boolean;
  };
  plugin.update(Phaser.Input.MOUSE_MOVE, [pointer]);
}

/** Espera (por frames del juego) hasta que `predicate` se cumpla. */
async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timeout esperando: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Espera frames reales del loop: tras llegar a RUNNING, la lista de
 * interactivos del InputPlugin de la escena recién iniciada se vuelca de la
 * cola al PRE_UPDATE del frame siguiente (sin esto, el primer tap caería en
 * una lista vacía y se perdería).
 */
async function settle(ms = 120): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Intersección no vacía entre dos rects en px de pantalla. */
function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Container del botón de pausa en hudWidgets (único en (pauseX, pauseY)). */
function findPauseContainer(internals: RaceSceneInternals): Phaser.GameObjects.Container {
  const container = internals.hudWidgets
    .map((widget) => widget.container)
    .find((candidate) => candidate && candidate.x === RACE.pauseX && candidate.y === RACE.pauseY);
  expect(container).toBeDefined();
  return container as Phaser.GameObjects.Container;
}

describe('RaceScene — HUD táctil del circuito (issue #19)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    game?.destroy(true);
    game = null;
  });

  it('GAS/FRENO y zona del joystick: dibujo == hit — el centro del rect dibujado activa ESE control y 10 px fuera no activa nada', async () => {
    const boot = await bootRaceScene();
    game = boot.game;
    const { scene, internals } = boot;

    // MISMA fuente de geometría que RaceTouchControls (cero duplicación):
    // el layout puro sobre el lienzo real de la escena (720×1280). Issue #20:
    // el circuito ya no es auto-acelerado — GAS en SU casilla del modo
    // batalla (2 botones: GAS + FRENO). Issue #37: el giro va por la zona
    // deslizable del joystick (no es un botón).
    const { width, height } = scene.scale;
    const layout = computeRaceTouchLayout(width, height);
    expect(internals.touch.buttons.length).toBe(2);

    for (const button of internals.touch.buttons) {
      const rect = layout[button.action as 'throttle' | 'brake'];
      // El hit-test de la lógica y el layout táctil son EL MISMO rect...
      expect(button.rect).toEqual(rect);
      // ...y el dibujo (PixelButton) está centrado EXACTAMENTE en ese rect:
      // panel `hud-panel` de TOUCH_HUD.buttonSize (== rect.width, ver
      // TextureFactory.drawHudPanel) sobre el centro del container.
      expect(rect.width).toBe(TOUCH_HUD.buttonSize);
      expect(button.visual.container.x).toBeCloseTo(rect.x + rect.width / 2);
      expect(button.visual.container.y).toBeCloseTo(rect.y + rect.height / 2);

      // CORAZÓN DEL ISSUE: un toque en el centro del rect dibujado, con el
      // pipeline real de Phaser, presiona ESE botón (y sólo ése).
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      tap(scene, centerX, centerY, true);
      for (const other of internals.touch.buttons) {
        expect(other.isPressed).toBe(other === button);
      }
      tap(scene, centerX, centerY, false);
      expect(button.isPressed).toBe(false);

      // Un toque ~10px fuera del borde NO presiona nada: el hitPadding de
      // dedos imprecisos es 8 px, así que 10 px ya cae afuera de verdad.
      tap(scene, rect.x - 10, centerY, true);
      for (const other of internals.touch.buttons) {
        expect(other.isPressed).toBe(false);
      }
      tap(scene, rect.x - 10, centerY, false);
    }

    // Joystick deslizable (issue #37), MISMO hit-test con el pipeline real:
    // el rect del touch y del layout son el mismo...
    expect(internals.touch.joystick.rect).toEqual(layout.joystick);
    const zone = layout.joystick;
    const zoneCenterX = zone.x + zone.width / 2;
    const zoneCenterY = zone.y + zone.height / 2;
    // ...apoyar el dedo en el centro: zona presionada, eje en 0 (zona muerta)
    // y NINGÚN botón afectado (joystick y botones son controles separados).
    tap(scene, zoneCenterX, zoneCenterY, true);
    expect(internals.touch.joystick.isPressed).toBe(true);
    expect(internals.touch.joystick.steerAxis).toBe(0);
    for (const other of internals.touch.buttons) {
      expect(other.isPressed).toBe(false);
    }
    // Deslizar el dedo hacia el tope derecho: eje completo a la derecha.
    dragTo(scene, zone.x + zone.width, zoneCenterY);
    expect(internals.touch.joystick.steerAxis).toBe(1);
    // Soltar: neutro otra vez.
    tap(scene, zone.x + zone.width, zoneCenterY, false);
    expect(internals.touch.joystick.isPressed).toBe(false);
    expect(internals.touch.joystick.steerAxis).toBe(0);

    // Y un toque 10 px por debajo de la zona tampoco activa nada (joystick
    // incluido).
    tap(scene, zoneCenterX, zone.y + zone.height + 10, true);
    expect(internals.touch.joystick.isPressed).toBe(false);
    for (const other of internals.touch.buttons) {
      expect(other.isPressed).toBe(false);
    }
    tap(scene, zoneCenterX, zone.y + zone.height + 10, false);
  }, 30_000);

  it('geometría pausa-vs-minimapa: el rect clicable del botón II no pisa el panel del minimapa', async () => {
    const boot = await bootRaceScene();
    game = boot.game;
    const { scene, internals } = boot;

    // Rect HIT real del botón II: MenuButton registró un Rectangle de
    // (buttonSize + borde×2) centrado en el container; con uiCam a zoom 1 y
    // escala 1, px locales == px de pantalla. Números con el balance actual:
    // centro (610, 268), hit 80×80 → y ∈ [228, 308].
    const pauseContainer = findPauseContainer(internals);
    const hitArea = pauseContainer.input?.hitArea as Phaser.Geom.Rectangle;
    expect(hitArea).toBeDefined();
    const pauseRect: ScreenRect = {
      x: RACE.pauseX - hitArea.width / 2,
      y: RACE.pauseY - hitArea.height / 2,
      width: hitArea.width,
      height: hitArea.height,
    };
    expect(pauseContainer.scaleX).toBe(1);
    expect(scene.cameras.main.zoom).toBe(RACE.cameraZoom);

    // Panel real del minimapa: container en la esquina superior derecha +
    // rectángulo de RACE.miniMapSize de lado (hijo 0 del widget). Con el
    // balance actual: [520..700] × [20..200].
    const panel = internals.miniMap.container.list[0] as Phaser.GameObjects.Rectangle;
    const panelRect: ScreenRect = {
      x: internals.miniMap.container.x - panel.width / 2,
      y: internals.miniMap.container.y - panel.height / 2,
      width: panel.width,
      height: panel.height,
    };
    expect(panel.width).toBe(RACE.miniMapSize);

    // El corazón del issue ("el botón de pausa quedó debajo del minimapa"):
    // rects DISJUNTOS, con el botón SIEMPRE debajo del panel y dentro de la
    // pantalla — visible y tocable fuera del área del minimapa.
    expect(rectsOverlap(pauseRect, panelRect)).toBe(false);
    expect(pauseRect.y).toBeGreaterThanOrEqual(panelRect.y + panelRect.height);
    expect(pauseRect.x).toBeGreaterThanOrEqual(0);
    expect(pauseRect.x + pauseRect.width).toBeLessThanOrEqual(scene.scale.width);
    expect(pauseRect.y + pauseRect.height).toBeLessThanOrEqual(scene.scale.height);
  }, 30_000);

  it('flujo pausa: el toque en II congela RaceScene y lanza PauseScene; REANUDAR reanuda con el táctil re-armado', async () => {
    const boot = await bootRaceScene();
    game = boot.game;
    const { scene, internals } = boot;
    expect(internals.touch.attached).toBe(true);

    // Toque REAL (pipeline de Phaser) en el centro del botón II: el hit-test
    // por cámaras lo resuelve en uiCam (zoom 1) → MenuButton dispara pauseGame.
    tap(scene, RACE.pauseX, RACE.pauseY, true);
    // El detach del input es síncrono (nada queda "pegado" congelado)...
    expect(internals.touch.attached).toBe(false);
    // ...y launch(PauseScene) + pause(Race) se aplican en el step del manager.
    await waitFor(
      () =>
        scene.scene.get<Phaser.Scene>(PauseScene.KEY)?.sys.settings.status ===
        Phaser.Scenes.RUNNING,
      'PauseScene RUNNING tras el toque en II',
    );
    expect(scene.sys.settings.status).toBe(Phaser.Scenes.PAUSED);

    // REANUDAR: mismo camino que el pulgar — toque en el botón del overlay
    // (tras el settle: la lista de interactivos del overlay recién iniciado
    // necesita un frame de PRE_UPDATE para volcarse).
    const pauseScene = scene.scene.get<Phaser.Scene>(PauseScene.KEY) as Phaser.Scene;
    await settle();
    tap(pauseScene, scene.scale.width / 2, PAUSE.resumeY, true);
    await waitFor(
      () => scene.sys.settings.status === Phaser.Scenes.RUNNING,
      'RaceScene RUNNING tras REANUDAR',
    );
    expect(scene.scene.isActive(PauseScene.KEY)).toBe(false);
    // El RESUME re-armó el input táctil: la carrera vuelve a ser conducible.
    expect(internals.touch.attached).toBe(true);

    // Prueba de vida del hit-test tras reanudar: FRENO responde otra vez.
    const brake = computeRaceTouchLayout(scene.scale.width, scene.scale.height).brake;
    tap(scene, brake.x + brake.width / 2, brake.y + brake.height / 2, true);
    const brakeButton = internals.touch.buttons.find((button) => button.action === 'brake');
    expect(brakeButton?.isPressed).toBe(true);
    tap(scene, brake.x + brake.width / 2, brake.y + brake.height / 2, false);
  }, 30_000);

  it('flujo pausa: MENÚ del overlay abandona la carrera y vuelve al menú', async () => {
    const boot = await bootRaceScene();
    game = boot.game;
    const { scene } = boot;

    tap(scene, RACE.pauseX, RACE.pauseY, true);
    await waitFor(
      () =>
        scene.scene.get<Phaser.Scene>(PauseScene.KEY)?.sys.settings.status ===
        Phaser.Scenes.RUNNING,
      'PauseScene RUNNING tras el toque en II',
    );

    const pauseScene = scene.scene.get<Phaser.Scene>(PauseScene.KEY) as Phaser.Scene;
    await settle();
    tap(pauseScene, scene.scale.width / 2, PAUSE.menuY, true);
    await waitFor(
      () =>
        game?.scene.getScene<Phaser.Scene>(MenuScene.KEY)?.sys.settings.status ===
        Phaser.Scenes.RUNNING,
      'MenuScene RUNNING tras MENÚ',
    );
    // La carrera quedó apagada (shutdown = limpieza) y el overlay también.
    expect(game?.scene.isActive(RaceScene.KEY)).toBe(false);
    expect(game?.scene.isActive(PauseScene.KEY)).toBe(false);
  }, 30_000);

  it('el tamaño del botón de pausa es el documentado (RACE_HUD.pauseButtonSize + borde del MenuButton)', () => {
    // Documentación ejecutable del cálculo que usa el test de geometría: el
    // hit del MenuButton es (lado + 2·borde) con borde 4 (BORDER_PX privado
    // de ui/MenuButton). Si alguien agranda el botón o lo reubica, los
    // números del comentario del test de pausa-vs-minimapa quedan viejos y
    // este assert avisa.
    expect(RACE_HUD.pauseButtonSize).toBe(72);
    // Panel del minimapa (top 20 + 180 de lado → bottom 200) y top del hit
    // del botón II (268 − 40 = 228): 28 px de aire, solape imposible.
    expect(RACE.pauseY - (RACE_HUD.pauseButtonSize / 2 + 4)).toBeGreaterThanOrEqual(
      RACE.miniMapMargin + RACE.miniMapSize,
    );
  });
});
