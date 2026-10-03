import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocialChatSession } from '../chat/socialChatSession';
import { ROOM_THREAD_ID } from '../chat/ChatStore';

/**
 * QA issue #35 — teoría T1: ciclo de vida del overlay de chat en partida.
 *
 * Dos comportamientos medidos en el issue:
 *
 * 1. CHAT HUÉRFANO SOBRE LOS RESULTADOS: GameScene y RaceScene lanzan
 *    ChatScene con `scene.launch` (chat de espectador, C3) pero sus handlers
 *    de SHUTDOWN nunca la detienen. Si la partida termina con el chat abierto
 *    (concludeMatch/concludeRace/finishRace → `scene.start(GameOverScene)`),
 *    el overlay queda huérfano ENCIMA de los resultados con su velo
 *    interactivo cortando los taps: los botones de GameOverScene son
 *    inalcanzables. LobbyScene sí lo hace (`scene.stop(ChatScene.KEY)` en su
 *    shutdown) — es el patrón de referencia.
 *
 * 2. CARRERA DEBAJO DEL CHAT: MenuScene registra Enter/Espacio → startGame;
 *    el guard solo cubre `onlineOverlay || trackOverlay`. El chat se abre
 *    DESPUÉS de cerrar la subpantalla EN LÍNEA (goChat), así que con el chat
 *    abierto y el input DOM sin foco, Enter/Espacio llegan al teclado del
 *    menú y arrancan una carrera DEBAJO del overlay.
 *
 * CÓMO SE TESTEA: el ciclo de vida de escenas Phaser corre en un juego REAL
 * en modo CANVAS (mismo camino que raceCameraSplit.test.ts: el contrato que
 * se valida es el del SceneManager de Phaser, no un espejo; happy-dom no
 * expone `CanvasRenderingContext2D` y Phaser 4 lo usa como gate de
 * `Features.canvas`, así que el polyfill corre ANTES del import — todo va
 * dinámico). El chat se lanza con la tab PÚBLICO sobre una sesión social
 * fake inyectada en el registry (evita ChatPanel, que usa input DOM no
 * instanciable en happy-dom — ver chatPanel.test.ts). El guard del menú se
 * prueba con la MenuScene REAL y plomería fake (mismo patrón de
 * multiplayerInputFlow.test.ts).
 */

((globalThis as Record<string, unknown>).CanvasRenderingContext2D ??= class {});

// socialChatSession también va dinámico: su cadena llega a ChatPanel (import
// de phaser estático) y hoistearla antes del polyfill rompería
// `Features.canvas` (mismo motivo que el resto de imports dinámicos).
const [
  { default: Phaser },
  { ChatScene },
  { GameOverScene },
  { GameScene },
  { MenuScene },
  { RaceScene },
  { ALL_TEXTURE_KEYS },
  { racePracticeResultsPayload },
  { setSocialChatSession },
] = await Promise.all([
  import('phaser'),
  import('../scenes/ChatScene'),
  import('../scenes/GameOverScene'),
  import('../scenes/GameScene'),
  import('../scenes/MenuScene'),
  import('../scenes/RaceScene'),
  import('../systems/TextureFactory'),
  import('../race/results'),
  import('../chat/socialChatSession'),
]);

/* ------------------------------------------------------------------ */
/* Sesión social fake (ChatScene no debe tocar red en tests)           */
/* ------------------------------------------------------------------ */

/** Sesión social estructural: lo mínimo que ChatScene consume. */
function makeFakeSocialSession(): {
  session: SocialChatSession;
  markedRead: string[];
} {
  const markedRead: string[] = [];
  const session = {
    client: {
      updateSelf: (): void => {},
      onAvailablePeers: (): (() => void) => (): void => {},
      onError: (): (() => void) => (): void => {},
      setAvailable: (): void => {},
      getAvailablePeers: (): never[] => [],
    },
    store: {
      markRead: (threadId: string): void => {
        markedRead.push(threadId);
      },
    },
    getLatestInvite: (): null => null,
    onInviteReceived: (): (() => void) => (): void => {},
  };
  return { session: session as unknown as SocialChatSession, markedRead };
}

/* ------------------------------------------------------------------ */
/* Juego CANVAS real: escena base + ChatScene encima                   */
/* ------------------------------------------------------------------ */

type SceneClass = new () => Phaser.Scene;

/**
 * Escena booteable mínima que hornea texturas EN BLANCO (happy-dom no dibuja
 * y a las escenas solo les importa que la key EXISTA) y recién entonces
 * arranca la escena base bajo test con SU init data.
 */
class TextureStubScene extends Phaser.Scene {
  constructor(
    private readonly baseClass: SceneClass,
    private readonly baseKey: string,
    private readonly baseInit: Record<string, unknown>,
  ) {
    super('qa-t1-textures-stub');
  }

  create(): void {
    for (const key of ALL_TEXTURE_KEYS) {
      if (!this.textures.exists(key)) {
        this.textures.createCanvas(key, 8, 8);
      }
    }
    // GameOverScene registrada sin arrancar: la transición del test es
    // `base.scene.start(GameOver)` (la MISMA llamada de concludeRace/crash),
    // que la necesita registrada para arrancar de verdad.
    this.scene.add(GameOverScene.KEY, GameOverScene, false);
    this.scene.add(this.baseKey, this.baseClass, true, this.baseInit);
  }
}

interface BootedBase {
  game: Phaser.Game;
  /** La escena base (Game/Race) ya en RUNNING. */
  base: Phaser.Scene;
}

/** Arranca un juego CANVAS real y espera a que la escena base termine create(). */
async function bootBaseScene(
  baseClass: SceneClass,
  baseKey: string,
  baseInit: Record<string, unknown>,
): Promise<BootedBase> {
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: 720,
    height: 1280,
    banner: false,
    audio: { noAudio: true },
    // GameScene usa física arcade (gravedad cero, como gameConfig).
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [new TextureStubScene(baseClass, baseKey, baseInit)],
  });
  const base = await waitForSceneRunning(game, baseKey);
  // happy-dom + Phaser 4: el handler de SYSTEM_READY que crea el `stamp`
  // interno del TextureManager corre ANTES de que el manager se suscriba al
  // evento, así que `stamp` nunca existe y `game.destroy()` reventaría dentro
  // del step del loop. Re-emitimos el MISMO evento (ver raceCameraSplit).
  const textures = game.textures as unknown as { stamp?: unknown };
  if (textures.stamp === undefined) {
    game.events.emit(Phaser.Core.Events.SYSTEM_READY, base);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { game, base };
}

/** Espera a que la escena `key` llegue a RUNNING (o revienta por deadline). */
async function waitForSceneRunning(game: Phaser.Game, key: string): Promise<Phaser.Scene> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const scene = game.scene.getScene<Phaser.Scene>(key);
    if (scene && scene.sys.settings.status === Phaser.Scenes.RUNNING) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return scene;
    }
    if (Date.now() > deadline) {
      throw new Error(`la escena "${key}" no llegó a RUNNING (status ${scene?.sys.settings.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Abre el chat ENCIMA de la escena base (el mismo `add` on-demand +
 * `scene.launch` que hacen openSpectatorChat y openChatOverlay) y espera a
 * que el overlay esté en pantalla. Tab PÚBLICO con sesión social fake: sin
 * ChatPanel (input DOM, no instanciable en happy-dom).
 */
async function openChatOver(boot: BootedBase): Promise<string[]> {
  const { session, markedRead } = makeFakeSocialSession();
  setSocialChatSession(boot.base.registry, session);
  boot.base.scene.add(ChatScene.KEY, ChatScene, false);
  boot.base.scene.launch(ChatScene.KEY, { tab: 'public' });
  await waitForSceneRunning(boot.game, ChatScene.KEY);
  expect(boot.game.scene.isActive(ChatScene.KEY)).toBe(true);
  return markedRead;
}

/** Espera a que la escena `key` deje de estar activa (shutdown procesado). */
async function waitForSceneInactive(game: Phaser.Game, key: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (game.scene.isActive(key)) {
    if (Date.now() > deadline) {
      throw new Error(`la escena "${key}" siguió activa tras la transición`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('QA #35 T1 — el chat abierto no sobrevive a la escena base (juego real)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    game?.destroy(true);
    game = null;
  });

  it('RaceScene: la carrera termina con el chat abierto → el overlay NO queda huérfano sobre los resultados', async () => {
    const boot = await bootBaseScene(RaceScene, RaceScene.KEY, { trackId: 'monaco', mode: 'practice' });
    game = boot.game;
    const markedRead = await openChatOver(boot);

    // La transición EXACTA de concludeRace/finishRace: scene.start(GameOver)
    // apaga RaceScene (SHUTDOWN) y arranca los resultados.
    boot.base.scene.start(
      GameOverScene.KEY,
      racePracticeResultsPayload('monaco', 1, 61_234, 184_000),
    );
    await waitForSceneInactive(game, RaceScene.KEY);

    // REGRESIÓN del issue: el chat moría con la carrera (quedaba activo sobre
    // GameOverScene con su velo interactivo bloqueando los botones).
    expect(game.scene.isActive(ChatScene.KEY)).toBe(false);
    // El cierre fue POR el shutdown del overlay (marca el hilo como leído),
    // no por una coincidencia del SceneManager.
    expect(markedRead).toContain(ROOM_THREAD_ID);
  }, 30_000);

  it('GameScene: la partida termina con el chat abierto → el overlay NO queda huérfano sobre los resultados', async () => {
    const boot = await bootBaseScene(GameScene, GameScene.KEY, {});
    game = boot.game;
    const markedRead = await openChatOver(boot);

    // La transición EXACTA del crash en solo: scene.start(GameOver) con el
    // resumen de la carrera (parseGameOverData).
    boot.base.scene.start(GameOverScene.KEY, { score: 1_234, distance: 5_678, coins: 12, isNewBest: false });
    await waitForSceneInactive(game, GameScene.KEY);

    expect(game.scene.isActive(ChatScene.KEY)).toBe(false);
    expect(markedRead).toContain(ROOM_THREAD_ID);
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* MenuScene — startGame con el chat abierto (plomería fake)           */
/* ------------------------------------------------------------------ */

/** Acceso al closure privado `startGame` (es el comportamiento bajo test). */
interface MenuInternals {
  startGame(): void;
}

/**
 * Instancia la MenuScene real y le inyecta SOLO el ScenePlugin fake. Las
 * teclas Enter/Espacio del menú y el botón JUGAR llaman a ESTE closure; los
 * overlays del menú quedan null (nunca se abrieron), igual que en el flujo
 * que abre el chat: goChat CIERRA la subpantalla antes de lanzar ChatScene.
 */
function createMenuHarness(chatOpen: boolean): { startGame(): void; sceneStart: ReturnType<typeof vi.fn> } {
  const sceneStart = vi.fn();
  const scene = new MenuScene();
  Object.assign(scene, {
    scene: {
      start: sceneStart,
      // El guard nuevo pregunta si el overlay de chat sigue activo ENCIMA.
      isActive: (key: string): boolean => chatOpen && key === ChatScene.KEY,
    },
  });
  const internals = scene as unknown as MenuInternals;
  return { startGame: () => internals.startGame(), sceneStart };
}

describe('QA #35 T1 — MenuScene: Enter/Espacio no arrancan una carrera debajo del chat', () => {
  it('con el chat abierto, startGame NO navega (el guard cubre el overlay de chat)', () => {
    const harness = createMenuHarness(true);

    harness.startGame();

    // REGRESIÓN del issue: sin el guard, Enter/Espacio con el input DOM sin
    // foco llegaban al teclado del menú y arrancaban GameScene DEBAJO del
    // chat (una carrera invisible que igual consumía la sesión).
    expect(harness.sceneStart).not.toHaveBeenCalled();
  });

  it('sin el chat, startGame arranca GameScene: el JUGAR de siempre no se rompe', () => {
    const harness = createMenuHarness(false);

    harness.startGame();

    expect(harness.sceneStart).toHaveBeenCalledTimes(1);
    expect(harness.sceneStart).toHaveBeenCalledWith(GameScene.KEY);
  });
});
