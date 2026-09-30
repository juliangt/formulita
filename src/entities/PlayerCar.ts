import Phaser from 'phaser';
import {
  EMPTY_INPUT_STATE,
  steerDirection,
  type IInputSource,
  type IInputState,
} from '../systems/InputSystem';
import {
  OIL_SLIP_SECONDS,
  PLAYER_LATERAL_ACCELERATION,
  PLAYER_LATERAL_DRAG,
  PLAYER_MAX_LATERAL_SPEED,
  PLAYER_TILT_MAX_DEGREES,
  TRACK,
} from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';

/** Límites horizontales de la pista (px) para el clamp del auto. */
export interface TrackBounds {
  /** X mínimo del asfalto (borde interno del kerb izquierdo). */
  left: number;
  /** X máximo del asfalto (borde interno del kerb derecho). */
  right: number;
}

function defaultTrackBounds(): TrackBounds {
  return { left: TRACK.roadLeft, right: TRACK.roadRight };
}

/**
 * Steering durante el derrape de aceite (puro): la dirección pedida se
 * INVIERTE (el auto no obedece) y, si el jugador no está doblando, zigzaguea
 * solo hacia los lados. `slipElapsed` son los segundos transcurridos derrapando.
 */
export function slipSteer(steer: number, slipElapsed: number): number {
  if (steer !== 0) {
    return steer > 0 ? -1 : 1;
  }
  return Math.sin(slipElapsed * 16) >= 0 ? 1 : -1;
}

/**
 * PlayerCar — auto del jugador.
 *
 * - Sprite arcade con body propio, movimiento lateral con aceleración y
 *   fricción (nada de teletransporte: la velocidad se construye sola).
 * - Clamp a los límites de pista con anulación de velocidad al llegar al tope.
 * - Inclinación visual sutil proporcional a la velocidad lateral.
 *
 * INPUT (Fase 2): la fuente se inyecta por constructor como `IInputSource`
 * (teclado, táctil o la fusión de ambas hecha por InputSystem — son
 * intercambiables por Liskov). La clase NO conoce el hardware: consume el
 * `IInputState` fusionado. Los flags throttle/brake/turbo/drs ya viajan en
 * el estado y quedan listos para los sistemas de Fase 3+.
 */
export class PlayerCar extends Phaser.Physics.Arcade.Sprite {
  private readonly bounds: TrackBounds;
  private readonly inputSource: IInputSource;

  /** Último estado de input leído (neutro hasta el primer preUpdate). */
  private lastInput: IInputState = EMPTY_INPUT_STATE;

  /* Derrape por aceite (Fase 4): steering invertido/aleatorio breve. */
  private slipSeconds = 0;
  private slipElapsed = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    inputSource: IInputSource,
    bounds: TrackBounds = defaultTrackBounds(),
  ) {
    super(scene, x, y, TEXTURE_KEYS.playerCar);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.bounds = bounds;
    this.inputSource = inputSource;

    this.setDepth(10);
    this.physicsBody.setAllowGravity(false);
    // La velocidad vertical no interviene: el mundo scrollea, el auto no.
    this.setMaxVelocity(PLAYER_MAX_LATERAL_SPEED, 0);
    this.setDragX(PLAYER_LATERAL_DRAG);
    this.setAccelerationX(0);

    // Hitbox un pelín más angosto/chico que el sprite (perdón visual).
    this.physicsBody.setSize(40, 72, true);
  }

  /** Getter con cast único: el body es dinámico por cómo se construyó. */
  private get physicsBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /** Estado de input del último frame (turbo/drs listos para Fase 3+). */
  get inputState(): IInputState {
    return this.lastInput;
  }

  /** `true` mientras dure el derrape por aceite. */
  get isSlipping(): boolean {
    return this.slipSeconds > 0;
  }

  /**
   * Pisó aceite: pérdida de control lateral breve (no destructiva). Si se
   * pisa de nuevo mientras derrapa, refresca la duración. Duración inválida
   * (NaN/≤0) es un no-op.
   */
  slip(duration: number = OIL_SLIP_SECONDS): void {
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    this.slipSeconds = Math.max(this.slipSeconds, duration);
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    const dt = delta / 1000;

    // ÚNICO punto de lectura de input: el estado fusionado de la fuente.
    this.lastInput = this.inputSource.getState();

    let steer = steerDirection(this.lastInput);
    if (this.slipSeconds > 0) {
      this.slipSeconds = Math.max(0, this.slipSeconds - dt);
      this.slipElapsed += dt;
      steer = slipSteer(steer, this.slipElapsed);
    } else {
      this.slipElapsed = 0;
    }

    this.setAccelerationX(steer * PLAYER_LATERAL_ACCELERATION);

    this.clampToTrack();
    this.applyTilt();
    this.applySlipVisual();
  }

  /** Clamp a los límites de pista; al tocar el tope se anula la velocidad. */
  private clampToTrack(): void {
    const halfWidth = this.displayWidth / 2;
    const minX = this.bounds.left + halfWidth;
    const maxX = this.bounds.right - halfWidth;

    if (this.x < minX) {
      this.setX(minX);
      this.physicsBody.setVelocityX(0);
    } else if (this.x > maxX) {
      this.setX(maxX);
      this.physicsBody.setVelocityX(0);
    }
  }

  /** Inclinación visual sutil, proporcional a la velocidad lateral. */
  private applyTilt(): void {
    const ratio = this.physicsBody.velocity.x / PLAYER_MAX_LATERAL_SPEED;
    let angle = Phaser.Math.Clamp(
      ratio * PLAYER_TILT_MAX_DEGREES,
      -PLAYER_TILT_MAX_DEGREES,
      PLAYER_TILT_MAX_DEGREES,
    );
    // Derrapando: bamboleo adicional que "vende" la pérdida de control.
    if (this.slipSeconds > 0) {
      angle += Math.sin(this.slipElapsed * 30) * 6;
    }
    this.setAngle(angle);
  }

  /** Feedback visual del derrape: tinte cálido mientras no obedece. */
  private applySlipVisual(): void {
    if (this.slipSeconds > 0) {
      this.setTint(0xff8a5a);
    } else {
      this.clearTint();
    }
  }
}
