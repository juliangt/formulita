/**
 * RemoteCar — auto remoto del circuito (issue #9, V2).
 *
 * La representación local de cada rival en la CARRERA: sprite OPACO (a
 * diferencia del fantasma semitransparente de la BATALLA — acá todos corren
 * la misma pista y se ven como coches reales) con el NOMBRE del jugador y
 * SU color del roster. No tiene body de física: no hay PvP en el circuito,
 * cada uno corre contra la pista (el sprite es sólo presentación).
 *
 * La posición NO la fija el `rstate` crudo: la escena interpola el progreso
 * desenrollado con el `SnapshotBuffer` del peer y reconstruye x/y/ángulo con
 * el TrackPath local (`race/raceRemote.sampleFromProgress`), así el auto es
 * continuo al cruzar la meta. Testeable: la reconstrucción es pura y vive en
 * `race/`; esta clase es sólo render de Phaser (patrón GhostCar).
 */

import Phaser from 'phaser';
import { colorToHex, GhostCar } from './GhostCar';
import type { PlayerInfo } from '../net/protocol';

/** Separación del label de nombre sobre el sprite (px; idem GhostCar). */
const LABEL_OFFSET_Y = 62;

/** Profundidad default: sobre la pista, debajo del auto propio (depth 10). */
const REMOTE_DEPTH = 9;

export interface RemoteCarOptions {
  /** Profundidad en la escena (default 9, idem fantasma). */
  readonly depth?: number;
  /** Tamaño de fuente del nombre (px). */
  readonly labelFontSize?: number;
}

export class RemoteCar {
  readonly player: PlayerInfo;

  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, player: PlayerInfo, options: RemoteCarOptions = {}) {
    this.player = player;

    // Textura por color: MISMO horneo idempotente del fantasma (palette swap
    // del mapa de píxeles del jugador); sólo cambia la opacidad del sprite.
    const key = GhostCar.ensureTexture(scene, player.color);
    this.sprite = scene.add.image(0, 0, key).setDepth(options.depth ?? REMOTE_DEPTH);
    this.label = scene.add
      .text(0, 0, player.name, {
        fontFamily: 'monospace',
        fontSize: `${options.labelFontSize ?? 20}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke(colorToHex(player.color), 4)
      .setDepth((options.depth ?? REMOTE_DEPTH) + 0.1);
  }

  /** Posición del sprite (para efectos/follow de cámara). */
  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  /** Sprite interno: target de cámara del espectador (`startFollow`). */
  get followTarget(): Phaser.GameObjects.Image {
    return this.sprite;
  }

  /**
   * Objetos de render (sprite + nombre): la RaceScene los registra como MUNDO
   * para la separación de cámaras (issue #18) — la cámara de UI debe
   * ignorarlos para que el zoom no los alcance y sólo los pinte
   * `cameras.main`.
   */
  get renderObjects(): readonly Phaser.GameObjects.GameObject[] {
    return [this.sprite, this.label];
  }

  /** Fija posición y orientación (reconstruidas por la escena). */
  sync(x: number, y: number, angle: number): void {
    this.sprite.setPosition(x, y);
    // La textura apunta hacia ARRIBA (−Y) y el heading es atan2-style.
    this.sprite.rotation = angle + Math.PI / 2;
    this.label.setPosition(x, y - LABEL_OFFSET_Y);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
