import Phaser from 'phaser';
import {
  BASE_SPEED,
  OIL_SLIP_SECONDS,
  PLAYER_START_Y,
  RACE_HUD,
  TRACK,
  TURBO_MAX,
  TURBO_PICKUP_REFILL,
} from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { PlayerCar } from '../entities/PlayerCar';
import { TrackEntity } from '../entities/TrackEntity';
import { DifficultySystem } from '../systems/DifficultySystem';
import { InputSystem } from '../systems/InputSystem';
import { KeyboardSource } from '../systems/KeyboardSource';
import { TouchSource } from '../systems/TouchSource';
import { SpawnSystem } from '../systems/SpawnSystem';
import { SpeedSystem, composeEffectiveSpeed } from '../systems/SpeedSystem';
import { TurboSystem } from '../systems/TurboSystem';
import { DrsSystem } from '../systems/DrsSystem';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { EnergyBar } from '../ui/EnergyBar';
import { DrsIndicator } from '../ui/DrsIndicator';
import { Speedometer } from '../ui/Speedometer';

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
 *   bus; rival/resto → explosión, shake y game-over (escena congelada; el
 *   flujo a GameOverScene es Fase 5); aceite → derrape no destructivo.
 * - Efectos visuales del turbo (partículas de escape + líneas de velocidad).
 * - HUD de la fase desacoplado por `EventBus`. El puntaje completo es Fase
 *   5: por ahora se acumulan monedas/puntos y se emiten por el bus.
 */
export class GameScene extends Phaser.Scene {
  static readonly KEY = 'Game';

  private road!: Phaser.GameObjects.TileSprite;
  private inputSystem!: InputSystem;
  private playerCar!: PlayerCar;

  /* Fase 3 — lógica pura + bus de eventos de la carrera. */
  private bus!: EventBus<GameEvents>;
  private speedSystem!: SpeedSystem;
  private turboSystem!: TurboSystem;
  private drsSystem!: DrsSystem;

  /* Fase 4 — generación procedural + dificultad. */
  private difficulty!: DifficultySystem;
  private spawnSystem!: SpawnSystem;

  /* Estado de la carrera (puntaje completo = Fase 5). */
  private currentSpeed = BASE_SPEED;
  private coins = 0;
  private score = 0;
  private gameOver = false;

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
    this.score = 0;
    this.gameOver = false;

    // Fase 2 — fuentes de entrada fusionadas en un único IInputState.
    // Agregar/quitar fuentes (gamepad, demo IA…) = editar esta lista.
    const touchSource = new TouchSource(this, { width, height });
    this.inputSystem = new InputSystem([KeyboardSource.fromScene(this), touchSource]);
    this.inputSystem.attach();

    // El auto consume el estado fusionado (steer); los sistemas de la Fase 3
    // consumen throttle/brake/turbo/drs del MISMO estado.
    this.playerCar = new PlayerCar(this, width / 2, PLAYER_START_Y, this.inputSystem);

    // Fase 3 — sistemas puros. El DRS consulta la velocidad vía proveedor
    // inyectado (sin acoplarse al SpeedSystem).
    this.bus = new EventBus<GameEvents>();
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
    this.createHud(width);

    // Al apagarse la escena (restart) nada puede quedar colgado: detach de
    // fuentes, destrucción del HUD táctil, de los widgets (se desuscriben),
    // de los grupos del SpawnSystem y limpieza del bus.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.detach();
      touchSource.destroy();
      for (const widget of this.hudWidgets) {
        widget.destroy();
      }
      this.hudWidgets = [];
      this.bus.clear();
      this.exhaustEmitter.stop();
      this.speedLinesEmitter.stop();
      this.spawnSystem.destroy();
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
        this.coins += entity.def.coins;
        this.score += entity.def.points;
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
        this.bus.emit('coins', this.coins);
        this.bus.emit('score', this.score);
        break;
      case 'collect-turbo':
        this.turboSystem.refill(TURBO_PICKUP_REFILL);
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
        break;
      case 'collect-drs':
        this.drsSystem.resetCooldown();
        this.burstCollect(entity);
        this.spawnSystem.release(entity);
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
   * Choque destructivo (rival o resto): explosión + shake + evento del bus.
   * La escena queda congelada (mundo pausado, sin spawn); el flujo a
   * GameOverScene con su UI es Fase 5.
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

    this.bus.emit('game-over', {
      score: this.score,
      distance: this.difficulty.distance,
      coins: this.coins,
    });
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

  /** HUD de la Fase 3: velocímetro + barra de turbo + chip DRS. */
  private createHud(width: number): void {
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
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    // Escena congelada tras el crash: la cámara termina el shake solo.
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
