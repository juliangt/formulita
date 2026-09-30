import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import {
  BASE_SPEED,
  GAMEOVER_TRANSITION_MS,
  MUTE_BUTTON,
  OIL_SLIP_SECONDS,
  PLAYER_START_Y,
  RACE_HUD,
  TOUCH_HUD,
  TRACK,
  TURBO_MAX,
  TURBO_PICKUP_REFILL,
} from '../config/balance';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import type { ISaveRepository } from '../data/ISaveRepository';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { parseGameOverData } from '../data/types';
import { PlayerCar } from '../entities/PlayerCar';
import { TrackEntity } from '../entities/TrackEntity';
import { DifficultySystem } from '../systems/DifficultySystem';
import { InputSystem } from '../systems/InputSystem';
import { KeyboardSource } from '../systems/KeyboardSource';
import { TouchSource } from '../systems/TouchSource';
import { ScoreSystem } from '../systems/ScoreSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { SpeedSystem, composeEffectiveSpeed } from '../systems/SpeedSystem';
import { TurboSystem } from '../systems/TurboSystem';
import { DrsSystem } from '../systems/DrsSystem';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { EnergyBar } from '../ui/EnergyBar';
import { DrsIndicator } from '../ui/DrsIndicator';
import { ScoreHud } from '../ui/ScoreHud';
import { Speedometer } from '../ui/Speedometer';
import { MuteButton } from '../ui/MuteButton';
import { GameOverScene } from './GameOverScene';

/** Widget del HUD de esta fase: se destruye en el shutdown de la escena. */
type HudWidget = { destroy(): void };

/**
 * GameScene — carrera (Fase 4).
 *
 * - Pista vertical: un `TileSprite` que cubre la pantalla con el tile
 *   procedimental; el scroll YA NO es fijo: lo marca el SpeedSystem compuesto
 *   con turbo y DRS (`composeEffectiveSpeed`). El ritmo de spawn consume
 *   esta misma velocidad.
 * - Controles unificados (Fase 2): `InputSystem` fusiona teclado + táctil en
 *   un único `IInputState`; los tres sistemas consumen flags de ese estado.
 * - Sistemas puros coordinados acá — las escenas solo orquestan:
 *   `SpeedSystem`, `TurboSystem`, `DrsSystem` (Fase 3) + `DifficultySystem`
 *   y `SpawnSystem` (Fase 4): la dificultad sube con la distancia y las
 *   entidades (rivales, monedas, hazards, pickups) nacen fuera de pantalla
 *   desde pools con límite.
 * - Colisiones por Arcade overlap: monedas/pickups → efecto + evento del
 *   bus; rival/resto → explosión, shake y transición a GameOverScene (Fase
 *   5); aceite → derrape no destructivo.
 * - Efectos visuales del turbo (partículas de escape + líneas de velocidad).
 * - HUD de la fase desacoplado por `EventBus` (velocímetro, turbo, DRS,
 *   puntaje y monedas), más el botón de mute (Fase 6) abajo al centro.
 * - Fase 5 — puntaje y persistencia: `ScoreSystem` suma puntos por distancia
 *   (escalados con la velocidad real), bonus por velocidad sostenida y los
 *   puntos de las monedas. Al morir (o al ocultar la pestaña / perder foco)
 *   se guarda el progreso vía `ISaveRepository` (registry, inyección desde
 *   Boot) y la escena transiciona a GameOverScene con el resumen de la
 *   carrera como init data.
 * - Fase 6 — audio: la escena NO conoce el AudioManager. El bus de sesión
 *   (`getSessionEventBus`, resuelto del registry) es el desacoplador: acá se
 *   emiten `game-start`/`speed`/`turbo`/`drs`/`coins`/`pickup`/`game-over` y
 *   el AudioManager conectado en Boot los traduce a SFX y al dron del motor.
 */
export class GameScene extends Phaser.Scene {
  static readonly KEY = 'Game';

  private road!: Phaser.GameObjects.TileSprite;
  private inputSystem!: InputSystem;
  private playerCar!: PlayerCar;

  /* Fase 3 — lógica pura + bus (de sesión desde la Fase 6, ver create()). */
  private bus!: EventBus<GameEvents>;
  private speedSystem!: SpeedSystem;
  private turboSystem!: TurboSystem;
  private drsSystem!: DrsSystem;

  /* Fase 4 — generación procedural + dificultad. */
  private difficulty!: DifficultySystem;
  private spawnSystem!: SpawnSystem;

  /* Estado de la carrera. */
  private currentSpeed = BASE_SPEED;
  private coins = 0;
  private gameOver = false;

  /* Fase 5 — puntaje y persistencia. */
  private scoreSystem!: ScoreSystem;
  private saveRepository!: ISaveRepository;
  /** Récord de puntaje al arrancar la carrera (para el "¡NUEVO RÉCORD!"). */
  private bestScoreAtStart = 0;
  /** Monedas ya persistidas en guardados intermedios (hidden/blur). */
  private bankedCoins = 0;
  /** Último puntaje entero emitido por el bus (evita emitir de más). */
  private lastEmittedScore = -1;

  /* Efectos visuales (turbo Fase 3; recolección/crash Fase 4). */
  private exhaustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private speedLinesEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private collectEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private crashEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  /* HUD de la fase (widgets en ui/, conectados por EventBus). */
  private hudWidgets: HudWidget[] = [];

  constructor() {
    super(GameScene.KEY);
  }

  create(): void {
    const { width, height } = this.scale;

    // Un crash anterior pausó el mundo arcade: el restart reutiliza la escena.
    this.physics.world.resume();

    this.road = this.add.tileSprite(width / 2, height / 2, width, height, TEXTURE_KEYS.roadTile);

    // Estado de la carrera fresco (el restart reusa la instancia de escena).
    this.currentSpeed = BASE_SPEED;
    this.coins = 0;
    this.gameOver = false;

    // Fase 5 — puntaje y persistencia frescos. El repositorio se resuelve
    // del registry (inyectado en Boot; aquí solo se consume la interfaz).
    this.scoreSystem = new ScoreSystem();
    this.saveRepository = getSaveRepository(this.registry);
    this.bestScoreAtStart = this.saveRepository.load().bestScore;
    this.bankedCoins = 0;
    this.lastEmittedScore = -1;

    // Fase 2 — fuentes de entrada fusionadas en un único IInputState.
    // Agregar/quitar fuentes (gamepad, demo IA…) = editar esta lista.
    const touchSource = new TouchSource(this, { width, height });
    this.inputSystem = new InputSystem([KeyboardSource.fromScene(this), touchSource]);
    this.inputSystem.attach();

    // El auto consume el estado fusionado (steer); los sistemas de la Fase 3
    // consumen throttle/brake/turbo/drs del MISMO estado.
    this.playerCar = new PlayerCar(this, width / 2, PLAYER_START_Y, this.inputSystem);

    // Fase 3 — sistemas puros. El DRS consulta la velocidad vía proveedor
    // inyectado (sin acoplarse al SpeedSystem). El bus es el DE SESIÓN
    // (Fase 6, resuelto del registry): mismo canal para HUD, audio y UI;
    // NADIE lo limpia (los widgets se desuscriben en su destroy y el audio
    // vive toda la sesión).
    this.bus = getSessionEventBus(this.registry);
    this.speedSystem = new SpeedSystem();
    this.turboSystem = new TurboSystem();
    this.drsSystem = new DrsSystem(() => this.speedSystem.speed);

    // Fase 4 — dificultad por distancia + generación procedural con pools.
    this.difficulty = new DifficultySystem();
    this.spawnSystem = new SpawnSystem(this, {
      speedProvider: () => this.currentSpeed,
      difficulty: this.difficulty,
    });
    this.registerCollisions();

    this.createTurboEffects();
    this.createCollectEffects();
    this.createHud(width, height);

    // Fase 5 — no perder progreso: guardar también al ocultar la pestaña o
    // al perder foco (Phaser emite HIDDEN/BLUR desde visibilitychange/blur
    // del document). El listener vive en game.events (global): se baja en el
    // shutdown para no duplicar tras un restart.
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.persistProgress);
    this.game.events.on(Phaser.Core.Events.BLUR, this.persistProgress);

    // Notificación de inicio de carrera (consumidores desacoplados del bus).
    this.bus.emit('game-start', undefined);

    // Al apagarse la escena (restart) nada puede quedar colgado: detach de
    // fuentes, destrucción del HUD táctil y de los widgets (cada uno se
    // desuscribe del bus de sesión en su destroy — el bus NO se limpia: es
    // compartido con el audio de la sesión, Fase 6), de los grupos del
    // SpawnSystem y de los listeners globales de guardado.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.detach();
      touchSource.destroy();
      for (const widget of this.hudWidgets) {
        widget.destroy();
      }
      this.hudWidgets = [];
      this.exhaustEmitter.stop();
      this.speedLinesEmitter.stop();
      this.spawnSystem.destroy();
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.persistProgress);
      this.game.events.off(Phaser.Core.Events.BLUR, this.persistProgress);
    });
  }

  /** Overlaps arcade: un handler por familia, efectos según `def.effect`. */
  private registerCollisions(): void {
    this.physics.add.overlap(this.playerCar, this.spawnSystem.coinGroup, this.handleTrackContact);
    this.physics.add.overlap(this.playerCar, this.spawnSystem.pickupGroup, this.handleTrackContact);
    this.physics.add.overlap(this.playerCar, this.spawnSystem.hazardGroup, this.handleTrackContact);
    this.physics.add.overlap(this.playerCar, this.spawnSystem.rivalGroup, this.handleTrackContact);
  }

  /**
   * Contacto jugador ↔ entidad (data-driven por `CollisionEffect`):
   * - collect-coin/turbo/drs → efecto + reciclaje al pool.
   * - slip (aceite) → derrape breve; la mancha permanece en la pista.
   * - crash (rival/resto) → explosión + shake + game-over (escena congelada).
   */
  private handleTrackContact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    _playerObj,
    entityObj,
  ) => {
    if (this.gameOver) {
      return;
    }
    const entity = entityObj as TrackEntity;
    if (!entity.active || !entity.isSpawned) {
      return;
    }

    switch (entity.def.effect) {
      case 'collect-coin':
        // Fase 5 — las monedas suman monedas (economía aparte) y puntos
        // planos al ScoreSystem (COIN_SCORE), separados de la distancia.
        this.coins += entity.def.coins;
        this.scoreSystem.addPoints(entity.def.points);
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
        this.bus.emit('coins', this.coins);
        this.emitScore();
        break;
      case 'collect-turbo':
        this.turboSystem.refill(TURBO_PICKUP_REFILL);
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
        // Fase 6 — el AudioManager conectado al bus suena el pickup.
        this.bus.emit('pickup', 'turbo');
        break;
      case 'collect-drs':
        this.drsSystem.resetCooldown();
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
        this.bus.emit('pickup', 'drs');
        break;
      case 'slip':
        // La mancha sigue en la pista: overlapando de nuevo refresca el derrape.
        this.playerCar.slip(OIL_SLIP_SECONDS);
        break;
      case 'crash':
        this.crash();
        break;
    }
  };

  /** Destello de recolección (monedas y pickups). */
  private burstCollect(entity: TrackEntity): void {
    this.collectEmitter.explode(10, entity.x, entity.y);
  }

  /**
   * Choque destructivo (rival o resto): explosión + shake + guardado
   * inmediato del progreso (Fase 5) + transición a GameOverScene con el
   * resumen de la carrera como init data (tras una pequeña pausa para que
   * se lea la explosión y el shake).
   */
  private crash(): void {
    if (this.gameOver) {
      return;
    }
    this.gameOver = true;
    this.spawnSystem.setEnabled(false);

    this.crashEmitter.explode(60, this.playerCar.x, this.playerCar.y);
    this.playerCar.setActive(false).setVisible(false);
    (this.playerCar.body as Phaser.Physics.Arcade.Body).enable = false;

    this.physics.world.pause();
    this.cameras.main.shake(420, 0.014);
    this.exhaustEmitter.stop();
    this.speedLinesEmitter.stop();

    // Resumen de la carrera (puntaje y distancia salen del ScoreSystem).
    const summary = {
      score: this.scoreSystem.score,
      distance: this.scoreSystem.distance,
      coins: this.coins,
    };
    // El récord se compara contra el best de ANTES de esta carrera (los
    // guardados intermedios de hidden/blur no lo alteran).
    const isNewBest = summary.score > this.bestScoreAtStart;
    this.persistProgress();

    this.bus.emit('game-over', summary);

    // Pausa para leer el crash y cambio de escena con el payload tipado.
    this.time.delayedCall(GAMEOVER_TRANSITION_MS, () => {
      this.scene.start(GameOverScene.KEY, parseGameOverData({ ...summary, isNewBest }));
    });
  }

  /**
   * Guarda el progreso en el repositorio (guardado inmediato al morir y en
   * hidden/blur). Idempotente por carrera: solo "banca" las monedas aún no
   * guardadas — hidden/blur puede dispararse varias veces — y los récords
   * toman el máximo (el puntaje de una carrera nunca decrece, así que
   * bancarlos anticipadamente no cambia el resultado final).
   */
  private readonly persistProgress = (): void => {
    const current = this.saveRepository.load();
    const unbankedCoins = Math.max(0, this.coins - this.bankedCoins);
    this.saveRepository.save({
      totalCoins: current.totalCoins + unbankedCoins,
      bestScore: Math.max(current.bestScore, this.scoreSystem.score),
      bestDistance: Math.max(current.bestDistance, this.scoreSystem.distance),
    });
    this.bankedCoins = this.coins;
  };

  /** Emite el puntaje por el bus solo cuando cambia el entero mostrado. */
  private emitScore(): void {
    const value = this.scoreSystem.score;
    if (value !== this.lastEmittedScore) {
      this.lastEmittedScore = value;
      this.bus.emit('score', value);
    }
  }

  /** Partículas de escape + líneas de velocidad (efecto del turbo). */
  private createTurboEffects(): void {
    // Llamas de escape en la cola del auto (siguen al sprite, tint cálido).
    this.exhaustEmitter = this.add
      .particles(0, 0, TEXTURE_KEYS.particle, {
        follow: this.playerCar,
        followOffset: { x: 0, y: 44 },
        lifespan: 300,
        speed: { min: 220, max: 380 },
        angle: { min: 160, max: 200 },
        scale: { start: 1.8, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffd23c, 0xff9a2c, 0xff5a2c],
        quantity: 2,
        frequency: 26,
        maxParticles: 60,
        emitting: false,
      })
      .setDepth(9);

    // Líneas de velocidad: píxeles estirados que cruzan la pantalla más
    // rápido que el scroll de la pista, sobre el asfalto y bajo el auto.
    this.speedLinesEmitter = this.add
      .particles(0, 0, TEXTURE_KEYS.particle, {
        x: { min: TRACK.roadLeft, max: TRACK.roadRight },
        y: -16,
        lifespan: 600,
        speedY: { min: 1000, max: 1500 },
        scaleX: { start: 0.8, end: 0.4 },
        scaleY: { start: 8, end: 1.5 },
        alpha: { start: 0.5, end: 0 },
        tint: 0xe8ecf4,
        quantity: 1,
        frequency: 55,
        maxParticles: 36,
        emitting: false,
      })
      .setDepth(2);
  }

  /** Destellos de recolección y explosión de crash (Fase 4). */
  private createCollectEffects(): void {
    this.collectEmitter = this.add
      .particles(0, 0, TEXTURE_KEYS.particle, {
        lifespan: 380,
        speed: { min: 60, max: 280 },
        scale: { start: 1.6, end: 0 },
        alpha: { start: 0.95, end: 0 },
        tint: [0xf7c531, 0xfff3b0, 0x7fd4ff],
        emitting: false,
      })
      .setDepth(11);

    this.crashEmitter = this.add
      .particles(0, 0, TEXTURE_KEYS.particle, {
        lifespan: 700,
        speed: { min: 80, max: 420 },
        scale: { start: 2.4, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffd23c, 0xff5a2c, 0xd63c3c, 0x4a4a52],
        emitting: false,
      })
      .setDepth(12);
  }

  /** HUD de la Fase 3: velocímetro + barra de turbo + chip DRS (+ mute F6). */
  private createHud(width: number, height: number): void {
    const centerX = width / 2;
    const { depth } = RACE_HUD;

    this.hudWidgets.push(new Speedometer(this, this.bus, {
      x: centerX,
      y: RACE_HUD.speedometerY,
      depth,
    }));

    const turboBar = new EnergyBar(this, {
      x: centerX,
      y: RACE_HUD.turboBarY,
      width: RACE_HUD.turboBarWidth,
      height: RACE_HUD.turboBarHeight,
      label: 'TURBO',
      colorStops: [
        { minRatio: 0, color: 0xd63c3c },
        { minRatio: 0.25, color: 0xd8a72c },
        { minRatio: 0.6, color: 0x3c9e52 },
      ],
      depth,
    });
    this.hudWidgets.push(turboBar);
    // Conexión por EventBus (sin referencia directa al TurboSystem).
    this.hudWidgets.push({
      destroy: this.bus.on('turbo', ({ level }) => {
        turboBar.setRatio(level / TURBO_MAX);
      }),
    });

    this.hudWidgets.push(new DrsIndicator(this, this.bus, {
      x: centerX,
      y: RACE_HUD.drsChipY,
      width: RACE_HUD.drsChipWidth,
      height: RACE_HUD.drsChipHeight,
      depth,
    }));

    // Fase 5 — puntaje y monedas en las esquinas del borde superior.
    this.hudWidgets.push(new ScoreHud(this, this.bus, {
      scoreX: RACE_HUD.scoreX,
      scoreY: RACE_HUD.scoreY,
      coinsX: RACE_HUD.coinsX,
      coinsY: RACE_HUD.coinsY,
      fontSize: RACE_HUD.scoreFontSize,
      depth,
    }));

    // Fase 6 — botón de mute abajo al centro (en el hueco entre los dos
    // clusters táctiles, mismo eje Y que sus filas). La UI solo emite
    // `mute`/`ui-click` por el bus; el estado inicial sale del motor
    // resuelto del registry.
    this.hudWidgets.push(new MuteButton(this, {
      x: centerX,
      y: height - TOUCH_HUD.marginBottom - TOUCH_HUD.buttonSize / 2,
      bus: this.bus,
      initiallyMuted: getAudioEngine(this.registry).isMuted,
      depth: MUTE_BUTTON.gameDepth,
    }));
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    // Escena terminada: solo queda la cola del shake y el delayedCall que
    // dispara la transición al Game Over (crash()).
    if (this.gameOver) {
      return;
    }

    // ÚNICA lectura de input por frame: el estado fusionado alimenta a los
    // tres sistemas (cada uno consume su porción de flags).
    const input = this.inputSystem.getState();
    this.speedSystem.update(dt, input);
    this.turboSystem.update(dt, input.turbo);
    this.drsSystem.update(dt, input.drs);

    // Velocidad final = SpeedSystem × turbo (si activo) × DRS (si activo),
    // con clamps defensivos: nunca NaN ni aceleraciones infinitas.
    const speed = composeEffectiveSpeed(
      this.speedSystem.speed,
      this.turboSystem.speedMultiplier,
      this.drsSystem.speedMultiplier,
    );
    this.currentSpeed = speed;

    // Fase 4 — la distancia alimenta la dificultad y el scheduler spawnea
    // oleadas (líneas de monedas, slaloms, obstáculos) fuera de pantalla.
    this.difficulty.update(dt, speed);
    this.spawnSystem.update(dt);

    // Fase 5 — puntaje: distancia (escalada con la velocidad real) + bonus
    // de velocidad sostenida. dt inyectado; la emisión al HUD va por el bus.
    this.scoreSystem.update(dt, speed);
    this.emitScore();

    // Scroll = velocidad compuesta (px/s). tilePositionY decrece → la textura
    // avanza hacia abajo, hacia el auto: sensación de avance. Wrap con el alto
    // del tile para no acumular floats sin límite.
    const scroll = speed * dt;
    this.road.tilePositionY = Phaser.Math.Wrap(this.road.tilePositionY - scroll, 0, TRACK.tileHeight);

    // Efecto visual del turbo: llamas + líneas de velocidad solo mientras
    // el turbo empuja.
    const turboActive = this.turboSystem.isActive;
    this.exhaustEmitter.emitting = turboActive;
    this.speedLinesEmitter.emitting = turboActive;

    // EventBus → HUD desacoplado (velocímetro, barra de turbo, chip DRS).
    this.bus.emit('speed', speed);
    this.bus.emit('turbo', { level: this.turboSystem.levelValue, active: turboActive });
    this.bus.emit('drs', {
      state: this.drsSystem.state,
      cooldownRatio: this.drsSystem.cooldownRatio,
      cooldownSeconds: this.drsSystem.cooldownSeconds,
    });
  }
}
