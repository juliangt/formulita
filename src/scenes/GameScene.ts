import Phaser from 'phaser';
import {
  PLAYER_START_Y,
  RACE_HUD,
  TURBO_MAX,
  TRACK,
} from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { PlayerCar } from '../entities/PlayerCar';
import { InputSystem } from '../systems/InputSystem';
import { KeyboardSource } from '../systems/KeyboardSource';
import { TouchSource } from '../systems/TouchSource';
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
 * GameScene — carrera (Fase 3).
 *
 * - Pista vertical: un `TileSprite` que cubre la pantalla con el tile
 *   procedimental; el scroll YA NO es fijo: lo marca el SpeedSystem compuesto
 *   con turbo y DRS (`composeEffectiveSpeed`). En Fase 4 el ritmo de spawn
 *   consumirá esta misma velocidad.
 * - Controles unificados (Fase 2): `InputSystem` fusiona teclado + táctil en
 *   un único `IInputState`; los tres sistemas consumen flags de ese estado.
 * - Sistemas puros (Fase 3) coordinados acá — las escenas solo orquestan:
 *   `SpeedSystem` (velocidad base autónoma), `TurboSystem` (medidor que
 *   drena mientras el flag turbo está activo) y `DrsSystem` (activable sobre
 *   el umbral de recta, con cooldown). La velocidad final =
 *   Speed × turbo × DRS, con clamps defensivos (nunca NaN ni infinito).
 * - Efecto visual del turbo: partículas de escape siguiendo al auto + líneas
 *   de velocidad (textura `particle` de TextureFactory, con tope de
 *   partículas). Phaser vive solo en la escena: los sistemas son lógica pura.
 * - HUD de la fase (velocímetro, barra de turbo, chip DRS) desacoplado por
 *   `EventBus`: los widgets se suscriben a los eventos, no a los sistemas.
 * Sin entidades de pista ni puntaje/monedas: fases 4 y 5.
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

  /* Efectos visuales del turbo (Phaser). */
  private exhaustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private speedLinesEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  /* HUD de la fase (widgets en ui/, conectados por EventBus). */
  private hudWidgets: HudWidget[] = [];

  constructor() {
    super(GameScene.KEY);
  }

  create(): void {
    const { width, height } = this.scale;

    this.road = this.add.tileSprite(width / 2, height / 2, width, height, TEXTURE_KEYS.roadTile);

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

    this.createTurboEffects();
    this.createHud(width);

    // Al apagarse la escena (restart) nada puede quedar colgado: detach de
    // fuentes, destrucción del HUD táctil y de los widgets (se desuscriben),
    // y limpieza del bus.
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

    // Scroll = velocidad compuesta (px/s). tilePositionY decrece → la textura
    // avanza hacia abajo, hacia el auto: sensación de avance. Wrap con el alto
    // del tile para no acumular floats sin límite.
    // Fase 4: el ritmo de spawn usará esta misma velocidad.
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
