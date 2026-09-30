import Phaser from 'phaser';
import { RIVAL, SPAWN, laneCenterX, laneIndexAtX } from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { TrackEntity } from './TrackEntity';

/** Enfriamiento del próximo cambio de carril, en segundos. */
function nextLaneChangeDelay(): number {
  const { laneChangeCooldownMin, laneChangeCooldownMax } = RIVAL;
  return laneChangeCooldownMin + Math.random() * (laneChangeCooldownMax - laneChangeCooldownMin);
}

/**
 * RivalCar — auto rival (Fase 4).
 *
 * Más lento que el jugador: SpawnSystem le asigna una velocidad de cierre
 * `playerSpeed - forwardSpeed` (velocidad propia por kind, escalada por la
 * dificultad). Los rivales lentos (`laneChanges` en entityTypes) hacen un
 * cambio de carril ocasional:
 * - Solo lejos del jugador (por encima de `RIVAL.laneChangeMaxY`): la
 *   garantía de pasabilidad del scheduler vale cerca del auto, y así el
 *   movimiento se lee como tráfico y no como trampa.
 * - Solo hacia carriles vecinos, a velocidad lateral acotada.
 *
 * El `preUpdate` es no-op mientras el sprite esté reciclado (pooling).
 */
export class RivalCar extends TrackEntity {
  readonly family = 'rival' as const;

  private laneIndex = 0;
  private targetX = 0;
  private laneChangeTimer = 0;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEXTURE_KEYS.rivalCarBlue);
    this.setDepth(7);
  }

  protected override onSpawn(): void {
    this.laneIndex = laneIndexAtX(this.x, SPAWN.laneCount);
    this.targetX = laneCenterX(this.laneIndex, SPAWN.laneCount);
    this.laneChangeTimer = nextLaneChangeDelay();
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) {
      return;
    }
    const dt = delta / 1000;

    this.laneChangeTimer -= dt;
    if (this.laneChangeTimer <= 0) {
      this.considerLaneChange();
      this.laneChangeTimer = nextLaneChangeDelay();
    }

    this.steerToTarget();
  }

  /** Cambio de carril ocasional (solo kinds `laneChanges` y lejos del jugador). */
  private considerLaneChange(): void {
    if (!this.def.laneChanges || this.y > RIVAL.laneChangeMaxY) {
      return;
    }
    const direction = Math.random() < 0.5 ? -1 : 1;
    const next = Phaser.Math.Clamp(this.laneIndex + direction, 0, SPAWN.laneCount - 1);
    if (next === this.laneIndex) {
      return;
    }
    this.laneIndex = next;
    this.targetX = laneCenterX(next, SPAWN.laneCount);
  }

  /** Persigue su carril objetivo a velocidad lateral acotada (body arcade). */
  private steerToTarget(): void {
    const body = this.physicsBody;
    const dx = this.targetX - this.x;
    if (Math.abs(dx) < 2) {
      body.velocity.x = 0;
      return;
    }
    body.velocity.x = Phaser.Math.Clamp(dx * 6, -RIVAL.laneChangeSpeed, RIVAL.laneChangeSpeed);
  }
}
