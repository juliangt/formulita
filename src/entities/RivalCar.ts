import Phaser from 'phaser';
import { RIVAL, SPAWN, laneCenterX, laneIndexAtX } from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import type { Rng } from '../systems/SpawnSystem';
import { TrackEntity } from './TrackEntity';

/**
 * RNG por defecto del rival: el azar local del modo de un jugador. En
 * multijugador el SpawnSystem inyecta (vía `setRng`) un rng sembrado por
 * `hash(seed, spawnIndex)` para que todos los clientes vean al MISMO rival
 * esquivar igual.
 */
export const DEFAULT_RIVAL_RNG: Rng = Math.random;

/** Enfriamiento del próximo cambio de carril (s) a partir de un roll en [0, 1). */
export function laneChangeCooldown(roll: number): number {
  const { laneChangeCooldownMin, laneChangeCooldownMax } = RIVAL;
  return laneChangeCooldownMin + roll * (laneChangeCooldownMax - laneChangeCooldownMin);
}

/** Dirección del próximo cambio de carril: roll < 0.5 → izquierda, si no derecha. */
export function laneChangeDirection(roll: number): -1 | 1 {
  return roll < 0.5 ? -1 : 1;
}

/** Índice del carril vecino clampeado a la pista (0..laneCount-1). */
export function nextLaneIndex(laneIndex: number, direction: -1 | 1): number {
  return Math.min(Math.max(laneIndex + direction, 0), SPAWN.laneCount - 1);
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
 * El azar del cambio de carril viene de un rng INYECTABLE (`setRng`), con
 * `Math.random` por defecto: el pool recicla instancias, así que el rng se
 * reasigna en cada spawn (multijugador: sembrado por índice de spawn).
 *
 * El `preUpdate` es no-op mientras el sprite esté reciclado (pooling).
 */
export class RivalCar extends TrackEntity {
  readonly family = 'rival' as const;

  private rng: Rng = DEFAULT_RIVAL_RNG;
  private laneIndex = 0;
  private targetX = 0;
  private laneChangeTimer = 0;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEXTURE_KEYS.rivalCarBlue);
    this.setDepth(7);
  }

  /**
   * Asigna el rng de las decisiones de cambio de carril. Reasignable en
   * cada spawn (el pool recicla instancias); sin llamar, queda `Math.random`.
   */
  setRng(rng: Rng): void {
    this.rng = rng;
  }

  protected override onSpawn(): void {
    this.laneIndex = laneIndexAtX(this.x, SPAWN.laneCount);
    this.targetX = laneCenterX(this.laneIndex, SPAWN.laneCount);
    this.laneChangeTimer = laneChangeCooldown(this.rng());
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
      this.laneChangeTimer = laneChangeCooldown(this.rng());
    }

    this.steerToTarget();
  }

  /** Cambio de carril ocasional (solo kinds `laneChanges` y lejos del jugador). */
  private considerLaneChange(): void {
    if (!this.def.laneChanges || this.y > RIVAL.laneChangeMaxY) {
      return;
    }
    const next = nextLaneIndex(this.laneIndex, laneChangeDirection(this.rng()));
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
