import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import {
  CIRCUIT,
  COUNTDOWN,
  GAMEOVER_TRANSITION_MS,
  MUTE_BUTTON,
  RACE,
  RACE_HUD,
  TOUCH_HUD,
} from '../config/balance';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import {
  circuitInputFromState,
  computeRaceTouchLayout,
  RaceKeyboardSource,
  RACE_TOUCH_ACTIONS,
  type RaceTouchAction,
} from '../race/raceControls';
import { assignGridOrder } from '../race/gridOrder';
import { CircuitPhysics, type CarState } from '../race/circuitPhysics';
import { LapTracker } from '../race/lapTracker';
import {
  parseRaceSceneInit,
  racePracticeResultsPayload,
  type RaceSceneInit,
} from '../race/results';
import { buildTrackPath, getTrackById, TRACKS, type TrackDefinition } from '../race/tracks';
import type { TrackPath } from '../race/trackPath';
import { CountdownSystem, type CountdownLabel } from '../systems/CountdownSystem';
import { PauseSystem } from '../systems/PauseSystem';
import { TouchButton } from '../systems/TouchButton';
import type { PointerEventEmitter } from '../systems/TouchSource';
import { InputSystem, type IInputSource, type IInputState } from '../systems/InputSystem';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { MiniMap } from '../ui/MiniMap';
import { MenuButton } from '../ui/MenuButton';
import { MuteButton } from '../ui/MuteButton';
import { PixelButton, type PixelButtonStyle } from '../ui/PixelButton';
import { RaceHud } from '../ui/RaceHud';
import { GameOverScene } from './GameOverScene';
import { PauseScene } from './PauseScene';

/* ------------------------------------------------------------------ */
/* Constantes visuales del circuito (presentación, no gameplay)         */
/* ------------------------------------------------------------------ */

/** Prefijo de la textura pre-horneada por pista (`race-track-<id>`). */
const TRACK_TEXTURE_PREFIX = 'race-track-';

/**
 * Offset de rotación del sprite: la textura del auto apunta hacia ARRIBA
 * (−Y) mientras el heading de la física es atan2-style (0 = +X).
 */
const CAR_SPRITE_ANGLE_OFFSET = Math.PI / 2;

/** Ancho de las franjas de corte del pasto (px, alternadas con grassAlt). */
const GRASS_STRIPE_PX = 200;

/** Largo de cada bloque de kerb a lo largo del arco (px). */
const KERB_BLOCK_PX = 64;
/** Cuánto sobresale el kerb más allá del borde del asfalto (px). */
const KERB_EXTRA_WIDTH_PX = 18;
/** Curvatura mínima (1/px) que merece kerbs: radio < ~333 px. */
const KERB_CURVATURE_THRESHOLD = 0.003;

/** Grosor de las líneas blancas del borde del asfalto (px). */
const EDGE_LINE_WIDTH_PX = 4;
/** Color de las líneas del borde (blanco hueso de la paleta kerbAlt-ish). */
const EDGE_LINE_COLOR = 0xe8e6e0;

/** Banda de goma ("groove") sobre el asfalto, como fracción del ancho. */
const GROOVE_WIDTH_RATIO = 0.62;

/** Meta a cuadros: filas × columnas de cuadraditos sobre el ancho. */
const START_LINE_ROWS = 2;
const START_LINE_SQUARES = 8;

/** Marcas de sector: línea fina translúcida cruzando el asfalto. */
const SECTOR_MARK_ALPHA = 0.28;
const SECTOR_MARK_WIDTH_PX = 6;

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

/** Color del tinte del punto del jugador en el minimapa (rojo F1 propio). */
const PLAYER_MINIMAP_TINT = 0xd63c3c;

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
 * Fuente táctil de la carrera (implementa `IInputSource`): reutiliza la
 * lógica de `TouchButton` (tracking multi-touch por pointerId, hit-test
 * manual que no roba eventos al juego) y la presentación `PixelButton`, con
 * el layout propio del circuito (◀ ▶ + FRENO) de `raceControls`. Es la
 * hermana chica de `TouchSource` (GameScene) sin GAS/TURBO/DRS: el circuito
 * es auto-acelerado.
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
      brake: { label: 'FRENO', tint: 0xd63c3c },
    };

    this.buttons = RACE_TOUCH_ACTIONS.map((action) => {
      const rect = layout[action];
      const visual = new PixelButton(scene, rect, styles[action]);
      // La cámara de la escena scrollea: el HUD táctil vive en pantalla.
      visual.container.setScrollFactor(0);
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

  /** Porción de `IInputState` que llena esta fuente (giro + freno). */
  getState(): IInputState {
    const pressed = (action: RaceTouchAction): boolean =>
      this.buttons.find((button) => button.action === action)?.isPressed ?? false;
    return {
      left: pressed('left'),
      right: pressed('right'),
      throttle: false,
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
 * Una persona corre sola una de las 5 pistas, 3 vueltas, con countdown,
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
 * - CÁMARA: única y fija en zoom `RACE.cameraZoom`, norte arriba, sigue al
 *   auto con lerp y queda clampada al mundo; todo el HUD usa
 *   `setScrollFactor(0)`.
 * - INPUT: mismo stack que el modo BATALLA (`IInputState` fusionado por
 *   `InputSystem`) con fuentes propias de carrera (teclado auto-acelerado y
 *   ◀ ▶ + FRENO táctil); el puente a la física es el puro
 *   `circuitInputFromState`.
 * - PAUSA: igual que GameScene (PauseSystem + PauseScene encima, tecla P,
 *   auto-pausa por blur) — PauseScene ahora recibe la escena objetivo por
 *   init data (default Game: regresión cero en el modo BATALLA).
 * - FIN: al completar `CIRCUIT.totalLaps` vueltas válidas (LapTracker) el
 *   mundo se congela y la escena transiciona a la rama de resultados de
 *   carrera de GameOverScene con `racePracticeResultsPayload`.
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
    this.trackDef = getTrackById(this.sceneInit.trackId) ?? TRACKS[0];
    this.path = buildTrackPath(this.trackDef);
    this.carPhysics = new CircuitPhysics(this.path, this.trackDef.widthPx);
    this.lapTracker = new LapTracker(this.path);

    // Parrilla: un solo corredor, siempre en la pole (detrás de la meta).
    const slot = assignGridOrder([{ peerId: 'player' }], PRACTICE_GRID_SEED, this.path)[0];
    this.carState = {
      x: slot.x ?? this.path.sample(0).x,
      y: slot.y ?? this.path.sample(0).y,
      heading: slot.angle ?? 0,
      speed: 0,
    };

    // Mundo estático: la pista pre-horneada en UNA imagen + el auto encima.
    this.add.image(0, 0, this.ensureTrackTexture()).setOrigin(0, 0).setDepth(0);
    this.carSprite = this.add
      .sprite(this.carState.x, this.carState.y, TEXTURE_KEYS.playerCar)
      .setDepth(10);
    this.syncCarSprite();

    // Cámara: norte arriba, zoom fijo, sigue con lerp, clampada al mundo.
    this.cameras.main.setBounds(
      0,
      0,
      this.trackDef.worldSize.width,
      this.trackDef.worldSize.height,
    );
    this.cameras.main.setZoom(RACE.cameraZoom);
    this.cameras.main.startFollow(this.carSprite, false, RACE.cameraLerp, RACE.cameraLerp);

    // Evento de fin: LapTracker avisa al completar la última vuelta válida.
    this.lapTracker.onRaceFinished = () => this.finishRace();

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
    this.createPauseControls();

    // HUD con el estado inicial (la cuenta aún no arrancó los relojes).
    this.raceHud.setLap(this.lapTracker.currentLap, CIRCUIT.totalLaps);
    this.raceHud.setTimings(this.lapTracker.currentLapMs, this.lapTracker.totalMs);

    // Pausa automática por pérdida de foco (HIDDEN/BLUR), como GameScene.
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.pauseGame);
    this.game.events.on(Phaser.Core.Events.BLUR, this.pauseGame);
    this.events.on(Phaser.Scenes.Events.RESUME, this.handleSceneResume);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.detach();
      this.touch.destroy();
      for (const widget of this.hudWidgets) {
        widget.destroy();
      }
      this.hudWidgets = [];
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.pauseGame);
      this.game.events.off(Phaser.Core.Events.BLUR, this.pauseGame);
      this.events.off(Phaser.Scenes.Events.RESUME, this.handleSceneResume);
    });
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    // Carrera terminada: el mundo queda congelado y solo corre el
    // delayedCall que dispara la transición a los resultados.
    if (this.finished) {
      return;
    }

    // Tecla P: pausa con JustDown (anti auto-repeat), igual que GameScene.
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
    const input = circuitInputFromState(this.inputSystem.getState());
    this.carPhysics.step(this.carState, dt, input);

    // Vueltas: la coordenada de arco del frame alimenta al LapTracker.
    const projection = this.path.project(this.carState.x, this.carState.y);
    this.lapTracker.update(projection.s, delta);

    // Presentación: sprite del auto, minimapa y HUD de vuelta/tiempos.
    this.syncCarSprite();
    this.miniMap.updateCars([
      { id: 'player', x: this.carState.x, y: this.carState.y, tint: PLAYER_MINIMAP_TINT },
    ]);
    this.raceHud.setLap(this.lapTracker.currentLap, CIRCUIT.totalLaps);
    this.raceHud.setTimings(this.lapTracker.currentLapMs, this.lapTracker.totalMs);
  }

  /* ---------------------------------------------------------------- */
  /* Presentación                                                      */
  /* ---------------------------------------------------------------- */

  /** Sincroniza el sprite con el estado de la física (posición + heading). */
  private syncCarSprite(): void {
    this.carSprite.setPosition(this.carState.x, this.carState.y);
    this.carSprite.rotation = this.carState.heading + CAR_SPRITE_ANGLE_OFFSET;
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

  /** HUD de pantalla fija (scrollFactor 0): vueltas, tiempos y minimapa. */
  private createHud(width: number, height: number): void {
    this.raceHud = new RaceHud(this, { depth: RACE_HUD.depth });
    this.raceHud.container.setScrollFactor(0);
    this.hudWidgets.push(this.raceHud);

    this.miniMap = new MiniMap(this, this.path, {
      x: width - RACE.miniMapMargin - RACE.miniMapSize / 2,
      y: RACE.miniMapMargin + RACE.miniMapSize / 2,
      depth: RACE_HUD.depth,
    });
    this.miniMap.container.setScrollFactor(0);
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
    this.hudWidgets.push(pauseButton);

    this.pauseKey = this.input.keyboard?.addKey('P') ?? null;
  }

  /** Bus de sesión (inyectado en Boot): sólo `ui-click`/`mute` acá. */
  private sessionBus(): EventBus<GameEvents> {
    return getSessionEventBus(this.registry);
  }

  /** Texto gigante del countdown (por encima de todo, en pantalla fija). */
  private createCountdownText(width: number, height: number): void {
    this.countdownText = this.add
      .text(width / 2, height / 2, '3', {
        fontFamily: 'monospace',
        fontSize: `${COUNTDOWN.fontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 14)
      .setDepth(60)
      .setScrollFactor(0);
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
    if (this.finished) {
      return;
    }
    if (!this.pauseSystem.pause()) {
      return;
    }
    // Sin listeners no hay botones "pegados" si la escena se congela a
    // mitad de un toque/tecla (el attach vuelve en el RESUME).
    this.touch.detach();
    this.keyboard.detach();
    this.scene.launch(PauseScene.KEY, { auto: this.pauseSystem.isAutoPaused, target: RaceScene.KEY });
    this.scene.pause();
  };

  /** RESUME (vuelve de PauseScene): input re-armado y teclas limpias. */
  private readonly handleSceneResume = (): void => {
    this.pauseSystem.resume();
    this.touch.attach();
    this.keyboard.attach();
    this.input.keyboard?.resetKeys();
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

    const finishLabel = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - FINISH_LABEL_OFFSET_Y, FINISH_LABEL, {
        fontFamily: 'monospace',
        fontSize: `${FINISH_LABEL_FONT_SIZE}px`,
        color: '#f7c531',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10)
      .setDepth(60)
      .setScrollFactor(0);

    this.tweens.add({
      targets: finishLabel,
      alpha: 0.4,
      delay: 600,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    this.time.delayedCall(GAMEOVER_TRANSITION_MS, () => {
      this.scene.start(
        GameOverScene.KEY,
        racePracticeResultsPayload(
          this.trackDef.id,
          this.lapTracker.lapsCompleted,
          this.lapTracker.bestLapMs,
          this.lapTracker.totalMs,
        ),
      );
    });
  };
}
