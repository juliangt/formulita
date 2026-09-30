import Phaser from 'phaser';
import { BASE_SPEED, PLAYER_START_Y, TRACK } from '../config/balance';
import { PlayerCar } from '../entities/PlayerCar';
import { TEXTURE_KEYS } from '../systems/TextureFactory';

/**
 * GameScene — carrera (Fase 1).
 *
 * - Pista vertical: un `TileSprite` que cubre la pantalla con el tile
 *   procedimental (barreras laterales + bandas de rumble + asfalto con línea
 *   central discontinua ya vienen horneados en la textura).
 * - El scroll vertical es la velocidad base fija de `config/balance.ts`
 *   (Fase 3 lo conectará al SpeedSystem).
 * - El auto del jugador es una entidad con física propia (`PlayerCar`).
 * Sin entidades de pista, HUD, turbo/DRS ni puntaje: fases posteriores.
 */
export class GameScene extends Phaser.Scene {
  static readonly KEY = 'Game';

  private road!: Phaser.GameObjects.TileSprite;

  constructor() {
    super(GameScene.KEY);
  }

  create(): void {
    const { width, height } = this.scale;

    this.road = this.add.tileSprite(width / 2, height / 2, width, height, TEXTURE_KEYS.roadTile);

    // El auto se auto-gestiona (input, física y tilt en su `preUpdate`); la
    // escena retoma la referencia cuando la Fase 3 conecte SpeedSystem.
    new PlayerCar(this, width / 2, PLAYER_START_Y);
  }

  override update(_time: number, delta: number): void {
    // Scroll = velocidad actual (px/s). tilePositionY decrece → la textura
    // avanza hacia abajo, hacia el auto: sensación de avance.
    // Wrap con el alto del tile para no acumular floats sin límite.
    const scroll = (BASE_SPEED * delta) / 1000;
    this.road.tilePositionY = Phaser.Math.Wrap(this.road.tilePositionY - scroll, 0, TRACK.tileHeight);
  }
}
