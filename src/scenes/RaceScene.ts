import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import {
  CIRCUIT,
  COUNTDOWN,
  GAMEOVER_TRANSITION_MS,
  GHOST_INTERPOLATION_MS,
  MUTE_BUTTON,
  MULTIPLAYER,
  RACE,
  RACE_CONFETTI,
  RACE_FINISH_GRACE_MS,
  RACE_HUD,
  RACE_LAP_BANNER,
  RACE_MULTI,
  RACE_VS_CPU,
  SPECTATOR_OVERLAY,
  STATE_HZ,
  TOUCH_HUD,
} from '../config/balance';
import { isRaceSpectatorChatVisible } from '../chat/spectatorChat';
import { getSessionChatStore } from '../chat/chatSession';
import { receiveRoomChat } from '../chat/roomChat';
import { ROOM_THREAD_ID } from '../chat/ChatStore';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import {
  circuitInputFromState,
  computeRaceTouchLayout,
  RaceKeyboardSource,
  RACE_TOUCH_ACTIONS,
  type RaceTouchAction,
} from '../race/raceControls';
import { assignGridOrder, type GridSlot } from '../race/gridOrder';
import { CircuitPhysics, type CarState } from '../race/circuitPhysics';
import { LapTracker, type LapCompletedEvent } from '../race/lapTracker';
import {
  finalClassification,
  rankCars,
  type FinalCar,
  type FinalStanding as RaceFinalStanding,
  type RankedCar,
} from '../race/raceRanking';
import {
  fastestRaceLap,
  parseRaceSceneInit,
  raceMultiResultsPayload,
  racePracticeResultsPayload,
  raceVsCpuPodium,
  raceVsCpuResultsPayload,
  CPU_DIFFICULTY_LABELS,
  DEFAULT_CPU_DIFFICULTY,
  VS_CPU_FALLBACK_PILOT_NAME,
  type CpuDifficulty,
  type RaceSceneInit,
  type RaceVsCpuResultsData,
} from '../race/results';
import { raceEngineSpeed } from '../race/raceAudio';
import { computeRaceGaps } from '../race/raceGap';
import { PositionSwapDetector } from '../race/racePositionSwap';
import {
  sampleFromProgress,
  unrollProgress,
  type RaceRemoteSample,
} from '../race/raceRemote';
import { RacePlausibility } from '../race/racePlausibility';
import { scheduleRaceStateBroadcast } from '../race/raceBroadcast';
import { RaceStaleTracker } from '../race/raceStale';
import {
  parseRaceFinishPayload,
  parseRaceOverPayload,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type PlayerInfo,
} from '../net/protocol';
import { takeSessionNetClient } from '../net/netClientSession';
import type { NetClient } from '../net/NetClient';
import { SnapshotBuffer } from '../net/interpolation';
import { buildTrackPath, getTrackById, TRACKS, type TrackDefinition } from '../race/tracks';
import type { TrackPath, TrackProjection } from '../race/trackPath';
import { CountdownSystem, type CountdownLabel } from '../systems/CountdownSystem';
import { PauseSystem } from '../systems/PauseSystem';
import { TouchButton } from '../systems/TouchButton';
import type { PointerEventEmitter } from '../systems/TouchSource';
import { InputSystem, type IInputSource, type IInputState } from '../systems/InputSystem';
import { RemoteCar } from '../entities/RemoteCar';
import { AiDriver, type AiCarVision } from '../race/ai/aiDriver';
import { buildRacingLine, type RacingLine } from '../race/ai/racingLine';
import { buildRivalRoster, rivalDriverConfig, type Rival } from '../race/ai/rivalRoster';
import { mulberry32 } from '../net/roomRng';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { formatLapBadge } from '../ui/format';
import { trackEvent } from '../telemetry/analytics';
import { MiniMap } from '../ui/MiniMap';
import { MenuButton } from '../ui/MenuButton';
import { MuteButton } from '../ui/MuteButton';
import { PixelButton, type PixelButtonStyle } from '../ui/PixelButton';
import { RaceHud } from '../ui/RaceHud';
import { ChatScene } from './ChatScene';
import { GameOverScene } from './GameOverScene';
import { PauseScene } from './PauseScene';

/* ------------------------------------------------------------------ */
/* Constantes visuales del circuito (presentación, no gameplay)         */
/* Issue #18: los px de MUNDO escalan ×2.5 con el circuito (quedan con   */
/* la misma proporción sobre la pista y el mismo tamaño en pantalla con  */
/* el nuevo zoom). Los px de PANTALLA (HUD, carteles) se conservan 1:1   */
/* GRACIAS a la cámara de UI dedicada (`uiCam`): en Phaser 4 el zoom de  */
/* cámara escala TAMBIÉN los objetos con scrollFactor(0), así que sin    */
/* esa cámara el HUD quedaba fuera de pantalla con el zoom de #18.       */
/* ------------------------------------------------------------------ */

/** Prefijo de la textura pre-horneada por pista (`race-track-<id>`). */
const TRACK_TEXTURE_PREFIX = 'race-track-';

/**
 * Offset de rotación del sprite: la textura del auto apunta hacia ARRIBA
 * (−Y) mientras el heading de la física es atan2-style (0 = +X).
 */
const CAR_SPRITE_ANGLE_OFFSET = Math.PI / 2;

/** Ancho de las franjas de corte del pasto (px, alternadas con grassAlt). */
const GRASS_STRIPE_PX = 500;

/** Largo de cada bloque de kerb a lo largo del arco (px). */
const KERB_BLOCK_PX = 160;
/** Cuánto sobresale el kerb más allá del borde del asfalto (px). */
const KERB_EXTRA_WIDTH_PX = 45;
/** Curvatura mínima (1/px) que merece kerbs: radio < ~833 px. Issue #18:
 * el umbral es 1/px de mundo ⇒ se DIVIDE por la escala (0.003 → 0.0012). */
const KERB_CURVATURE_THRESHOLD = 0.0012;

/** Grosor de las líneas blancas del borde del asfalto (px). */
const EDGE_LINE_WIDTH_PX = 10;
/** Color de las líneas del borde (blanco hueso de la paleta kerbAlt-ish). */
const EDGE_LINE_COLOR = 0xe8e6e0;

/** Banda de goma ("groove") sobre el asfalto, como fracción del ancho. */
const GROOVE_WIDTH_RATIO = 0.62;

/** Meta a cuadros: filas × columnas de cuadraditos sobre el ancho. */
const START_LINE_ROWS = 2;
const START_LINE_SQUARES = 8;

/** Marcas de sector: línea fina translúcida cruzando el asfalto. */
const SECTOR_MARK_ALPHA = 0.28;
const SECTOR_MARK_WIDTH_PX = 15;

/** Cartel de fin de carrera (bandera a cuadros). */
const FINISH_LABEL = '¡BANDERA A CUADROS!';
const FINISH_LABEL_FONT_SIZE = 56;
/** Altura del cartel de fin sobre el centro de la pantalla (px). */
const FINISH_LABEL_OFFSET_Y = 160;

/**
 * Seed de la parrilla en práctica: un solo corredor, siempre en la pole.
 * Determinista para que la salida sea idéntica en cada sesión.
 */
const PRACTICE_GRID_SEED = 0;

/**
 * peerId canónico del auto propio en las parrillas locales (práctica y vs
 * CPU): la parrilla canoniza por peerId, así que la etiqueta es parte del
 * contrato determinista.
 */
const PLAYER_PEER_ID = 'player';

/**
 * Color del tinte del punto del jugador en el minimapa (rojo F1 propio).
 * El índice 0 de la paleta de sala; los rivales usan los siguientes (ver
 * `race/ai/rivalRoster`).
 */
const PLAYER_MINIMAP_TINT = 0xd63c3c;

/** Subtítulo del espectador tras terminar la propia carrera (V2 multi). */
const SPECTATOR_SUBTITLE = 'MODO ESPECTADOR — SIGUIENDO AL LÍDER';
const SPECTATOR_SUBTITLE_FONT_SIZE = 30;
/** Altura del subtítulo de espectador bajo el cartel de fin (px). */
const SPECTATOR_SUBTITLE_OFFSET_Y = 70;

/**
 * V3 — botón CHAT del espectador de carrera: centrado bajo el subtítulo del
 * cartel de fin, con el MISMO ritmo que el overlay de espectador de la
 * BATALLA (SPECTATOR_OVERLAY: cartel → subtítulo → botón a +88 px).
 */
const SPECTATOR_CHAT_BUTTON_GAP_PX = 88;
/** Tinte del botón CHAT (idem overlay de espectador de GameScene). */
const SPECTATOR_CHAT_TINT = 0xb04ee0;

/**
 * Período del barrido de staleness (s, patrón sweepStaleTick de GameScene):
 * el umbral REAL es PLAYER_STALE_MS (RaceStaleTracker); esto sólo fija cada
 * cuánto se pregunta — no hace falta por frame.
 */
const STALE_SWEEP_INTERVAL_S = 1;

/** Normaliza un ángulo a (−π, π] (la tangente de TrackPath vive ahí). */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/**
 * Runtime de un rival CPU en la escena (V1 de #14): el roster da la
 * personalidad, la escena le arma física/vueltas/driver/sprite. El driver
 * sólo decide el `CircuitInput`; la física es la MISMA clase que la del
 * jugador y el rival que completa SUS vueltas se congela tras la meta.
 */
interface RivalRuntime {
  rival: Rival;
  state: CarState;
  physics: CircuitPhysics;
  lapTracker: LapTracker;
  driver: AiDriver;
  car: RemoteCar;
  /** Última coordenada de arco (ranking vivo y clasificación). */
  lastS: number;
  /** Último lateral con signo (visión V2 del driver: adelantamiento). */
  lastLateral: number;
  /** true cuando completó SUS 3 vueltas (deja de simularse). */
  finished: boolean;
  /** Tiempos exactos al terminar (para la clasificación final). */
  finish: { totalMs: number; bestLapMs: number } | null;
}

/**
 * Fuente táctil de la carrera (implementa `IInputSource`): reutiliza la
 * lógica de `TouchButton` (tracking multi-touch por pointerId, hit-test
 * manual que no roba eventos al juego) y la presentación `PixelButton`, con
 * el layout propio del circuito (◀ ▶ + GAS + FRENO) de `raceControls`. Es la
 * hermana chica de `TouchSource` (GameScene) sin TURBO/DRS. Issue #20: el
 * circuito ya NO es auto-acelerado — el botón GAS (misma casilla/esquina y
 * estilo verde del modo BATALLA) pisa el acelerador.
 */
class RaceTouchControls implements IInputSource {
  readonly name = 'race-touch';

  private readonly buttons: readonly TouchButton[];
  private readonly emitter: PointerEventEmitter | null;
  private attached = false;

  constructor(scene: Phaser.Scene) {
    const { width, height } = scene.scale;
    const layout = computeRaceTouchLayout(width, height);
    const styles: Record<RaceTouchAction, PixelButtonStyle> = {
      left: { icon: TEXTURE_KEYS.hudArrowLeft, tint: 0x3c6cd6 },
      right: { icon: TEXTURE_KEYS.hudArrowRight, tint: 0x3c6cd6 },
      // MISMO estilo del GAS de la BATALLA (TouchSource): label verde.
      throttle: { label: 'GAS', tint: 0x3c9e52 },
      brake: { label: 'FRENO', tint: 0xd63c3c },
    };

    this.buttons = RACE_TOUCH_ACTIONS.map((action) => {
      const rect = layout[action];
      const visual = new PixelButton(scene, rect, styles[action]);
      // La cámara del mundo scrollea: el HUD táctil vive en pantalla fija.
      visual.container.setScrollFactor(0);
      // Dos cámaras (issue #18): el HUD táctil renderiza SOLO en la cámara de
      // UI — la del mundo lo ignora (mismo truco que `hud()`: `ignore` marca
      // los hijos del container y el bit del PROPIO container es el que mira
      // el hit-test). El toque en sí NO pasa por cámaras: `TouchButton.contains`
      // compara px de pantalla crudos, así que sigue registrando igual.
      scene.cameras.main.ignore(visual.container);
      visual.container.cameraFilter |= scene.cameras.main.id;
      return new TouchButton({
        action,
        rect,
        visual,
        hitPadding: TOUCH_HUD.hitPadding,
      });
    });

    this.emitter = scene.input;
  }

  attach(): void {
    if (this.attached || !this.emitter) {
      return;
    }
    this.attached = true;
    this.emitter.on('pointerdown', this.onPointerDown);
    this.emitter.on('pointerup', this.onPointerUp);
    this.emitter.on('pointerupoutside', this.onPointerUp);
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.emitter?.off('pointerdown', this.onPointerDown);
    this.emitter?.off('pointerup', this.onPointerUp);
    this.emitter?.off('pointerupoutside', this.onPointerUp);
    for (const button of this.buttons) {
      button.forceRelease();
    }
  }

  destroy(): void {
    this.detach();
    for (const button of this.buttons) {
      button.destroy();
    }
  }

  /** Porción de `IInputState` que llena esta fuente (giro + gas + freno). */
  getState(): IInputState {
    const pressed = (action: RaceTouchAction): boolean =>
      this.buttons.find((button) => button.action === action)?.isPressed ?? false;
    return {
      left: pressed('left'),
      right: pressed('right'),
      throttle: pressed('throttle'),
      brake: pressed('brake'),
      turbo: false,
      drs: false,
    };
  }

  private readonly onPointerDown = (pointer: { id: number; x: number; y: number }): void => {
    for (const button of this.buttons) {
      if (button.contains(pointer.x, pointer.y)) {
        button.press(pointer.id);
      }
    }
  };

  private readonly onPointerUp = (pointer: { id: number; x: number; y: number }): void => {
    for (const button of this.buttons) {
      button.release(pointer.id);
    }
  };
}

/**
 * RaceScene — carrera en circuito local, modo ENTRENAR (issue #9, V1).
 *
 * Una persona corre sola una de las 6 pistas, 3 vueltas, con countdown,
 * HUD de vuelta/tiempos, minimapa, pausa y pantalla de resultados. Es la
 * base de V2 (multi): la escena SOLO orquesta render/input — la lógica ya
 * existe en `race/` (TrackPath, CircuitPhysics, LapTracker, gridOrder,
 * raceRanking) y no se duplica acá.
 *
 * Decisiones documentadas:
 * - AUTO: sprite directo con la textura procedural del jugador
 *   (`TEXTURE_KEYS.playerCar`) controlado por `CircuitPhysics`. NO se reusa
 *   `PlayerCar`: esa entidad está soldada al modo scroll vertical (clamps a
 *   los bordes de pista, velocidad lateral con drag, body de arcade physics)
 *   — incrustarla habría sido luchar contra su propio modelo. El sprite
 *   puro + física propia es la opción menos forzada; V2 agrega sprites por
 *   peer sobre el mismo patrón.
 * - PISTA: pre-render a UNA textura por pista (`race-track-<id>`, patrón
 *   TextureFactory: `Graphics` one-shot → `generateTexture`): pasto con
 *   franjas de corte, cinta de asfalto sobre la polilínea densa con banda de
 *   goma, kerbs rojo/blanco en las zonas de curvatura alta, líneas blancas
 *   de borde, meta a cuadros en s=0 y marcas sutiles de sector. Cero
 *   `Graphics` dinámicos por frame.
 * - CÁMARA: dos cámaras (issue #18, QA del PR #25). `cameras.main` (zoom
 *   `RACE.cameraZoom`, norte arriba, sigue al auto con lerp, clampada al
 *   mundo) renderiza SOLO el mundo; el HUD vive SOLO en `uiCam`, una cámara
 *   de UI dedicada con zoom 1: en Phaser 4 el zoom escala también los
 *   objetos con `setScrollFactor(0)` (renderizan en centro + zoom·(p−centro)),
 *   así que con el zoom de #18 todo el HUD quedaba fuera de pantalla. Cada
 *   cámara ignora lo de la otra (`hud()` al crear HUD,
 *   `uiCam.ignore(worldObjects)` al cerrar create) y el input sigue
 *   funcionando porque Phaser resuelve el hit-test por cámara con el mismo
 *   filtro de render.
 * - INPUT: mismo stack que el modo BATALLA (`IInputState` fusionado por
 *   `InputSystem`) con fuentes propias de carrera (teclado W/↑ + ◀ ▶ + FRENO
 *   y táctil ◀ ▶ + GAS + FRENO, issue #20: gas manual); el puente a la
 *   física es el puro `circuitInputFromState`.
 * - PAUSA: igual que GameScene (PauseSystem + PauseScene encima, tecla P,
 *   auto-pausa por blur) — PauseScene ahora recibe la escena objetivo por
 *   init data (default Game: regresión cero en el modo BATALLA).
 * - FIN: al completar `CIRCUIT.totalLaps` vueltas válidas (LapTracker) el
 *   mundo se congela y la escena transiciona a la rama de resultados de
 *   carrera de GameOverScene con `racePracticeResultsPayload`.
 *
 * V2 (issue #9) — MODO MULTI (`mode:'race'`, init data extendido de
 * LobbyScene): misma escena y misma física, con la capa de red de la BATALLA
 * (#1) y acciones NUEVAS aditivas (`rstate`/`rfin`/`race-over`). La parrilla
 * posiciona a TODO el roster (`assignGridOrder` con la seed de la sala); el
 * estado propio viaja a STATE_HZ en coordenadas de pista y los rivales se
 * reconstruyen interpolando el progreso DESENROLLADO con el TrackPath local
 * (`race/raceRemote`) — continuo en la meta. Ranking vivo (`rankCars`) →
 * badge Pn/N en el HUD. El primer `rfin` gana; la carrera cierra cuando
 * terminan todos o vence `RACE_FINISH_GRACE_MS`, y el ganador difunde
 * `race-over` con `finalClassification`. Quien terminó specta siguiendo al
 * líder. En multi NO hay pausa (la red no se pausa, igual que GameScene).
 *
 * V3 (issue #9) — robustez: el progreso ajeno pasa un filtro de
 * plausibilidad contra el tope físico (`race/racePlausibility`; un avance
 * imposible se ignora, un retroceso se acepta — no gana nada), los peers que
 * dejan de mandar `rstate` salen del mundo a `PLAYER_STALE_MS` y clasifican
 * como `disconnected` (`race/raceStale`, patrón MatchTracker de #1), y el
 * chat de espectador de #2 se extiende a "terminó la propia carrera"
 * (`isRaceSpectatorChatVisible`): quien cruzó la bandera lee y escribe en la
 * sala mientras sigue al líder actual del ranking vivo.
 *
 * V4 (issue #9) — pulido: dron del motor por velocidad (arranca con el GO!,
 * el update emite `speed` con el mapeo normalizado de `race/raceAudio` y se
 * apaga en pausa/fin/shutdown por el bus de sesión — la API del AudioManager
 * es la misma de la BATALLA, perfil móvil de #4 incluido), cartel pop
 * "¡VUELTA n/N!" al completar cada vuelta que no sea la final, burst de
 * confeti al cruzar la meta propia y vuelta rápida de la carrera (el mejor
 * `bestLapMs` de los `rfin`, elegida por `fastestRaceLap`) viajando en el
 * payload de resultados para que el podio multi la destaque.
 *
 * V0 (issue #14) — GRAN PREMIO VS CPU (`mode:'vs-cpu'`): la misma carrera de
 * 3 vueltas contra rivales CPU. Mismo paso fijo, misma `CircuitPhysics` para
 * todos los autos (el driver del rival sólo decide su `CircuitInput`),
 * parrilla por `assignGridOrder` con la seed del init data y ranking vivo con
 * `rankCars` → badge Pn/N. El modo corta cuando el JUGADOR completa las
 * vueltas (mismo criterio de congelación de la práctica) y transiciona a la
 * rama vs-cpu de resultados con la posición final del jugador — ver
 * `buildVsCpuResults`.
 *
 * V1 (issue #14) — PILOTOS REALES: SIETE rivales con personalidad
 * (`race/ai/rivalRoster.ts`: nombre, paleta, ±velocidad, trazada y
 * agresividad propias, deterministas por seed de carrera) que siguen la
   * LÍNEA DE CARRERA (`race/ai/racingLine.ts`, precomputada UNA vez por pista
   * y compartida) con frenada por curvatura lookahead. Parrilla de 8,
   * ranking/minimapa/resultados sobre los 8.
   *
   * V2 (issue #14) — TRES DIFICULTADES CON CARÁCTER: los presets de 6
   * parámetros viven en `RACE_AI` (resueltos por `rivalDriverConfig`) y cada
   * driver corre con errores humanos (Poisson), búsqueda de hueco (visión de
   * los demás autos, ver `stepVsCpu`) y goma acotada según el gap al
   * jugador — todo con el RNG propio del rival, determinista por seed.
   *
   * V3 (issue #14) — CARRERA VIVA: durante el GRAN PREMIO se entiende contra
   * quién se pelea — gap en tiempo a los rivales de adelante/atrás (puro en
   * `race/raceGap`, mostrado a 4 Hz con el ranking), chip de contexto
   * "GRAN PREMIO · PISTA · DIFICULTAD", punto PROPIO destacado en el
   * minimapa (opt-in en `MiniMap`), nombres un punto más grandes sobre los
   * rivales y SFX de largada + adelantamiento (detección pura con
   * enfriamiento en `race/racePositionSwap`, sonando por el bus como
   * `race-go`/`race-overtake`). Práctica y multi: cero cambios, salvo el
   * destacado del minimapa en multi (opt-in genérico). La cámara conserva SU
   * mecánica (zoom fijo + lerp; decisión V3): el valor del zoom lo actualizó
   * el issue #18 (ver `RACE.cameraZoom`).
   */
export class RaceScene extends Phaser.Scene {
  static readonly KEY = 'Race';

  /* Init data (parseado defensivo en init()). */
  private sceneInit: RaceSceneInit = parseRaceSceneInit(undefined);

  /* Núcleo puro de la carrera (issue #9, V0). */
  private trackDef!: TrackDefinition;
  private path!: TrackPath;
  private carPhysics!: CircuitPhysics;
  private lapTracker!: LapTracker;
  private carState!: CarState;

  /* Render del mundo + auto. */
  private carSprite!: Phaser.GameObjects.Image;

  /**
   * Cámara de UI (zoom 1, viewport completo, sin scroll ni follow): el HUD
   * se renderiza SOLO acá. En Phaser 4 el zoom de cámara escala TAMBIÉN los
   * objetos con `scrollFactor(0)` (renderizan en `centro + zoom·(p−centro)`):
   * con el zoom de #18 todo el HUD quedaba fuera de pantalla (issue #19 ya
   * describía la desalineación a zoom menor). El mundo vive SOLO en
   * `cameras.main` y el HUD SOLO acá — cada cámara ignora lo de la otra
   * (`hud()` en cada creación de HUD, `uiCam.ignore(worldObjects)` al cerrar
   * create). Pública para los tests de regresión de la separación.
   */
  uiCam!: Phaser.Cameras.Scene2D.Camera;

  /**
   * Objetos del MUNDO (pista, auto propio, confeti, rivales/remotos): create()
   * los recolecta acá para que `uiCam` los ignore de una sola pasada al
   * cerrar. Se completa SIEMPRE dentro de create() (los RemoteCar nacen en
   * setupVsCpu/setupMultiRace; los que caen a mitad de carrera sólo se
   * destruyen) y se reinicia en cada create (el restart reutiliza la escena).
   */
  private worldObjects: Phaser.GameObjects.GameObject[] = [];

  /** Bus de sesión (audio del motor, botones de HUD). Resuelto en create. */
  private bus!: EventBus<GameEvents>;

  /**
   * V4 — confeti del cruce de meta final (one-shot: creado con `emitting:
   * false` y disparado con `explode` una sola vez por carrera, igual que los
   * bursts de GameScene). Objeto de escena: el SHUTDOWN lo destruye.
   */
  private confettiEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  /* Input de carrera (mismo stack fusionado que el modo BATALLA). */
  private inputSystem!: InputSystem;
  private keyboard!: RaceKeyboardSource;
  private touch!: RaceTouchControls;

  /* HUD de pantalla (scrollFactor 0). */
  private hudWidgets: { destroy(): void }[] = [];
  private raceHud!: RaceHud;
  private miniMap!: MiniMap;

  /* Fase countdown 3-2-1-GO! (mismo CountdownSystem puro del modo BATALLA). */
  private countdown!: CountdownSystem;
  private countdownText!: Phaser.GameObjects.Text;

  /* Pausa real (mismo patrón de GameScene, overlay con escena objetivo). */
  private pauseSystem!: PauseSystem;
  private pauseKey: Phaser.Input.Keyboard.Key | null = null;

  /** true al completar la última vuelta: mundo congelado, transición en cola. */
  private finished = false;

  /* ---------------------------------------------------------------- */
  /* V2 — carrera multijugador (mode: 'race', issue #9)                */
  /*                                                                  */
  /* El netcode es el de la BATALLA (#1) con acciones NUEVAS (patrón    */
  /* aditivo del chat): `rstate` a STATE_HZ en coordenadas de pista,    */
  /* `rfin` al terminar y `race-over` del ganador. El estado propio lo  */
  /* genera la física local; el de los rivales se reconstruye del       */
  /* progreso desenrollado interpolado con el TrackPath determinista.   */
  /* ---------------------------------------------------------------- */

  /** Parrilla completa (propia + remotos), determinista por (seed, roster). */
  private gridSlots: GridSlot[] = [];
  /** Transporte heredado del lobby vía registry (null en práctica). */
  private netClient: NetClient | null = null;
  /** Desuscripciones de red (limpian en SHUTDOWN). */
  private netUnsubs: (() => void)[] = [];
  /** Sprites remotos por peer (posición reconstruida del stream). */
  private remotes = new Map<string, RemoteCar>();
  /** Buffer de interpolación del progreso desenrollado por peer. */
  private remoteBuffers = new Map<string, SnapshotBuffer<RaceRemoteSample>>();
  /** Último (lap, s) crudo recibido por peer (ranking vivo). */
  private remoteProgress = new Map<string, { lap: number; s: number }>();
  /** `rfin` recibidos/propios por peer (tiempos exactos de los terminados). */
  private finishedPeers = new Map<string, { totalMs: number; bestLapMs: number }>();
  /** Peers fuera de la carrera sin terminar (leave o stale V3): en la
   *  clasificación final van como `disconnected` con su último progreso. */
  private disconnectedPeers = new Set<string>();
  /** Primer `rfin` visto (ganador + instante local del arranque de gracia). */
  private firstFinish: { peerId: string; at: number } | null = null;
  /** Clasificación recibida por `race-over` (manda sobre la local). */
  private raceOverStandings: RaceFinalStanding[] | null = null;
  /** true tras difundir el propio `race-over` (idempotencia del ganador). */
  private raceOverSent = false;
  /** true cuando la carrera multi concluyó (transición a resultados). */
  private raceConcluded = false;
  /** true al terminar las 3 vueltas propias (paso a espectador). */
  private selfFinished = false;
  /** Acumulador del broadcast `rstate` (ventana de 1/STATE_HZ). */
  private stateAccumulatorMs = 0;
  /** Acumulador del ranking vivo (RACE_MULTI.rankIntervalMs). */
  private rankAccumulatorMs = 0;
  /** Última proyección del auto propio (broadcast/ranking del frame). */
  private lastProjection: TrackProjection = { s: 0, lateral: 0, angle: 0 };
  /** Peer cuyo sprite sigue la cámara (switch del espectador). */
  private followingPeerId: string | null = null;

  /* ---------------------------------------------------------------- */
  /* V3 — robustez (plausibilidad, staleness, chat de espectador)      */
  /* ---------------------------------------------------------------- */

  /**
   * Filtro de plausibilidad del progreso ajeno (por peer, contra el tope
   * físico de `CIRCUIT`): un avance imposible se ignora y espera el próximo
   * `rstate` — sin árbitro P2P, es la única confianza validable.
   */
  private plausibility = new RacePlausibility();
  /** Presencia de peers: quién dejó de mandar `rstate` (PLAYER_STALE_MS). */
  private staleTracker = new RaceStaleTracker();
  /** Acumulador del barrido de staleness (~1 vez por segundo, patrón #1). */
  private staleSweepAccumulatorS = 0;
  /** Botón CHAT del espectador de carrera (sólo tras el `rfin` propio). */
  private spectatorChatButton: MenuButton | null = null;

  /* ---------------------------------------------------------------- */
  /* V1 (issue #14) — GRAN PREMIO vs CPU                               */
  /*                                                                  */
  /* SIETE rivales con personalidad (`race/ai/rivalRoster.ts`),        */
  /* simulados en el MISMO paso fijo que el jugador y con la MISMA      */
  /* `CircuitPhysics`: cada driver sólo decide su `CircuitInput` y      */
  /* sigue la LÍNEA DE CARRERA compartida (`race/ai/racingLine.ts`,     */
  /* precomputada UNA vez por pista). La parrilla de 8 sale de          */
  /* `assignGridOrder` con la seed del init data y el ranking vivo      */
  /* reutiliza `rankCars` → `RaceHud.setPosition`. El modo corta        */
  /* cuando el JUGADOR cruza la meta final (mismo criterio de           */
  /* congelación de la práctica): los rivales ya terminados quedan      */
  /* congelados tras la línea y el resto clasifica por progreso con     */
  /* `finalClassification`.                                             */
  /* ---------------------------------------------------------------- */

  /** Línea de carrera compartida por todos los rivales (una vez por pista). */
  private racingLine: RacingLine | null = null;
  /** Roster congelado de la carrera (null fuera del modo vs-cpu). */
  private rivalRoster: Rival[] = [];
  /** Runtime de cada rival: estado, física, vueltas, driver y sprite. */
  private rivals: RivalRuntime[] = [];
  /** Dificultad de los rivales (presets en `RACE_AI`; default 'normal'). */
  private cpuDifficulty: CpuDifficulty = DEFAULT_CPU_DIFFICULTY;
  /**
   * V3 (#14) — detector de cambios de posición propia (SFX de
   * adelantamiento con enfriamiento). Se recrea en create: el restart
   * reutiliza la instancia de escena y el estado debe arrancar limpio.
   */
  private positionSwapDetector!: PositionSwapDetector;

  constructor() {
    super(RaceScene.KEY);
  }

  /**
   * Init data de escena: `{ trackId, mode: 'practice' }` desde el selector
   * de pistas del menú (o desde el REINTENTAR de resultados). Parseo
   * defensivo: payload ausente o inválido degrada a la pista por default.
   */
  init(data: unknown): void {
    this.sceneInit = parseRaceSceneInit(data);
  }

  create(): void {
    const { width, height } = this.scale;

    // Pista + núcleo puro frescos (el restart reutiliza la instancia).
    this.finished = false;
    this.bus = this.sessionBus();
    this.trackDef = getTrackById(this.sceneInit.trackId) ?? TRACKS[0];
    this.path = buildTrackPath(this.trackDef);
    this.carPhysics = new CircuitPhysics(this.path, this.trackDef.widthPx);
    this.lapTracker = new LapTracker(this.path);

    // V1 (#14) — rivales frescos (el restart reutiliza la instancia).
    this.racingLine = null;
    for (const rival of this.rivals) {
      rival.car.destroy();
    }
    this.rivals = [];
    // Separación de cámaras: el registro de MUNDO arranca fresco (el restart
    // reutiliza la instancia y los objetos viejos ya están destruidos).
    this.worldObjects = [];
    this.rivalRoster = [];
    this.cpuDifficulty = this.sceneInit.difficulty ?? DEFAULT_CPU_DIFFICULTY;
    // V3 (#14) — detector fresco de cambios de posición (idempotencia del
    // restart: sin línea base heredada de la carrera anterior).
    this.positionSwapDetector = new PositionSwapDetector(RACE_VS_CPU.positionSfxCooldownMs);

    // Estado POR CARRERA fresco (multi y vs CPU): la instancia de escena
    // sobrevive a los restarts y nada de la carrera anterior debe colarse —
    // un `race-over`/`rfin` viejo concluía la siguiente carrera multi al
    // instante y un `selfFinished` heredado del multi congelaba al jugador
    // en el GRAN PREMIO (nunca pisaba el acelerador ni contaba vueltas).
    this.raceConcluded = false;
    this.selfFinished = false;
    this.firstFinish = null;
    this.raceOverStandings = null;
    this.raceOverSent = false;
    this.followingPeerId = null;
    this.rankAccumulatorMs = 0;
    this.stateAccumulatorMs = 0;
    this.staleSweepAccumulatorS = 0;
    this.finishedPeers.clear();
    this.remoteProgress.clear();
    this.disconnectedPeers.clear();

    // Parrilla determinista detrás de la meta: práctica = un solo corredor
    // en la pole; multi = TODO el roster (misma seed ⇒ misma parrilla en
    // todos los clientes, ver `gridOrder`); vs CPU (#14) = jugador + los 7
    // rivales del roster determinista de la seed.
    this.rivalRoster = this.isVsCpu()
      ? buildRivalRoster(this.sceneInit.seed ?? 0, this.cpuDifficulty)
      : [];
    this.gridSlots = this.isMultiRace()
      ? assignGridOrder(this.rosterPlayers, this.sceneInit.seed ?? 0, this.path)
      : this.isVsCpu()
        ? assignGridOrder(
            [{ peerId: PLAYER_PEER_ID }, ...this.rivalRoster.map((rival) => ({ peerId: rival.peerId }))],
            this.sceneInit.seed ?? 0,
            this.path,
          )
        : assignGridOrder([{ peerId: PLAYER_PEER_ID }], PRACTICE_GRID_SEED, this.path);
    const ownSlot = this.isMultiRace()
      ? (this.gridSlots.find((slot) => slot.peerId === this.myPeerId) ??
        this.gridSlots[0])
      : (this.gridSlots.find((slot) => slot.peerId === PLAYER_PEER_ID) ??
        this.gridSlots[0]);
    this.carState = {
      x: ownSlot.x ?? this.path.sample(0).x,
      y: ownSlot.y ?? this.path.sample(0).y,
      heading: ownSlot.angle ?? 0,
      speed: 0,
    };

    // Mundo estático: la pista pre-horneada en UNA imagen + el auto encima.
    // Todo lo que nace de acá en adelante es MUNDO (se registra en
    // `worldObjects` para que la cámara de UI lo ignore); el HUD usa `hud()`.
    const trackImage = this.add
      .image(0, 0, this.ensureTrackTexture())
      .setOrigin(0, 0)
      .setDepth(0);
    this.carSprite = this.add
      .sprite(this.carState.x, this.carState.y, TEXTURE_KEYS.playerCar)
      .setDepth(10);
    this.syncCarSprite();
    this.worldObjects.push(trackImage, this.carSprite);

    // V4 — confeti del cruce de meta final: burst multicolor one-shot sobre
    // el auto (tint = paleta de la sala, cero colores mágicos nuevos).
    this.confettiEmitter = this.add
      .particles(0, 0, TEXTURE_KEYS.particle, {
        lifespan: RACE_CONFETTI.lifespanMs,
        speed: { min: RACE_CONFETTI.speedMin, max: RACE_CONFETTI.speedMax },
        angle: { min: RACE_CONFETTI.angleMin, max: RACE_CONFETTI.angleMax },
        scale: { start: RACE_CONFETTI.scaleStart, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [...MULTIPLAYER.palette],
        emitting: false,
      })
      .setDepth(RACE_CONFETTI.depth);
    this.worldObjects.push(this.confettiEmitter);

    // Cámara: norte arriba, zoom fijo, sigue con lerp, clampada al mundo.
    this.cameras.main.setBounds(
      0,
      0,
      this.trackDef.worldSize.width,
      this.trackDef.worldSize.height,
    );
    this.cameras.main.setZoom(RACE.cameraZoom);
    this.cameras.main.startFollow(this.carSprite, false, RACE.cameraLerp, RACE.cameraLerp);

    // Cámara de UI (zoom 1 default, viewport completo, transparente): el HUD
    // se renderiza SOLO acá para que el zoom de la cámara del mundo no lo
    // escale (en Phaser 4 el zoom alcanza también a los scrollFactor(0)).
    this.uiCam = this.cameras.add(0, 0, width, height);

    // Evento de fin: LapTracker avisa al completar la última vuelta válida.
    // En práctica congela el mundo y va a resultados; en multi difunde el
    // `rfin` propio (una vez) y pasa a espectador.
    this.lapTracker.onRaceFinished = (event) => {
      if (this.isMultiRace()) {
        this.handleSelfRaceFinished(event);
      } else {
        this.finishRace();
      }
    };

    // V4 — cartel pop al completar una vuelta válida que NO sea la última
    // (la última ya tiene su cartel de BANDERA A CUADROS + confeti).
    // Issue #27 — telemetría: cada vuelta válida del JUGADOR LOCAL reporta
    // `vuelta_completada` (ver `trackLapCompleted`).
    this.lapTracker.onLapCompleted = (event) => {
      this.trackLapCompleted(event);
      if (event.lap < CIRCUIT.totalLaps) {
        this.showLapBanner(event.lap);
      }
    };

    // Input de carrera: teclado propio + táctil propio, fusionados por el
    // mismo InputSystem del modo BATALLA.
    this.keyboard = new RaceKeyboardSource(this.input.keyboard ?? null);
    this.touch = new RaceTouchControls(this);
    this.inputSystem = new InputSystem([this.keyboard, this.touch]);
    this.inputSystem.attach();

    // Countdown 3-2-1-GO!: el mundo (física, vueltas, input) queda en gate
    // hasta terminar la cuenta — igual criterio que GameScene.
    this.pauseSystem = new PauseSystem();
    this.countdown = new CountdownSystem();
    this.createCountdownText(width, height);
    this.renderCountdownLabel(this.countdown.label ?? '3');

    this.createHud(width, height);

    // Pausa real sólo en los modos locales (práctica y vs CPU): en multi la
    // red no se pausa (mismo criterio que GameScene) — ni botón, ni tecla,
    // ni blur.
    if (this.isVsCpu()) {
      this.setupVsCpu();
    }
    if (this.isMultiRace()) {
      this.setupMultiRace();
    } else {
      this.createPauseControls();
      // Pausa automática por pérdida de foco (HIDDEN/BLUR), como GameScene.
      this.game.events.on(Phaser.Core.Events.HIDDEN, this.pauseGame);
      this.game.events.on(Phaser.Core.Events.BLUR, this.pauseGame);
      this.events.on(Phaser.Scenes.Events.RESUME, this.handleSceneResume);
    }

    // Separación de cámaras (issue #18): el mundo (pista, autos, confeti y
    // los rivales/remotos nacidos en los setups de arriba) renderiza SOLO en
    // `cameras.main`; `uiCam` lo ignora de una pasada. El camino inverso está
    // en `hud()`, llamado en cada creación de HUD.
    this.uiCam.ignore(this.worldObjects);

    // HUD con el estado inicial (la cuenta aún no arrancó los relojes).
    this.raceHud.setLap(this.lapTracker.currentLap, CIRCUIT.totalLaps);
    this.raceHud.setTimings(this.lapTracker.currentLapMs, this.lapTracker.totalMs);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.detach();
      this.touch.destroy();
      for (const widget of this.hudWidgets) {
        widget.destroy();
      }
      this.hudWidgets = [];
      if (!this.isMultiRace()) {
        this.game.events.off(Phaser.Core.Events.HIDDEN, this.pauseGame);
        this.game.events.off(Phaser.Core.Events.BLUR, this.pauseGame);
        this.events.off(Phaser.Scenes.Events.RESUME, this.handleSceneResume);
      }
      this.teardownMultiRace();
      // V1 (#14) — los sprites de los rivales salen con la escena.
      for (const rival of this.rivals) {
        rival.car.destroy();
      }
      this.rivals = [];
      // V4 — salida por cualquier camino (MENÚ desde la pausa, transición a
      // resultados): corta el dron del motor sin SFX de crash. No-op si ya
      // se apagó con el fin de la carrera.
      this.bus.emit('game-aborted', undefined);
    });
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    // Carrera terminada (práctica congelada o carrera multi concluida): el
    // mundo queda congelado y sólo corre el delayedCall de la transición.
    if (this.finished || this.raceConcluded) {
      return;
    }

    // Tecla P: pausa con JustDown (anti auto-repeat), igual que GameScene.
    // (En multi no hay pauseKey: el chequeo ni siquiera corre.)
    if (this.pauseKey && Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.pauseGame();
      return;
    }

    // Countdown 3-2-1-GO!: nada de física ni vueltas hasta el GO!.
    if (!this.countdown.isFinished) {
      this.updateCountdown(dt);
      return;
    }

    // ÚNICA lectura de input por frame → CircuitInput de la física pura.
    // En multi, quien terminó su carrera deja de conducir (espectador).
    if (!this.selfFinished) {
      const input = circuitInputFromState(this.inputSystem.getState());
      this.carPhysics.step(this.carState, dt, input);
      // V4 — el dron del motor sigue la velocidad del auto (arranca con el
      // GO!; se apaga en pausa/fin/shutdown por el bus de sesión).
      this.bus.emit('speed', raceEngineSpeed(this.carState.speed));
    }

    // Vueltas: la coordenada de arco del frame alimenta al LapTracker.
    const projection = this.path.project(this.carState.x, this.carState.y);
    this.lastProjection = projection;
    if (!this.selfFinished) {
      this.lapTracker.update(projection.s, delta);
    }

    // Presentación: sprite del auto, minimapa y HUD de vuelta/tiempos.
    this.syncCarSprite();
    this.syncMiniMap();
    this.raceHud.setLap(this.lapTracker.currentLap, CIRCUIT.totalLaps);
    this.raceHud.setTimings(this.lapTracker.currentLapMs, this.lapTracker.totalMs);

    // Multijugador: broadcast propio a STATE_HZ, rivales interpolados,
    // ranking vivo, staleness y condiciones de cierre de la carrera.
    if (this.isMultiRace()) {
      this.broadcastRaceState(projection, delta);
      this.syncRemoteCars();
      this.updateLiveRanking(delta);
      this.sweepStaleTick(delta);
      this.checkRaceEnd();
      return;
    }

    // V0 (#14) — vs CPU: sim del rival en el MISMO paso fijo (misma física)
    // + ranking vivo de 2 autos. El modo corta cuando el JUGADOR termina
    // (finishRace), así que acá no hay condición de cierre propia.
    if (this.isVsCpu()) {
      this.stepVsCpu(dt, delta);
    }
  }

  /** true si esta escena corre la carrera MULTIJUGADOR (V2). */
  private isMultiRace(): boolean {
    return this.sceneInit.mode === 'race';
  }

  /** true si esta escena corre el GRAN PREMIO vs CPU (issue #14, V0). */
  private isVsCpu(): boolean {
    return this.sceneInit.mode === 'vs-cpu';
  }

  /** peerId propio (V2; '' en práctica). */
  private get myPeerId(): string {
    return this.sceneInit.myPeerId ?? '';
  }

  /** Roster congelado del start (V2; vacío en práctica). */
  private get rosterPlayers(): PlayerInfo[] {
    return this.sceneInit.players ?? [];
  }

  /** Minimapa: el auto propio + un punto por rival con SU color del roster. */
  private syncMiniMap(): void {
    const cars = [
      { id: PLAYER_PEER_ID, x: this.carState.x, y: this.carState.y, tint: PLAYER_MINIMAP_TINT },
    ];
    // V1 (#14) — los 7 rivales compiten en el mundo: cada punto usa el MISMO
    // color que su sprite (MiniMap ya soporta N marcadores).
    for (const rival of this.rivals) {
      cars.push({
        id: rival.rival.peerId,
        x: rival.state.x,
        y: rival.state.y,
        tint: rival.rival.color,
      });
    }
    for (const [peerId, car] of this.remotes) {
      cars.push({ id: peerId, ...car.position, tint: car.player.color });
    }
    this.miniMap.updateCars(cars);
  }

  /* ---------------------------------------------------------------- */
  /* Presentación                                                      */
  /* ---------------------------------------------------------------- */

  /** Sincroniza el sprite con el estado de la física (posición + heading). */
  private syncCarSprite(): void {
    this.carSprite.setPosition(this.carState.x, this.carState.y);
    this.carSprite.rotation = this.carState.heading + CAR_SPRITE_ANGLE_OFFSET;
  }

  /* ---------------------------------------------------------------- */
  /* V1 (issue #14) — carrera vs CPU (7 rivales)                       */
  /* ---------------------------------------------------------------- */

  /**
   * Arma los rivales: la línea de carrera compartida (precomputada UNA vez
   * por pista), su casilla de parrilla (asignada junto con la del jugador),
   * su física/lapTracker/driver V1 (presets × personalidad) y su sprite
   * (patrón RemoteCar: textura por color de `GhostCar.ensureTexture` +
   * etiqueta de nombre).
   */
  private setupVsCpu(): void {
    this.racingLine = buildRacingLine(this.path, this.trackDef.widthPx);
    const slotsByPeer = new Map(this.gridSlots.map((slot) => [slot.peerId, slot]));

    // V3 (#14) — chip de contexto "GRAN PREMIO · MÓNACO · DIFÍCIL": fijo
    // toda la carrera (el HUD repinta sólo si cambió).
    this.raceHud.setInfoChip(
      this.trackDef.name,
      CPU_DIFFICULTY_LABELS[this.cpuDifficulty] ?? CPU_DIFFICULTY_LABELS.normal,
    );

    for (const rival of this.rivalRoster) {
      const slot = slotsByPeer.get(rival.peerId) ?? this.gridSlots[0];
      const state: CarState = {
        x: slot.x ?? this.path.sample(0).x,
        y: slot.y ?? this.path.sample(0).y,
        heading: slot.angle ?? 0,
        speed: 0,
      };
      const lapTracker = new LapTracker(this.path);
      // El rival que completa sus 3 vueltas se CONGELA tras la meta: el modo
      // corta cuando termina el JUGADOR y el clasificador final decide con
      // SU tiempo exacto (o su último progreso, si no llegó).
      lapTracker.onRaceFinished = () => {
        const runtime = this.rivals.find((entry) => entry.rival.peerId === rival.peerId);
        if (runtime) {
          runtime.finished = true;
          runtime.finish = {
            totalMs: runtime.lapTracker.totalMs,
            bestLapMs: runtime.lapTracker.bestLapMs,
          };
        }
      };
      // V2 (#14) — el driver recibe el RNG PROPIO del rival (su seed
      // derivada): errores humanos y maniobras deterministas por carrera.
      const driver = new AiDriver(
        this.path,
        this.racingLine,
        rivalDriverConfig(rival, this.cpuDifficulty),
        mulberry32(rival.seed),
      );
      const car = new RemoteCar(this, {
        peerId: rival.peerId,
        name: rival.name,
        color: rival.color,
      }, {
        // V3 (#14) — nombre un punto más grande que el default del multi:
        // en el GRAN PREMIO hay que saber CONTRA QUIÉN se pelea a zoom
        // RACE.cameraZoom (el multi conserva su tamaño histórico).
        labelFontSize: RACE_VS_CPU.rivalNameFontSize,
      });
      if (slot.x !== undefined && slot.y !== undefined) {
        car.sync(slot.x, slot.y, slot.angle ?? 0);
      }
      // MUNDO para la separación de cámaras (issue #18): el sprite y su
      // nombre se quedan en cameras.main — uiCam debe ignorarlos.
      this.worldObjects.push(...car.renderObjects);
      this.rivals.push({
        rival,
        state,
        physics: new CircuitPhysics(this.path, this.trackDef.widthPx),
        lapTracker,
        driver,
        car,
        lastS: slot.s ?? 0,
        lastLateral: 0,
        finished: false,
        finish: null,
      });
    }
  }

  /**
   * Un frame del vs CPU: cada rival corre en el MISMO paso fijo que el
   * jugador (mismo `dt`, misma `CircuitPhysics`) y el ranking vivo de 8
   * autos repinta el badge Pn/N al ritmo de `RACE_MULTI.rankIntervalMs`
   * (igual que multi).
   *
   * V2 (#14) — el driver recibe VISIÓN de los demás autos (rivales + jugador,
   * con el estado al inicio del frame: un frame de lag a 60 Hz es invisible y
   * evita re-proyectar cada auto por cada driver), su gap de progreso al
   * JUGADOR (goma) y el `dt` del paso (reloj de errores humanos).
   */
  private stepVsCpu(dt: number, deltaMs: number): void {
    const length = this.path.totalLength;
    const playerProgress = this.lapTracker.lapsCompleted * length + this.lastProjection.s;
    const playerVision: AiCarVision = {
      s: this.lastProjection.s,
      lateral: this.lastProjection.lateral,
      speed: this.carState.speed,
    };
    const rivalVisions: AiCarVision[] = this.rivals.map((runtime) => ({
      s: runtime.lastS,
      lateral: runtime.lastLateral,
      speed: runtime.state.speed,
    }));

    for (let i = 0; i < this.rivals.length; i += 1) {
      const runtime = this.rivals[i];
      if (!runtime.finished) {
        const others = rivalVisions.filter((_, j) => j !== i);
        others.push(playerVision);
        const rivalProgress = runtime.lapTracker.lapsCompleted * length + runtime.lastS;
        const input = runtime.driver.drive(runtime.state, dt, {
          cars: others,
          playerGapPx: playerProgress - rivalProgress,
        });
        runtime.physics.step(runtime.state, dt, input);
        const projection = this.path.project(runtime.state.x, runtime.state.y);
        runtime.lastS = projection.s;
        runtime.lastLateral = projection.lateral;
        runtime.lapTracker.update(projection.s, deltaMs);
      }
      runtime.car.sync(runtime.state.x, runtime.state.y, runtime.state.heading);
    }

    // Ranking vivo (sólo consume progreso: lap + s, mismo contrato que multi).
    this.rankAccumulatorMs += deltaMs;
    if (this.rankAccumulatorMs < RACE_MULTI.rankIntervalMs) {
      return;
    }
    this.rankAccumulatorMs = 0;
    const standings = rankCars(
      { peerId: PLAYER_PEER_ID, lap: this.lapTracker.lapsCompleted, s: this.lastProjection.s },
      this.rivals.map((runtime) => ({
        peerId: runtime.rival.peerId,
        lap: runtime.lapTracker.lapsCompleted,
        s: runtime.lastS,
      })),
      this.path.totalLength,
    );
    const mine = standings.find((standing) => standing.peerId === PLAYER_PEER_ID);
    this.raceHud.setPosition(mine?.position ?? 1, standings.length);

    // V3 (#14) — gap en tiempo a los rivales de adelante/atrás (puramente
    // del progreso desenrollado dividido por la velocidad propia: se oculta
    // con la velocidad baja, al arrancar, y se clampea lejos).
    const gaps = computeRaceGaps(
      mine?.progress ?? 0,
      this.carState.speed,
      standings.filter((standing) => standing.peerId !== PLAYER_PEER_ID),
      { maxSeconds: RACE_VS_CPU.gapMaxSeconds, minOwnSpeedPx: RACE_VS_CPU.gapMinOwnSpeedPx },
    );
    this.raceHud.setGaps(gaps.ahead?.seconds ?? null, gaps.behind?.seconds ?? null);

    // V3 (#14) — SFX de adelantamiento: la detección (dirección + enfriamiento
    // de ~2 s, máximo 1 por cambio) es el detector puro; el bus sólo se entera
    // cuando corresponde sonar.
    const swap = this.positionSwapDetector.update(mine?.position ?? 1, this.time.now);
    if (swap !== null) {
      this.bus.emit('race-overtake', undefined);
    }
  }

  /**
   * Resultados del vs CPU: clasificación final con `finalClassification` —
   * el jugador (siempre `finished`: el modo corta con SU bandera a cuadros)
   * y cada rival terminado por SU tiempo o en carrera por último progreso —
   * de donde sale la posición final que viaja en el payload (1º..8º).
   *
   * V4 (#14): la MISMA clasificación alimenta el PODIO (top 3 con nombres
   * visibles; el jugador viaja como `VS_CPU_PLAYER_NAME` para que la pantalla
   * lo destaque o lo dibuje aparte si quedó fuera del top 3).
   */
  private buildVsCpuResults(): RaceVsCpuResultsData {
    const cars: FinalCar[] = [
      {
        peerId: PLAYER_PEER_ID,
        lap: this.lapTracker.lapsCompleted,
        s: this.lastProjection.s,
        status: 'finished',
        totalMs: this.lapTracker.totalMs,
      },
      ...this.rivals.map((runtime): FinalCar =>
        runtime.finish
          ? {
              peerId: runtime.rival.peerId,
              lap: runtime.lapTracker.lapsCompleted,
              s: runtime.lastS,
              status: 'finished' as const,
              totalMs: runtime.finish.totalMs,
            }
          : {
              peerId: runtime.rival.peerId,
              lap: runtime.lapTracker.lapsCompleted,
              s: runtime.lastS,
              status: 'running' as const,
            },
      ),
    ];
    const standings = finalClassification(cars, this.path.totalLength);
    const position =
      standings.find((standing) => standing.peerId === PLAYER_PEER_ID)?.position ?? 1;
    return raceVsCpuResultsPayload(
      this.trackDef.id,
      position,
      cars.length,
      this.cpuDifficulty,
      this.lapTracker.lapsCompleted,
      this.lapTracker.bestLapMs,
      this.lapTracker.totalMs,
      raceVsCpuPodium(
        standings,
        (peerId) =>
          this.rivalRoster.find((rival) => rival.peerId === peerId)?.name ??
          VS_CPU_FALLBACK_PILOT_NAME,
        PLAYER_PEER_ID,
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* V2 — carrera multijugador                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Arma la capa multi: toma el NetClient que el lobby entregó por registry,
   * crea un RemoteCar en SU casilla de parrilla por rival y se suscribe a
   * las acciones nuevas de la carrera (`rstate`/`rfin`/`race-over`).
   */
  private setupMultiRace(): void {
    const players = this.rosterPlayers;
    const slotsByPeer = new Map(this.gridSlots.map((slot) => [slot.peerId, slot]));

    // V3: filtros frescos (la instancia de escena sobrevive a los restarts).
    this.plausibility = new RacePlausibility();
    this.staleTracker = new RaceStaleTracker();

    for (const player of players) {
      if (player.peerId === this.myPeerId) {
        continue;
      }
      const slot = slotsByPeer.get(player.peerId);
      const car = new RemoteCar(this, player);
      if (slot?.x !== undefined && slot?.y !== undefined) {
        car.sync(slot.x, slot.y, slot.angle ?? 0);
      }
      // MUNDO para la separación de cámaras (issue #18): el sprite y su
      // nombre se quedan en cameras.main — uiCam debe ignorarlos.
      this.worldObjects.push(...car.renderObjects);
      this.remotes.set(player.peerId, car);
      this.remoteBuffers.set(player.peerId, new SnapshotBuffer<RaceRemoteSample>());
      this.remoteProgress.set(player.peerId, { lap: 0, s: slot?.s ?? 0 });
      // Presencia inicial (base del stale para quien NUNCA mande `rstate`,
      // igual criterio que el startedAt de MatchTracker).
      this.staleTracker.record(player.peerId, this.time.now);
    }

    this.netClient = takeSessionNetClient(this.registry);
    const client = this.netClient;
    if (!client) {
      return; // Degradación defensiva: carrera multi sin transporte.
    }
    this.netUnsubs.push(
      client.onRaceState((peerId, payload) => this.handleRaceState(peerId, payload)),
      client.onRaceFinish((peerId, payload) => this.handleRaceFinish(peerId, payload)),
      client.onRaceOver((peerId, payload) => this.handleRaceOver(peerId, payload)),
      client.onPeerLeave((peerId) => this.handlePeerLeftRace(peerId)),
      // Chat de sala (V3): sigue llegando durante TODA la carrera — entra al
      // store de sesión y el espectador (quien terminó) lo lee/escribe desde
      // el overlay. Mismo cableado que el espectador de la BATALLA (#2).
      client.onChat((fromPeerId, payload) => {
        const store = getSessionChatStore(this.registry);
        if (store) {
          receiveRoomChat(store, client.getRoster(), fromPeerId, payload, Date.now());
        }
      }),
    );
  }

  /** SHUTDOWN multi: sprites y suscripciones fuera, transporte destruido. */
  private teardownMultiRace(): void {
    for (const unsub of this.netUnsubs) {
      unsub();
    }
    this.netUnsubs = [];
    for (const car of this.remotes.values()) {
      car.destroy();
    }
    this.remotes.clear();
    this.remoteBuffers.clear();
    this.plausibility.clear();
    this.staleTracker.clear();
    this.spectatorChatButton = null;
    // La RaceScene heredó el cliente del lobby (handoff por registry): al
    // apagarse (resultados, salida), la sala muere con la carrera.
    this.netClient?.destroy();
    this.netClient = null;
  }

  /**
   * Llegó `rstate` de un rival: el payload se RE-normaliza con la pista local
   * (misma función que el emisor — defensa en profundidad contra un peer
   * corrupto) y alimenta el buffer como progreso DESENROLLADO (monótono, no
   * salta en la meta) más el último (lap, s) crudo para el ranking.
   *
   * V3 — antes de tocar nada, el progreso pasa el filtro de plausibilidad
   * (`race/racePlausibility`): un avance físicamente imposible se IGNORA
   * (buffer, ranking y presencia ni se enteran) y se espera el próximo
   * `rstate`; un sample aceptado refresca la presencia del peer (staleness).
   */
  private handleRaceState(peerId: string, payload: {
    s: number;
    o: number;
    v: number;
    lap: number;
  }): void {
    if (!this.remoteBuffers.has(peerId)) {
      return; // Peer desconocido (no está en el roster congelado): ignorar.
    }
    const clean = roundRaceStatePayload(
      payload,
      this.path.totalLength,
      this.trackDef.widthPx / 2,
    );
    const progress = unrollProgress(clean.lap, clean.s, this.path.totalLength);
    if (!this.plausibility.accept(peerId, progress, this.time.now)) {
      return; // Avance imposible: se ignora, se espera el próximo rstate.
    }
    this.staleTracker.record(peerId, this.time.now);
    this.remoteBuffers.get(peerId)?.push({
      t: this.time.now,
      progress,
      o: clean.o,
    });
    this.remoteProgress.set(peerId, { lap: clean.lap, s: clean.s });
  }

  /** Llegó `rfin`: ese peer terminó sus 3 vueltas con estos tiempos. */
  private handleRaceFinish(peerId: string, payload: unknown): void {
    const clean = parseRaceFinishPayload(payload);
    if (!clean || !this.rosterPlayers.some((player) => player.peerId === peerId)) {
      return;
    }
    this.finishedPeers.set(peerId, clean);
    if (!this.firstFinish) {
      this.firstFinish = { peerId, at: this.time.now };
    }
  }

  /**
   * Llegó `race-over` del ganador: su clasificación manda sobre la local.
   * Mismo gate de roster que el `rfin` (un remitente fuera del roster
   * congelado no puede concluir la carrera de todos).
   */
  private handleRaceOver(peerId: string, payload: unknown): void {
    if (!this.rosterPlayers.some((player) => player.peerId === peerId)) {
      return; // Remitente desconocido (no está en el roster congelado): ignorar.
    }
    const parsed = parseRaceOverPayload(payload);
    if (!parsed) {
      return;
    }
    this.raceOverStandings = parsed.standings;
  }

  /**
   * Un peer se fue de la sala (V3): su coche se DESTRUYE (desaparece del
   * mundo y del minimapa) y entra a la clasificación final como
   * `disconnected` con su último progreso conocido (`remoteProgress` queda).
   */
  private handlePeerLeftRace(peerId: string): void {
    this.disconnectedPeers.add(peerId);
    this.staleTracker.markStale(peerId);
    this.removeRemoteCar(peerId);
  }

  /**
   * V3 — quita el coche de un peer del mundo SIN borrar su último progreso:
   * el sprite sale de remotes (mundo + minimapa) y su buffer de
   * interpolación se vacía, pero `remoteProgress` queda para que
   * `finalClassification` lo clasifique por su último avance.
   */
  private removeRemoteCar(peerId: string): void {
    this.remotes.get(peerId)?.destroy();
    this.remotes.delete(peerId);
    this.remoteBuffers.delete(peerId);
  }

  /**
   * Barrido de staleness ~1 vez por segundo (mismo patrón que GameScene):
   * todo rival a más de PLAYER_STALE_MS sin `rstate` (pestaña muerta, red
   * caída sin leave) sale del mundo y clasifica como `disconnected`. Quien ya
   * terminó dejó de emitir `rstate` POR DISEÑO (`broadcastRaceState` corta con
   * `selfFinished`): no es un peer caído — su coche queda estacionado tras la
   * meta y su clasificación ya es `finished` por su `rfin`.
   */
  private sweepStaleTick(deltaMs: number): void {
    this.staleSweepAccumulatorS += deltaMs / 1000;
    if (this.staleSweepAccumulatorS < STALE_SWEEP_INTERVAL_S) {
      return;
    }
    this.staleSweepAccumulatorS = 0;
    for (const peerId of this.staleTracker.sweep(this.time.now)) {
      if (this.finishedPeers.has(peerId)) {
        continue; // Terminó y dejó de transmitir: no es staleness.
      }
      this.disconnectedPeers.add(peerId);
      this.removeRemoteCar(peerId);
    }
  }

  /**
   * Broadcast propio `rstate` a STATE_HZ: {s, o, v, lap} en coordenadas de
   * pista, normalizado por la MISMA función que usa el receptor. El propio
   * stream no llega por red (nadie se interpola a sí mismo): sólo se envía
   * mientras se compite.
   */
  private broadcastRaceState(projection: TrackProjection, deltaMs: number): void {
    if (this.selfFinished || !this.netClient) {
      return;
    }
    // Saturación (issue #35): el delta acumulado NUNCA itera — un tramo
    // gigante (background en multi, sin auto-pausa) emite UN único rstate
    // fresco y descarta el sobrante (patrón de GameScene; raceBroadcast.ts).
    const schedule = scheduleRaceStateBroadcast(
      this.stateAccumulatorMs,
      deltaMs,
      1000 / STATE_HZ,
    );
    this.stateAccumulatorMs = schedule.accumulatorMs;
    if (schedule.sendCount === 0) {
      return;
    }
    this.netClient.sendRaceState(
      roundRaceStatePayload(
        {
          s: projection.s,
          o: projection.lateral,
          v: this.carState.speed,
          lap: this.lapTracker.lapsCompleted,
        },
        this.path.totalLength,
        this.trackDef.widthPx / 2,
      ),
    );
  }

  /**
   * Rivales interpolados: render a t − GHOST_INTERPOLATION_MS sobre el
   * progreso desenrollado (continuo en la meta) y reconstrucción de
   * x/y/ángulo con el TrackPath local. Sin datos aún (peer nuevo o caído),
   * el coche queda en su última posición conocida (la casilla al arrancar).
   */
  private syncRemoteCars(): void {
    const renderT = this.time.now - GHOST_INTERPOLATION_MS;
    for (const [peerId, buffer] of this.remoteBuffers) {
      const car = this.remotes.get(peerId);
      if (!car) {
        continue;
      }
      const point = buffer.renderAt(renderT);
      if (!point) {
        continue;
      }
      const position = sampleFromProgress(this.path, point.progress, point.o);
      car.sync(position.x, position.y, position.angle);
    }
  }

  /**
   * Ranking vivo cada RACE_MULTI.rankIntervalMs: `rankCars` con el último
   * (lap, s) de cada auto → badge "P3/8" en el HUD. Si uno mismo ya terminó
   * (espectador), la cámara pasa a seguir al líder.
   */
  private updateLiveRanking(deltaMs: number): void {
    this.rankAccumulatorMs += deltaMs;
    if (this.rankAccumulatorMs < RACE_MULTI.rankIntervalMs) {
      return;
    }
    this.rankAccumulatorMs = 0;

    const myPeerId = this.myPeerId;
    const own: RankedCar = {
      peerId: myPeerId,
      lap: this.lapTracker.lapsCompleted,
      s: this.lastProjection.s,
    };
    const remotes: RankedCar[] = [...this.remoteProgress.entries()].map(([peerId, progress]) => ({
      peerId,
      lap: progress.lap,
      s: progress.s,
    }));
    const standings = rankCars(own, remotes, this.path.totalLength);
    const mine = standings.find((standing) => standing.peerId === myPeerId);
    this.raceHud.setPosition(mine?.position ?? 1, standings.length);

    // Espectador (V3 pulido): sigue al mejor clasificado que SIGA EN CARRERA
    // — el líder nominal del ranking puede ser un coche que YA terminó
    // (estacionado tras la meta, progreso más alto) o el propio (congelado
    // desde el rfin: seguirlo es mirar la pantalla quieta). Si nadie rueda ya
    // (todos terminaron o cayeron), el mejor coche presente; si no hay
    // ninguno, el propio. Los desconectados conservan su fila en el ranking
    // (su último progreso), pero ya no tienen coche que darles.
    if (this.selfFinished) {
      const leader =
        standings.find(
          (standing) =>
            standing.peerId !== myPeerId &&
            !this.finishedPeers.has(standing.peerId) &&
            this.remotes.has(standing.peerId),
        ) ??
        standings.find(
          (standing) =>
            standing.peerId !== myPeerId && this.remotes.has(standing.peerId),
        );
      if (leader) {
        this.followLeader(leader.peerId, myPeerId);
      }
    }
  }

  /** Cámara del espectador: sigue el sprite del líder (switch idempotente). */
  private followLeader(leaderPeerId: string, myPeerId: string): void {
    if (this.followingPeerId === leaderPeerId) {
      return;
    }
    const target =
      leaderPeerId === myPeerId
        ? this.carSprite
        : this.remotes.get(leaderPeerId)?.followTarget;
    if (!target) {
      return;
    }
    this.followingPeerId = leaderPeerId;
    this.cameras.main.startFollow(target, false, RACE.cameraLerp, RACE.cameraLerp);
  }

  /**
   * Condiciones de cierre de la carrera multi, EN ORDEN:
   * 1) llegó `race-over` del ganador → sus standings mandan;
   * 2) terminaron todos → el ganador difunde su clasificación y cierra;
   * 3) venció RACE_FINISH_GRACE_MS desde el primer `rfin` → cierra el
   *    ganador (difundiendo) o cada cliente con SU clasificación local
   *    (defensa: ganador desaparecido — las reglas determinísticas hacen
   *    que la clasificación local coincida con la que habría difundido).
   */
  private checkRaceEnd(): void {
    if (this.raceConcluded) {
      return;
    }
    if (this.raceOverStandings) {
      this.concludeRace(this.raceOverStandings);
      return;
    }
    const allFinished = this.rosterPlayers.every((player) =>
      this.finishedPeers.has(player.peerId),
    );
    if (allFinished) {
      this.broadcastRaceOverIfWinner();
      this.concludeRace(this.buildFinalClassification());
      return;
    }
    if (
      this.firstFinish &&
      this.time.now - this.firstFinish.at >= RACE_FINISH_GRACE_MS
    ) {
      this.broadcastRaceOverIfWinner();
      this.concludeRace(this.buildFinalClassification());
    }
  }

  /** El ganador (primer `rfin`) difunde `race-over` UNA vez. */
  private broadcastRaceOverIfWinner(): void {
    if (this.raceOverSent || this.firstFinish?.peerId !== this.myPeerId) {
      return;
    }
    this.raceOverSent = true;
    this.netClient?.sendRaceOver({ standings: this.buildFinalClassification() });
  }

  /**
   * Clasificación final local con `finalClassification` (determinista):
   * terminados con SU `rfin` (totalMs ASC) → en carrera por progreso →
   * desconectados al final. Las mismas entradas producen el mismo orden en
   * todos los clientes.
   */
  private buildFinalClassification(): RaceFinalStanding[] {
    const cars: FinalCar[] = this.rosterPlayers.map((player) => {
      const peerId = player.peerId;
      const progress = this.lastKnownProgress(peerId);
      const finish = this.finishedPeers.get(peerId);
      if (finish) {
        return { peerId, ...progress, status: 'finished' as const, totalMs: finish.totalMs };
      }
      if (this.disconnectedPeers.has(peerId)) {
        return { peerId, ...progress, status: 'disconnected' as const };
      }
      return { peerId, ...progress, status: 'running' as const };
    });
    return finalClassification(cars, this.path.totalLength);
  }

  /** Último (lap, s) conocido de un auto: propio del tracker, remoto del stream. */
  private lastKnownProgress(peerId: string): { lap: number; s: number } {
    if (peerId === this.myPeerId) {
      return { lap: this.lapTracker.lapsCompleted, s: this.lastProjection.s };
    }
    return this.remoteProgress.get(peerId) ?? { lap: 0, s: 0 };
  }

  /**
   * Terminaron MIS 3 vueltas (evento del LapTracker en multi): difunde el
   * `rfin` propio UNA vez con los tiempos exactos, registra la condición de
   * ganador (si mi `rfin` es el primero, YO soy el ganador y cerraré la
   * carrera) y pasa a espectador: sin input, cartel de fin y cámara que
   * sigue al líder (gobierna `updateLiveRanking`).
   */
  private handleSelfRaceFinished(event: {
    totalMs: number;
    bestLapMs: number;
  }): void {
    if (this.selfFinished) {
      return;
    }
    this.selfFinished = true;
    this.finishedPeers.set(this.myPeerId, {
      totalMs: event.totalMs,
      bestLapMs: event.bestLapMs,
    });
    if (!this.firstFinish) {
      this.firstFinish = { peerId: this.myPeerId, at: this.time.now };
    }
    this.netClient?.sendRaceFinish(
      roundRaceFinishPayload({ totalMs: event.totalMs, bestLapMs: event.bestLapMs }),
    );
    this.inputSystem.detach();
    // V4 — confeti de la meta final propia + corte del dron (dejo de
    // conducir: paso a espectador, el motor del auto propio se apaga).
    this.explodeConfetti();
    this.bus.emit('game-aborted', undefined);
    this.showFinishBanner(SPECTATOR_SUBTITLE);
    // V3 (issue #9) — "terminó la carrera" es puerta del chat de espectador:
    // quien cruzó la bandera lee y escribe en el chat de sala mientras los
    // demás corren (la gate pura `isRaceSpectatorChatVisible` es la misma
    // decisión 2A del issue #2, extendida al circuito).
    this.createSpectatorChatButton();
  }

  /**
   * Botón CHAT del espectador de carrera (V3): existe SÓLO tras el `rfin`
   * propio en multi — por construcción un conductor nunca lo ve (el método
   * sólo corre desde el evento de fin). Mismo estilo/ritmo que el botón del
   * overlay de espectador de GameScene (#2), anclado bajo el subtítulo del
   * cartel de fin. Vive en `hudWidgets`: el SHUTDOWN lo destruye.
   */
  private createSpectatorChatButton(): void {
    if (!isRaceSpectatorChatVisible(this.selfFinished, this.isMultiRace())) {
      return;
    }
    this.spectatorChatButton = new MenuButton(this, {
      x: this.scale.width / 2,
      y:
        this.scale.height / 2 -
        FINISH_LABEL_OFFSET_Y +
        SPECTATOR_SUBTITLE_OFFSET_Y +
        SPECTATOR_CHAT_BUTTON_GAP_PX,
      width: SPECTATOR_OVERLAY.chatButtonWidth,
      height: SPECTATOR_OVERLAY.chatButtonHeight,
      label: 'CHAT',
      tint: SPECTATOR_CHAT_TINT,
      fontSize: SPECTATOR_OVERLAY.chatButtonFontSize,
      bus: this.sessionBus(),
      onPress: () => this.openSpectatorChat(),
    });
    this.spectatorChatButton.container.setScrollFactor(0);
    this.hud(this.spectatorChatButton.container);
    this.hudWidgets.push(this.spectatorChatButton);
  }

  /**
   * V3 — abre el overlay de chat ENCIMA de la carrera (patrón de GameScene:
   * launch sin pausar; la carrera sigue sin el espectador). Tab SALA sobre
   * el hilo `room` de la sesión con envío por el NetClient heredado. Sin
   * transporte (degradación defensiva) no hay nada que abrir.
   */
  private openSpectatorChat(): void {
    if (!this.netClient) {
      return;
    }
    if (!this.scene.get(ChatScene.KEY)) {
      this.scene.add(ChatScene.KEY, ChatScene, false);
    }
    this.scene.launch(ChatScene.KEY, {
      thread: ROOM_THREAD_ID,
      tab: 'room',
      sendChat: (text: string) => this.netClient?.sendChat(text),
    });
  }

  /** Cartel de bandera a cuadros (+ subtítulo de espectador en multi). */
  private showFinishBanner(subtitle?: string): void {
    const finishLabel = this.hud(
      this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2 - FINISH_LABEL_OFFSET_Y,
          FINISH_LABEL,
          {
            fontFamily: 'monospace',
            fontSize: `${FINISH_LABEL_FONT_SIZE}px`,
            color: '#f7c531',
          },
        )
        .setOrigin(0.5)
        .setStroke('#0c0c14', 10)
        .setDepth(60)
        .setScrollFactor(0),
    );

    this.tweens.add({
      targets: finishLabel,
      alpha: 0.4,
      delay: 600,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    if (subtitle) {
      this.hud(
        this.add
          .text(
            this.scale.width / 2,
            this.scale.height / 2 - FINISH_LABEL_OFFSET_Y + SPECTATOR_SUBTITLE_OFFSET_Y,
            subtitle,
            {
              fontFamily: 'monospace',
              fontSize: `${SPECTATOR_SUBTITLE_FONT_SIZE}px`,
              color: '#c8ccd4',
            },
          )
          .setOrigin(0.5)
          .setStroke('#0c0c14', 6)
          .setDepth(60)
          .setScrollFactor(0),
      );
    }
  }

  /** Conclusión de la carrera multi: transición a resultados (rama multi). */
  private concludeRace(standings: readonly RaceFinalStanding[]): void {
    if (this.raceConcluded) {
      return;
    }
    this.raceConcluded = true;
    this.finished = true;
    this.inputSystem.detach();
    // V4 — cierre de la carrera: aunque YO no haya terminado, dejo de
    // conducir → el dron se apaga (no-op si ya estaba apagado).
    this.bus.emit('game-aborted', undefined);
    this.time.delayedCall(GAMEOVER_TRANSITION_MS, () => {
      this.scene.start(
        GameOverScene.KEY,
        raceMultiResultsPayload(
          this.trackDef.id,
          standings,
          this.myPeerId,
          this.rosterPlayers,
          // V4 — vuelta rápida de la carrera: el mejor `bestLapMs` de los
          // `rfin` (elección determinista en `fastestRaceLap`).
          fastestRaceLap(
            [...this.finishedPeers].map(([peerId, finish]) => ({
              peerId,
              bestLapMs: finish.bestLapMs,
            })),
          ),
        ),
      );
    });
  }

  /** Burst one-shot de confeti sobre el auto (meta final, V4). */
  private explodeConfetti(): void {
    this.confettiEmitter.explode(
      RACE_CONFETTI.burstCount,
      this.carState.x,
      this.carState.y,
    );
  }

  /**
   * Issue #27 — telemetría (fire-and-forget, sin PII): una vuelta válida del
   * JUGADOR LOCAL en RaceScene (GRAN PREMIO vs CPU y CARRERA multijugador —
   * ambos pasan por esta escena). `pista` es el TrackId de ESTA escena
   * (init data parseado por `parseRaceSceneInit`, con degradación defensiva
   * a la pista default si llegara basura). OJO: `this.lapTracker` es SÓLO el
   * del jugador local — cada rival/multi remoto tiene su PROPIO LapTracker
   * (ver runtimes en `setupVsCpu`/`setupMultiRace`) y esos NO cablean
   * `onLapCompleted`: no hay evento por rival, ni lo va a haber.
   * `trackEvent` nunca lanza: no hay try/catch acá (telemetría herida ≠
   * carrera herida).
   */
  private trackLapCompleted(event: LapCompletedEvent): void {
    trackEvent('vuelta_completada', {
      pista: this.sceneInit.trackId,
      duracion_ms: event.lapMs,
    });
  }

  /**
   * V4 — pop "¡VUELTA 2/3!" al completar una vuelta (no la última): mismo
   * lenguaje del countdown (texto gigante centrado en pantalla fija, pop de
   * escala y fade). Se destruye solo al terminar el fade.
   */
  private showLapBanner(lap: number): void {
    const banner = this.hud(
      this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2,
          `¡${formatLapBadge(lap, CIRCUIT.totalLaps)}!`,
          {
            fontFamily: 'monospace',
            fontSize: `${RACE_LAP_BANNER.fontSize}px`,
            color: '#f7c531',
          },
        )
        .setOrigin(0.5)
        .setStroke('#0c0c14', 12)
        .setDepth(60)
        .setScrollFactor(0)
        .setScale(RACE_LAP_BANNER.popScale),
    );

    this.tweens.add({
      targets: banner,
      scale: 1,
      duration: RACE_LAP_BANNER.popMs,
      ease: 'Cubic.Out',
    });
    this.tweens.add({
      targets: banner,
      alpha: 0,
      delay: RACE_LAP_BANNER.holdMs,
      duration: RACE_LAP_BANNER.fadeMs,
      ease: 'Cubic.Out',
      onComplete: () => banner.destroy(),
    });
  }

  /**
   * Pre-hornea la textura del mundo para ESTA pista (una vez por sesión;
   * idempotente como TextureFactory.bake). Capas, de abajo hacia arriba:
   * pasto con franjas de corte → asfalto (polilínea densa gruesa con
   * círculos en los vértices para redondear las uniones) → banda de goma →
   * kerbs en curvas → líneas de borde → meta a cuadros → marcas de sector.
   */
  private ensureTrackTexture(): string {
    const key = TRACK_TEXTURE_PREFIX + this.trackDef.id;
    if (this.textures.exists(key)) {
      this.textures.remove(key);
    }

    const { width: worldW, height: worldH } = this.trackDef.worldSize;
    const palette = this.trackDef.palette;
    const halfW = this.trackDef.widthPx / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const path = this.path;

    // Pasto con franjas de corte alternadas (paleta de la pista).
    g.fillStyle(palette.grass, 1);
    g.fillRect(0, 0, worldW, worldH);
    g.fillStyle(palette.grassAlt, 1);
    for (let y = GRASS_STRIPE_PX, stripe = 1; y < worldH; y += GRASS_STRIPE_PX, stripe += 1) {
      if (stripe % 2 === 1) {
        g.fillRect(0, y, worldW, Math.min(GRASS_STRIPE_PX, worldH - y));
      }
    }

    // Polilínea densa del eje (Vector2 para strokePoints).
    const axis: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < path.pointsCount; i += 1) {
      const point = path.densePointAt(i);
      axis.push(new Phaser.Math.Vector2(point.x, point.y));
    }

    // Cinta de asfalto: trazo grueso cerrado + círculos en los vértices
    // (rellenan las uniones para que la cinta quede continua y suave).
    g.lineStyle(this.trackDef.widthPx, palette.asphalt, 1);
    g.strokePoints(axis, true);
    g.fillStyle(palette.asphalt, 1);
    for (const point of axis) {
      g.fillCircle(point.x, point.y, halfW);
    }

    // Banda de goma ("groove"): el ruedo central apenas más oscuro.
    const grooveWidth = this.trackDef.widthPx * GROOVE_WIDTH_RATIO;
    g.lineStyle(grooveWidth, palette.asphaltAlt, 1);
    g.strokePoints(axis, true);
    g.fillStyle(palette.asphaltAlt, 1);
    for (const point of axis) {
      g.fillCircle(point.x, point.y, grooveWidth / 2);
    }

    // Líneas blancas del borde: polilíneas offset ±(halfW − borde/2).
    for (const side of [-1, 1]) {
      const edge: Phaser.Math.Vector2[] = axis.map((point, i) => {
        const angle = path.densePointAt(i).angle;
        const normal = angle + Math.PI / 2;
        const offset = side * (halfW - EDGE_LINE_WIDTH_PX / 2);
        return new Phaser.Math.Vector2(
          point.x + Math.cos(normal) * offset,
          point.y + Math.sin(normal) * offset,
        );
      });
      g.lineStyle(EDGE_LINE_WIDTH_PX, EDGE_LINE_COLOR, 1);
      g.strokePoints(edge, true);
    }

    // Kerbs rojo/blanco alternados SOLO en zonas de curvatura alta, a ambos
    // lados del asfalto (bloques de arco de KERB_BLOCK_PX).
    let blockIndex = 0;
    for (let s = 0; s < path.totalLength; s += KERB_BLOCK_PX, blockIndex += 1) {
      const s1 = Math.min(s + KERB_BLOCK_PX, path.totalLength);
      const a = path.sample(s);
      const b = path.sample(s1 >= path.totalLength ? 0 : s1);
      const blockLength = Math.max(s1 - s, 1e-6);
      const curvature = Math.abs(normalizeAngle(b.angle - a.angle)) / blockLength;
      if (curvature < KERB_CURVATURE_THRESHOLD) {
        continue;
      }
      const color = blockIndex % 2 === 0 ? palette.kerb : palette.kerbAlt;
      g.fillStyle(color, 1);
      for (const side of [-1, 1]) {
        const inner = side * halfW;
        const outer = side * (halfW + KERB_EXTRA_WIDTH_PX);
        g.fillPoints([
          this.offsetPoint(a, inner),
          this.offsetPoint(b, inner),
          this.offsetPoint(b, outer),
          this.offsetPoint(a, outer),
        ], true);
      }
    }

    // Meta a cuadros en s=0: 2 filas × N columnas perpendiculares al eje.
    const start = path.sample(0);
    const square = this.trackDef.widthPx / START_LINE_SQUARES;
    for (let row = 0; row < START_LINE_ROWS; row += 1) {
      for (let col = 0; col < START_LINE_SQUARES; col += 1) {
        const lateral = -halfW + col * square;
        const along = (row - START_LINE_ROWS / 2) * square;
        const corner = this.offsetPoint(start, lateral, along);
        g.fillStyle((row + col) % 2 === 0 ? EDGE_LINE_COLOR : 0x1a1a20, 1);
        g.fillPoints([
          corner,
          this.offsetPoint(start, lateral + square, along),
          this.offsetPoint(start, lateral + square, along + square),
          this.offsetPoint(start, lateral, along + square),
        ], true);
      }
    }

    // Marcas de sector sutiles (el sector 0 arranca en la meta: ahí ya hay
    // línea a cuadros).
    for (const window of path.sectorWindows) {
      if (window.startS === 0) {
        continue;
      }
      const mark = path.sample(window.startS);
      g.fillStyle(EDGE_LINE_COLOR, SECTOR_MARK_ALPHA);
      g.fillPoints([
        this.offsetPoint(mark, -halfW, 0),
        this.offsetPoint(mark, -halfW, SECTOR_MARK_WIDTH_PX),
        this.offsetPoint(mark, halfW, SECTOR_MARK_WIDTH_PX),
        this.offsetPoint(mark, halfW, 0),
      ], true);
    }

    g.generateTexture(key, worldW, worldH);
    g.destroy();
    return key;
  }

  /**
   * Punto del mundo a partir de una muestra del eje: desplazado `lateral`
   * px sobre la normal (perpendicular al eje) y `along` px sobre la tangente
   * (dirección de marcha). Único lugar donde se hace esa trigonometría.
   */
  private offsetPoint(
    sample: { x: number; y: number; angle: number },
    lateral: number,
    along = 0,
  ): Phaser.Math.Vector2 {
    const normal = sample.angle + Math.PI / 2;
    return new Phaser.Math.Vector2(
      sample.x + Math.cos(normal) * lateral + Math.cos(sample.angle) * along,
      sample.y + Math.sin(normal) * lateral + Math.sin(sample.angle) * along,
    );
  }

  /* ---------------------------------------------------------------- */
  /* HUD, countdown y pausa                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Registra un objeto de HUD: la cámara del MUNDO (`cameras.main`) no debe
   * renderizarlo — el HUD vive SOLO en `uiCam` (zoom 1), así que el zoom de
   * #18 no lo escala ni lo manda fuera de pantalla. Devuelve el mismo objeto
   * para usarlo junto a la creación. El camino inverso (el mundo ignorado por
   * `uiCam`) está al cierre de create().
   *
   * Detalle: `ignore()` en un Container marca sólo a sus HIJOS (recursión
   * `isParent`), pero el hit-test de input (`inputCandidate`) consulta
   * `willRender` del PROPIO objeto interactivo — así que el bit del container
   * va a mano, además del `ignore`.
   */
  private hud<T extends Phaser.GameObjects.GameObject>(object: T): T {
    const main = this.cameras.main;
    main.ignore(object);
    object.cameraFilter |= main.id;
    return object;
  }

  /** HUD de pantalla fija (scrollFactor 0): vueltas, tiempos y minimapa. */
  private createHud(width: number, height: number): void {
    this.raceHud = new RaceHud(this, { depth: RACE_HUD.depth });
    this.raceHud.container.setScrollFactor(0);
    this.hud(this.raceHud.container);
    this.hudWidgets.push(this.raceHud);

    this.miniMap = new MiniMap(this, this.path, {
      x: width - RACE.miniMapMargin - RACE.miniMapSize / 2,
      y: RACE.miniMapMargin + RACE.miniMapSize / 2,
      depth: RACE_HUD.depth,
      // V3 (#14) — el punto PROPIO se destaca donde hay rivales (vs CPU y
      // multi): más grande y con halo. La práctica conserva SU look clásico
      // de un solo punto (el destacado es opt-in por init del widget).
      highlightId: this.isVsCpu() || this.isMultiRace() ? PLAYER_PEER_ID : undefined,
    });
    this.miniMap.container.setScrollFactor(0);
    this.hud(this.miniMap.container);
    this.hudWidgets.push(this.miniMap);

    // Botón de mute abajo al centro (misma posición que GameScene; el hueco
    // entre los clusters táctiles sigue libre).
    const bus = this.sessionBus();
    const muteButton = new MuteButton(this, {
      x: width / 2,
      y: height - TOUCH_HUD.marginBottom - TOUCH_HUD.buttonSize / 2,
      bus,
      initiallyMuted: getAudioEngine(this.registry).isMuted,
      depth: MUTE_BUTTON.gameDepth,
    });
    muteButton.container.setScrollFactor(0);
    this.hud(muteButton.container);
    this.hudWidgets.push(muteButton);
  }

  /**
   * Controles de pausa (practice sí pausa): botón bajo el minimapa + tecla
   * P + auto-pausa por blur. La congelación REAL la hace `scene.pause()`
   * desde `pauseGame()`; el overlay (PauseScene) se lanza apuntando a esta
   * escena.
   */
  private createPauseControls(): void {
    const pauseButton = new MenuButton(this, {
      x: RACE.pauseX,
      y: RACE.pauseY,
      width: RACE_HUD.pauseButtonSize,
      height: RACE_HUD.pauseButtonSize,
      label: 'II',
      tint: 0x525868,
      fontSize: RACE_HUD.pauseButtonFontSize,
      depth: MUTE_BUTTON.gameDepth,
      bus: this.sessionBus(),
      onPress: () => this.pauseGame(),
    });
    pauseButton.container.setScrollFactor(0);
    this.hud(pauseButton.container);
    this.hudWidgets.push(pauseButton);

    this.pauseKey = this.input.keyboard?.addKey('P') ?? null;
  }

  /** Bus de sesión (inyectado en Boot): sólo `ui-click`/`mute` acá. */
  private sessionBus(): EventBus<GameEvents> {
    return getSessionEventBus(this.registry);
  }

  /** Texto gigante del countdown (por encima de todo, en pantalla fija). */
  private createCountdownText(width: number, height: number): void {
    this.countdownText = this.hud(
      this.add
        .text(width / 2, height / 2, '3', {
          fontFamily: 'monospace',
          fontSize: `${COUNTDOWN.fontSize}px`,
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 14)
        .setDepth(60)
        .setScrollFactor(0),
    );
  }

  /** Repinta el label del countdown con el pop de escala del cambio. */
  private renderCountdownLabel(label: CountdownLabel): void {
    this.tweens.killTweensOf(this.countdownText);
    this.countdownText
      .setText(label)
      .setColor(label === 'GO!' ? '#5dff8a' : '#f2f2f2')
      .setAlpha(1)
      .setScale(1.45);
    this.tweens.add({
      targets: this.countdownText,
      scale: 1,
      duration: 240,
      ease: 'Cubic.Out',
    });
  }

  /** Un paso del countdown (mismo gate que GameScene: nada más corre). */
  private updateCountdown(dt: number): void {
    const previous = this.countdown.label;
    this.countdown.update(dt);
    const label = this.countdown.label;
    if (label === previous) {
      return;
    }
    if (label === null) {
      this.finishCountdown();
      return;
    }
    this.renderCountdownLabel(label);
  }

  /** Fin de la cuenta: el GO! se desvanece y el mundo arranca. */
  private finishCountdown(): void {
    // V3 (#14) — SFX de largada del GRAN PREMIO (sólo vs CPU: la práctica y
    // el multi no cambian su arranque). El `game-start` de siempre va para
    // TODOS los modos: arranca el dron del motor, no suena.
    if (this.isVsCpu()) {
      this.bus.emit('race-go', undefined);
    }
    // V4 — el dron del motor arranca con el GO! (mismo evento que la
    // BATALLA; el AudioManager mantiene su perfil móvil de #4 intacto).
    this.bus.emit('game-start', undefined);
    this.tweens.killTweensOf(this.countdownText);
    this.tweens.add({
      targets: this.countdownText,
      alpha: 0,
      scale: 1.3,
      duration: 260,
      ease: 'Cubic.Out',
      onComplete: () => this.countdownText.setVisible(false),
    });
  }

  /**
   * Pausa la carrera (botón II, tecla P o pérdida de foco). Idempotente vía
   * PauseSystem; congela ESTA escena con `scene.pause()` y lanza el overlay
   * apuntándolo a RaceScene.
   */
  private readonly pauseGame = (): void => {
    if (this.finished || this.isMultiRace()) {
      return;
    }
    if (!this.pauseSystem.pause()) {
      return;
    }
    // Sin listeners no hay botones "pegados" si la escena se congela a
    // mitad de un toque/tecla (el attach vuelve en el RESUME).
    this.touch.detach();
    this.keyboard.detach();
    // V4 — el motor no sigue sonando con la carrera congelada (Fase 7).
    this.bus.emit('game-paused', undefined);
    this.scene.launch(PauseScene.KEY, { auto: this.pauseSystem.isAutoPaused, target: RaceScene.KEY });
    this.scene.pause();
  };

  /** RESUME (vuelve de PauseScene): input re-armado y teclas limpias. */
  private readonly handleSceneResume = (): void => {
    this.pauseSystem.resume();
    this.touch.attach();
    this.keyboard.attach();
    this.input.keyboard?.resetKeys();
    // V4 — el dron vuelve con la carrera (el AudioManager re-arranca el
    // motor; el evento `speed` del update lo re-sincroniza en el frame 1).
    this.bus.emit('game-resumed', undefined);
  };

  /* ---------------------------------------------------------------- */
  /* Fin de carrera                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Última vuelta válida completada (evento del LapTracker): congela el
   * mundo (ni física ni input) y tras la pausa de lectura transiciona a la
   * rama de resultados de carrera de GameOverScene.
   */
  private readonly finishRace = (): void => {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.inputSystem.detach();

    // V4 — confeti del cruce de la meta final + corte del dron del motor
    // (sin SFX de crash: cruzar la meta no es un accidente).
    this.explodeConfetti();
    this.bus.emit('game-aborted', undefined);

    this.showFinishBanner();

    this.time.delayedCall(GAMEOVER_TRANSITION_MS, () => {
      // V0 (#14) — vs CPU: resultados con la posición final del jugador
      // (el modo corta con SU bandera a cuadros; el rival clasifica por su
      // tiempo o su último progreso). Práctica: el payload de siempre.
      this.scene.start(
        GameOverScene.KEY,
        this.isVsCpu()
          ? this.buildVsCpuResults()
          : racePracticeResultsPayload(
              this.trackDef.id,
              this.lapTracker.lapsCompleted,
              this.lapTracker.bestLapMs,
              this.lapTracker.totalMs,
            ),
      );
    });
  };
}
