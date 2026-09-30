import Phaser from 'phaser';
import { BASE_SPEED, PLAYER_START_Y, TRACK } from '../config/balance';
import { PlayerCar } from '../entities/PlayerCar';
import { InputSystem } from '../systems/InputSystem';
import { KeyboardSource } from '../systems/KeyboardSource';
import { TouchSource } from '../systems/TouchSource';
import { TEXTURE_KEYS } from '../systems/TextureFactory';

/**
 * GameScene — carrera (Fase 2).
 *
 * - Pista vertical: un `TileSprite` que cubre la pantalla con el tile
 *   procedimental (barreras laterales + bandas de rumble + asfalto con línea
 *   central discontinua ya vienen horneados en la textura).
 * - El scroll vertical es la velocidad base fija de `config/balance.ts`
 *   (Fase 3 lo conectará al SpeedSystem).
 * - Controles unificados: `InputSystem` fusiona `KeyboardSource` (desktop) y
 *   `TouchSource` (HUD táctil multi-touch) en un único `IInputState`; el auto
 *   consume ese estado. Las fuentes son intercambiables (IInputSource).
 * Sin entidades de pista, HUD de datos, turbo/DRS ni puntaje: fases posteriores.
 */
export class GameScene extends Phaser.Scene {
  static readonly KEY = 'Game';

  private road!: Phaser.GameObjects.TileSprite;
  private inputSystem!: InputSystem;

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

    // El auto consume el estado fusionado (throttle/brake/turbo/drs viajan en
    // el estado y quedan listos para la Fase 3).
    new PlayerCar(this, width / 2, PLAYER_START_Y, this.inputSystem);

    // Al apagarse la escena (restart) ninguna fuente puede dejar listeners
    // ni flags colgados: detach de todas + destrucción del HUD táctil.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.detach();
      touchSource.destroy();
    });
  }

  override update(_time: number, delta: number): void {
    // Scroll = velocidad actual (px/s). tilePositionY decrece → la textura
    // avanza hacia abajo, hacia el auto: sensación de avance.
    // Wrap con el alto del tile para no acumular floats sin límite.
    // Fase 2: sigue a BASE_SPEED (SpeedSystem es Fase 3).
    const scroll = (BASE_SPEED * delta) / 1000;
    this.road.tilePositionY = Phaser.Math.Wrap(this.road.tilePositionY - scroll, 0, TRACK.tileHeight);
  }
}
