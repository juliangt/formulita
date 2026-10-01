/**
 * PositionStrip — franja lateral de posiciones (M2).
 *
 * Columna a la derecha de la pista que muestra dónde está CADA jugador
 * relativo a uno mismo por distancia: los que van adelante quedan más
 * arriba, los que van atrás más abajo; el propio marcador es el centro.
 * Cada punto lleva el COLOR del jugador (la misma paleta del roster); los
 * eliminados quedan atenuados en su última distancia. Debajo de las monedas
 * del HUD vive el contador "VIVOS n/total".
 *
 * Testeable: `computeStripPlacements` es la función PURA del mapeo
 * distancia→offset (el widget solo dibuja lo que ella decide).
 */

import Phaser from 'phaser';
import { POSITION_STRIP, STRIP_ELIMINATED_ALPHA } from '../config/balance';

/** Jugador de la franja (lo que la escena sabe de cada peer + uno mismo). */
export interface StripPlayerInput {
  readonly peerId: string;
  readonly color: number;
  /** Distancia actual (o congelada, si ya está eliminado). */
  readonly distance: number;
  readonly alive: boolean;
  readonly isSelf: boolean;
}

/** Dónde dibujar el marcador de un jugador. */
export interface StripPlacement {
  readonly peerId: string;
  /** Offset vertical en px desde el centro (negativo = va DELANTE, arriba). */
  readonly offsetY: number;
  /** true si la diferencia de distancia excede el rango (quedó al borde). */
  readonly clamped: boolean;
}

/** Geometría del mapeo (la escena inyecta la de balance o la suya). */
export interface StripLayout {
  /** Diferencia de distancia (px) que mapea al alto completo (±height/2). */
  readonly range: number;
  /** Alto de la franja (px). */
  readonly height: number;
}

/**
 * Mapea cada jugador a su offset en la franja: adelante → negativo (arriba),
 * atrás → positivo (abajo), con clamp a los bordes. Uno mismo siempre cae al
 * centro (offset 0). `range` no positivo o alto no positivo degradan a
 * offset 0 (defensa: nadie se dibuja fuera de la franja).
 */
export function computeStripPlacements(
  players: readonly StripPlayerInput[],
  selfDistance: number,
  layout: StripLayout,
): StripPlacement[] {
  const half = layout.height > 0 ? layout.height / 2 : 0;
  const range = layout.range;
  return players.map((player) => {
    if (player.isSelf || !(range > 0)) {
      return { peerId: player.peerId, offsetY: 0, clamped: false };
    }
    // Adelante (más distancia) → arriba: offset negativo.
    const ratio = (selfDistance - player.distance) / range;
    const raw = ratio * half;
    const clamped = Math.abs(raw) > half;
    return {
      peerId: player.peerId,
      offsetY: Phaser.Math.Clamp(raw, -half, half),
      clamped,
    };
  });
}

/** Opciones del widget (default: POSITION_STRIP de balance). */
export interface PositionStripOptions {
  readonly x?: number;
  readonly centerY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly range?: number;
  readonly depth?: number;
  readonly aliveX?: number;
  readonly aliveY?: number;
  readonly aliveFontSize?: number;
}

/** Un marcador persistente de la franja (se reposiciona por update). */
interface StripMarker {
  readonly rect: Phaser.GameObjects.Rectangle;
}

export class PositionStrip {
  private readonly scene: Phaser.Scene;
  private readonly layout: StripLayout;
  private readonly options: Required<PositionStripOptions>;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly selfMarker: Phaser.GameObjects.Rectangle;
  private readonly aliveText: Phaser.GameObjects.Text;
  private readonly markers = new Map<string, StripMarker>();
  private lastAliveLabel = '';

  constructor(scene: Phaser.Scene, options: PositionStripOptions = {}) {
    this.scene = scene;
    this.options = {
      x: options.x ?? POSITION_STRIP.x,
      centerY: options.centerY ?? POSITION_STRIP.centerY,
      width: options.width ?? POSITION_STRIP.width,
      height: options.height ?? POSITION_STRIP.height,
      range: options.range ?? POSITION_STRIP.range,
      depth: options.depth ?? POSITION_STRIP.depth,
      aliveX: options.aliveX ?? POSITION_STRIP.aliveX,
      aliveY: options.aliveY ?? POSITION_STRIP.aliveY,
      aliveFontSize: options.aliveFontSize ?? POSITION_STRIP.aliveFontSize,
    };
    this.layout = { range: this.options.range, height: this.options.height };

    // Marco de la franja: fino, translúcido, sobre la barrera derecha.
    this.frame = scene.add
      .rectangle(
        this.options.x,
        this.options.centerY,
        this.options.width + 6,
        this.options.height,
        0x0c0c14,
        0.45,
      )
      .setDepth(this.options.depth)
      .setStrokeStyle(2, 0x3a3a44, 0.8);

    // Marcador propio: línea blanca al centro (referencia de todo lo demás).
    this.selfMarker = scene.add
      .rectangle(
        this.options.x,
        this.options.centerY,
        this.options.width + 8,
        8,
        0xf2f2f2,
      )
      .setDepth(this.options.depth + 1);

    this.aliveText = scene.add
      .text(this.options.aliveX, this.options.aliveY, '', {
        fontFamily: 'monospace',
        fontSize: `${this.options.aliveFontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(1, 0.5)
      .setDepth(this.options.depth);
  }

  /**
   * Repone la franja: posiciona los marcadores por distancia relativa (los
   * muertos quedan atenuados) y refresca el contador VIVOS solo cuando
   * cambia (el texto no se re-escribe por frame).
   */
  update(players: readonly StripPlayerInput[], selfDistance: number, aliveCount: number, totalCount: number): void {
    const placements = computeStripPlacements(players, selfDistance, this.layout);
    const seen = new Set<string>();
    for (let i = 0; i < players.length; i += 1) {
      const player = players[i];
      seen.add(player.peerId);
      if (player.isSelf) {
        continue; // el marcador propio (selfMarker, blanco) ya vive al centro
      }
      const placement = placements[i];
      let marker = this.markers.get(player.peerId);
      if (!marker) {
        const rect = this.scene.add
          .rectangle(
            this.options.x,
            this.options.centerY,
            this.options.width,
            18,
            player.color,
          )
          .setDepth(this.options.depth + 2);
        marker = { rect };
        this.markers.set(player.peerId, marker);
      }
      marker.rect
        .setY(this.options.centerY + placement.offsetY)
        .setAlpha(player.alive ? 1 : STRIP_ELIMINATED_ALPHA);
    }
    for (const [peerId, marker] of this.markers) {
      if (!seen.has(peerId)) {
        marker.rect.destroy();
        this.markers.delete(peerId);
      }
    }

    const label = `VIVOS ${aliveCount}/${totalCount}`;
    if (label !== this.lastAliveLabel) {
      this.lastAliveLabel = label;
      this.aliveText.setText(label);
    }
  }

  destroy(): void {
    for (const marker of this.markers.values()) {
      marker.rect.destroy();
    }
    this.markers.clear();
    this.frame.destroy();
    this.selfMarker.destroy();
    this.aliveText.destroy();
  }
}
