import Phaser from 'phaser';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { TrackEntity } from './TrackEntity';

/**
 * Hazard — obstáculo estático del asfalto (Fase 4).
 *
 * Sirve para los dos kinds de la familia `hazard` (data-driven, mismo pool):
 * - `debris` (restos): destructivo → explosión + shake + game-over.
 * - `oil` (mancha de aceite): NO destructivo → derrape lateral breve; la
 *   mancha permanece en la pista (solo se recicla al salir por abajo).
 */
export class Hazard extends TrackEntity {
  readonly family = 'hazard' as const;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEXTURE_KEYS.debris);
    this.setDepth(5);
  }

  protected override onSpawn(): void {
    // La mancha se dibuja un pelín translúcida: se lee como "peligro blando".
    this.setAlpha(this.def.kind === 'oil' ? 0.95 : 1);
  }
}
