import Phaser from 'phaser';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { TrackEntity } from './TrackEntity';

/**
 * Pickup — objeto beneficioso sobre el asfalto (Fase 4).
 *
 * Mismo pool para los dos kinds de la familia `pickup` (data-driven):
 * - `turbo` → recarga el medidor de turbo (+50).
 * - `drs` → resetea el cooldown del DRS.
 *
 * Efecto de "imán": pulso de escala senoidal calculado en preUpdate, sin
 * tweens (los tweens sobre objetos poolables quedan colgados al reciclar).
 */
export class Pickup extends TrackEntity {
  readonly family = 'pickup' as const;

  private pulseTime = 0;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEXTURE_KEYS.pickupTurbo);
    this.setDepth(6);
  }

  protected override onSpawn(): void {
    this.pulseTime = 0;
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) {
      return;
    }
    this.pulseTime += delta / 1000;
    this.setScale(1 + Math.sin(this.pulseTime * 6) * 0.08);
  }
}
