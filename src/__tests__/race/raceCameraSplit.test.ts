import { afterEach, describe, expect, it } from 'vitest';

/**
 * Tests de REGRESIÓN de la separación de cámaras mundo/HUD de RaceScene
 * (issue #18, QA del PR #25).
 *
 * El problema: en Phaser 4 el zoom de cámara escala TAMBIÉN los objetos con
 * `scrollFactor(0)` (renderizan en `centro + zoom·(p − centro)`). Con el zoom
 * de #18 (0.8 → 2.2) TODO el HUD de RaceScene quedaba fuera de pantalla y el
 * countdown se veía ×2.2. El fix renderiza el MUNDO sólo en `cameras.main`
 * (zoom `RACE.cameraZoom`) y el HUD sólo en `uiCam` (zoom 1).
 *
 * A diferencia del resto de los tests de race/ (que espejan el cableado con
 * funciones puras, SIN Phaser), acá se arranca un Phaser REAL en modo CANVAS:
 * el contrato que se valida es exactamente el de Phaser (bits de
 * `cameraFilter` por cámara y resolución de input POR cámara), no un espejo.
 * happy-dom no expone `CanvasRenderingContext2D` y Phaser 4 lo usa como gate
 * de `Features.canvas` al crear el renderer, así que el polyfill corre ANTES
 * del import (los imports estáticos se hoistean: todo va dinámico acá).
 */

((globalThis as Record<string, unknown>).CanvasRenderingContext2D ??= class {});

const [{ default: Phaser }, { RaceScene }, { RACE }, { ALL_TEXTURE_KEYS }] = await Promise.all([
  import('phaser'),
  import('../../scenes/RaceScene'),
  import('../../config/balance'),
  import('../../systems/TextureFactory'),
]);

/** Shape interno de RaceScene que este test lee (privados TS, público en runtime). */
interface RaceSceneInternals {
  uiCam: Phaser.Cameras.Scene2D.Camera;
  raceHud: { container: Phaser.GameObjects.Container };
  miniMap: { container: Phaser.GameObjects.Container };
  countdownText: Phaser.GameObjects.Text;
  hudWidgets: { container?: Phaser.GameObjects.Container }[];
  touch: { buttons: { visual: { container: Phaser.GameObjects.Container } }[] };
  carSprite: Phaser.GameObjects.Image;
  worldObjects: Phaser.GameObjects.GameObject[];
  rivals: { car: { renderObjects: Phaser.GameObjects.GameObject[] } }[];
}

/**
 * Escena booteable mínima que hornea texturas EN BLANCO para todas las keys
 * (happy-dom no dibuja nada y a RaceScene sólo le importa que la key EXISTA)
 * y recién entonces arranca la RaceScene con SU init data.
 */
class TextureStubScene extends Phaser.Scene {
  constructor(private readonly raceInit: Record<string, unknown>) {
    super('race-textures-stub');
  }

  create(): void {
    for (const key of ALL_TEXTURE_KEYS) {
      if (!this.textures.exists(key)) {
        this.textures.createCanvas(key, 8, 8);
      }
    }
    this.scene.add(RaceScene.KEY, RaceScene, true, this.raceInit);
  }
}

/** Arranca un juego CANVAS real y espera a que RaceScene termine create(). */
async function bootRaceScene(raceInit: Record<string, unknown>): Promise<{
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
      // happy-dom + Phaser 4: el handler de SYSTEM_READY que crea el `stamp`
      // interno del TextureManager corre ANTES de que el manager se suscriba
      // al evento, así que `stamp` nunca existe y `game.destroy()` reventaría
      // dentro del step del loop. Re-emitimos el MISMO evento: el listener
      // `once` sigue vivo justamente por ese desorden, y con `stamp` creado
      // el destroy es limpio.
      const textures = game.textures as unknown as { stamp?: unknown };
      if (textures.stamp === undefined) {
        game.events.emit(Phaser.Core.Events.SYSTEM_READY, scene);
      }
      // Esperamos unos frames: el registro de input de la escena (los
      // contenedores interactivos del HUD) se vuelca de la cola a la lista
      // en el PRE_UPDATE del frame siguiente al create.
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { game, scene, internals: scene as unknown as RaceSceneInternals };
    }
    if (Date.now() > deadline) {
      throw new Error(`RaceScene no llegó a RUNNING (status ${scene?.sys.settings.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** `true` si la cámara IGNORA el objeto (bit de `cameraFilter` prendido). */
function ignoredBy(
  object: { cameraFilter: number },
  camera: Phaser.Cameras.Scene2D.Camera,
): boolean {
  return (object.cameraFilter & camera.id) !== 0;
}

describe('RaceScene — separación de cámaras mundo/HUD (PR #25)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    game?.destroy(true);
    game = null;
  });

  it('práctica: uiCam (zoom 1) aparte de main (zoom #18); HUD ignorado por main, mundo ignorado por uiCam', async () => {
    const boot = await bootRaceScene({ trackId: 'monaco', mode: 'practice' });
    game = boot.game;
    const { scene, internals } = boot;
    const main = scene.cameras.main;
    const uiCam = internals.uiCam;

    // Dos cámaras distintas: el mundo en main con el zoom del issue #18, el
    // HUD en una cámara de UI a zoom 1 (px de pantalla reales) y transparente.
    expect(uiCam).toBeDefined();
    expect(uiCam).not.toBe(main);
    expect(main.zoom).toBe(RACE.cameraZoom);
    expect(uiCam.zoom).toBe(1);
    expect(uiCam.transparent).toBe(true);

    // El HUD (interactivo o no) es ignorado por main y renderizado por uiCam.
    // Se cubren TODOS los widgets de pantalla fija: HUD de vueltas, minimapa,
    // countdown (se veía ×2.2), botones táctiles ◀ ▶ / FRENO, mute y pausa.
    const hudObjects: { cameraFilter: number }[] = [
      internals.raceHud.container,
      internals.miniMap.container,
      internals.countdownText,
      ...internals.touch.buttons.map((button) => button.visual.container),
      ...internals.hudWidgets.flatMap((widget) => (widget.container ? [widget.container] : [])),
    ];
    expect(hudObjects.length).toBeGreaterThanOrEqual(8);
    for (const hudObject of hudObjects) {
      expect(ignoredBy(hudObject, main)).toBe(true);
      expect(ignoredBy(hudObject, uiCam)).toBe(false);
    }

    // El mundo (pista + auto + confeti) es el camino inverso: uiCam lo ignora,
    // main lo renderiza — el HUD nunca tapa ni duplica el circuito.
    expect(internals.worldObjects.length).toBeGreaterThanOrEqual(3);
    for (const worldObject of internals.worldObjects) {
      expect(ignoredBy(worldObject, uiCam)).toBe(true);
      expect(ignoredBy(worldObject, main)).toBe(false);
    }
  }, 30_000);

  it('práctica: el toque sobre el botón de pausa se resuelve POR uiCam (main lo tiene filtrado)', async () => {
    const boot = await bootRaceScene({ trackId: 'monaco', mode: 'practice' });
    game = boot.game;
    const { scene, internals } = boot;

    // El mismo pipeline real de Phaser que corre con cada gesto: main NO debe
    // capturar el toque (el container tiene SU bit de cameraFilter —
    // `ignore()` a secas sólo marca a los hijos del container) y uiCam sí lo
    // resuelve en coordenadas de pantalla (zoom 1, sin scroll).
    const pauseContainer = internals.hudWidgets
      .map((widget) => widget.container)
      .find((container) => container && container.x === RACE.pauseX && container.y === RACE.pauseY);
    expect(pauseContainer).toBeDefined();

    const pointer = scene.input.manager.activePointer;
    pointer.x = RACE.pauseX;
    pointer.y = RACE.pauseY;
    const over = scene.input.hitTestPointer(pointer);

    expect(over.length).toBe(1);
    expect(over[0]).toBe(pauseContainer);
  }, 30_000);

  it('vs CPU: los rivales son MUNDO (sprite + nombre) — uiCam los ignora, main los renderiza', async () => {
    const boot = await bootRaceScene({
      trackId: 'monaco',
      mode: 'vs-cpu',
      difficulty: 'normal',
      seed: 7,
    });
    game = boot.game;
    const { scene, internals } = boot;
    const main = scene.cameras.main;
    const uiCam = internals.uiCam;

    // 3 propios (pista, auto, confeti) + sprite y nombre por cada rival.
    expect(internals.rivals.length).toBe(7);
    expect(internals.worldObjects.length).toBe(3 + internals.rivals.length * 2);
    for (const worldObject of internals.worldObjects) {
      expect(ignoredBy(worldObject, uiCam)).toBe(true);
      expect(ignoredBy(worldObject, main)).toBe(false);
    }
  }, 30_000);
});
