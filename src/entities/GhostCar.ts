/**
 * GhostCar — auto fantasma de un rival (M2).
 *
 * Representación local de cada jugador remoto: sprite del auto con SU color
 * (palette swap del mismo mapa de píxeles que el jugador, horneado UNA vez
 * por color), semitransparente y ATRAVESABLE — no tiene body de física, así
 * que no colisiona con nada (no hay PvP: cada uno corre contra la pista).
 *
 * Encima lleva el NOMBRE del jugador; la posición la fija la escena con el
 * punto interpolado del `SnapshotBuffer` del peer (`sync`): la Y es relativa
 * al propio auto (más distancia que yo → más arriba en pantalla, que la
 * cámara persigue).
 *
 * Testeable: los helpers de color/textura/posición son funciones PURAS
 * exportadas (la clase en sí es solo render de Phaser, ver PlayerCar).
 */

import Phaser from 'phaser';
import { GHOST_ALPHA } from '../config/balance';
import type { PlayerInfo } from '../net/protocol';
import { drawPixelSprite, makeCarSprite, pixelSpriteSize } from '../systems/TextureFactory';

/** Escala del mapa de píxeles del auto (la misma que TextureFactory). */
const CAR_SCALE = 4;

/** Separación del label de nombre sobre el sprite (px). */
const LABEL_OFFSET_Y = 62;

/**
 * Y de pantalla del fantasma: relativa a la del propio auto (`baseY`) por la
 * diferencia de distancia — si el rival lleva MÁS distancia que yo está más
 * ARRIBA en pantalla (la cámara mira desde mi auto hacia adelante).
 */
export function ghostScreenY(baseY: number, ghostDistance: number, myDistance: number): number {
  return baseY - (ghostDistance - myDistance);
}

/** 0xrrggbb → '#rrggbb' (paleta de los pixel sprites). */
export function colorToHex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}

/** Versión oscurecida (× factor < 1) de un color, en '#rrggbb'. */
export function darkenHex(color: number, factor: number): string {
  const channel = (shift: number): string =>
    Math.max(0, Math.min(255, Math.round(((color >>> shift) & 0xff) * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Clave de la textura del auto fantasma de un color (determinística). */
export function ghostTextureKeyFor(color: number): string {
  return `ghost-car-${(color >>> 0).toString(16).padStart(6, '0')}`;
}

/** Opciones del fantasma (todas con default de balance). */
export interface GhostCarOptions {
  /** Alfa del sprite (default GHOST_ALPHA). */
  readonly alpha?: number;
  /** Profundidad en la escena (default 9: sobre entidades, bajo el propio). */
  readonly depth?: number;
  /** Tamaño de fuente del nombre (px). */
  readonly labelFontSize?: number;
}

export class GhostCar {
  readonly player: PlayerInfo;

  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly alpha: number;

  constructor(scene: Phaser.Scene, player: PlayerInfo, options: GhostCarOptions = {}) {
    this.player = player;
    this.alpha = options.alpha ?? GHOST_ALPHA;

    const key = GhostCar.ensureTexture(scene, player.color);
    this.sprite = scene.add
      .image(0, 0, key)
      .setAlpha(this.alpha)
      .setDepth(options.depth ?? 9);
    this.label = scene.add
      .text(0, 0, player.name, {
        fontFamily: 'monospace',
        fontSize: `${options.labelFontSize ?? 20}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke(colorToHex(player.color), 4)
      .setAlpha(Math.min(1, this.alpha + 0.25))
      .setDepth((options.depth ?? 9) + 0.1);
  }

  /**
   * Hornea (una vez por color, idempotente) la textura del auto fantasma:
   * el MISMO mapa de píxeles del jugador con la carrocería en el color del
   * rival y su sombra derivada (palette swap barato, Fase 1).
   */
  static ensureTexture(scene: Phaser.Scene, color: number): string {
    const key = ghostTextureKeyFor(color);
    if (scene.textures.exists(key)) {
      return key;
    }
    const sprite = makeCarSprite(colorToHex(color), darkenHex(color, 0.6));
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawPixelSprite(g, sprite, CAR_SCALE);
    const { width, height } = pixelSpriteSize(sprite, CAR_SCALE);
    g.generateTexture(key, width, height);
    g.destroy();
    return key;
  }

  /** Posición del sprite (para efectos, p. ej. la explosión al eliminararlo). */
  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  /**
   * Fija la posición con el punto interpolado del buffer: `distance`/`x` del
   * rival contra mi distancia de cámara. Fuera de pantalla (muy adelante o
   * muy atrás) el fantasma se oculta — sigue existiendo por si vuelve al
   * rango, sin costo de render.
   */
  sync(distance: number, x: number, baseY: number, myDistance: number): void {
    const y = ghostScreenY(baseY, distance, myDistance);
    const visible = y > -120 && y < 1400;
    this.sprite.setPosition(x, y).setVisible(visible);
    this.label.setPosition(x, y - LABEL_OFFSET_Y).setVisible(visible);
  }

  setVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.label.setVisible(visible);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
