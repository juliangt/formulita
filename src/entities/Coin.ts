import Phaser from 'phaser';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { TrackEntity } from './TrackEntity';

/**
 * Coin — moneda sobre el asfalto (Fase 4).
 *
 * Entidad estática: viaja con la pista (SpawnSystem le asigna la velocidad de
 * cierre) y no tiene comportamiento propio. La textura/hitbox de `coin` se
 * aplican en cada spawn desde `entityTypes.ts` (data-driven).
 */
export class Coin extends TrackEntity {
  readonly family = 'coin' as const;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEXTURE_KEYS.coin);
    this.setDepth(5);
  }
}
