import Phaser from 'phaser';
import {
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
 * PlayerCar — auto del jugador (Fase 1).
 *
 * - Sprite arcade con body propio, movimiento lateral con aceleración y
 *   fricción (nada de teletransporte: la velocidad se construye sola).
 * - Clamp a los límites de pista con anulación de velocidad al llegar al tope.
 * - Inclinación visual sutil proporcional a la velocidad lateral.
 *
 * La lectura de teclado está aislada en `readSteeringInput()` / las listas de
 * keys: en la Fase 2 se reemplaza por una fuente `IInputSource` inyectada sin
 * tocar el resto de la clase (principio L del plan).
 */
export class PlayerCar extends Phaser.Physics.Arcade.Sprite {
  private readonly bounds: TrackBounds;
  private readonly leftKeys: Phaser.Input.Keyboard.Key[];
  private readonly rightKeys: Phaser.Input.Keyboard.Key[];

  constructor(scene: Phaser.Scene, x: number, y: number, bounds: TrackBounds = defaultTrackBounds()) {
    super(scene, x, y, TEXTURE_KEYS.playerCar);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.bounds = bounds;

    this.setDepth(10);
    this.physicsBody.setAllowGravity(false);
    // La velocidad vertical no interviene: el mundo scrollea, el auto no.
    this.setMaxVelocity(PLAYER_MAX_LATERAL_SPEED, 0);
    this.setDragX(PLAYER_LATERAL_DRAG);
    this.setAccelerationX(0);

    // Hitbox un pelín más angosto/chico que el sprite (perdón visual).
    this.physicsBody.setSize(40, 72, true);

    // --- INPUT DE TECLADO (punto aislado, se reemplaza en la Fase 2) ---
    const keyboard = scene.input.keyboard;
    this.leftKeys = keyboard ? [keyboard.addKey('LEFT'), keyboard.addKey('A')] : [];
    this.rightKeys = keyboard ? [keyboard.addKey('RIGHT'), keyboard.addKey('D')] : [];
  }

  /** Getter con cast único: el body es dinámico por cómo se construyó. */
  private get physicsBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);

    const steer = this.readSteeringInput();
    this.setAccelerationX(steer * PLAYER_LATERAL_ACCELERATION);

    this.clampToTrack();
    this.applyTilt();
  }

  /**
   * Dirección de giro pedida: -1 (izquierda), 0 (nada) o 1 (derecha).
   * ÚNICO punto de lectura de input de la Fase 1 — Fase 2 lo cambia por
   * `IInputSource.getState()` sin tocar el resto de la clase.
   */
  private readSteeringInput(): number {
    const left = this.leftKeys.some((key) => key.isDown);
    const right = this.rightKeys.some((key) => key.isDown);
    return (left ? -1 : 0) + (right ? 1 : 0);
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
    this.setAngle(
      Phaser.Math.Clamp(ratio * PLAYER_TILT_MAX_DEGREES, -PLAYER_TILT_MAX_DEGREES, PLAYER_TILT_MAX_DEGREES),
    );
  }
}
