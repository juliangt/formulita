/**
 * Leaderboard — tabla final de la partida multijugador (M2).
 *
 * Puesto, nombre+color, monedas, puntaje y kilómetros (2 decimales) de cada
 * jugador, ordenados por el ranking determinístico que computó MatchTracker
 * (monedas DESC → km DESC → puntaje DESC). El ganador — el de MÁS MONEDAS,
 * no el último en pie — se destaca con corona y dorado.
 *
 * Testeable: el formateo de filas y el mensaje personal son funciones PURAS
 * (el widget solo dibuja textos/rectángulos con lo que ellas producen).
 */

import Phaser from 'phaser';
import { DISTANCE_METERS_PER_PIXEL, LEADERBOARD } from '../config/balance';
import type { FinalStanding } from '../net/protocol';

/** Dorado del ganador (mismo acento que monedas/récords del resto del UI). */
const GOLD = '#f7c531';
const TEXT = '#f2f2f2';
const DIM = '#9aa0a8';

/** Distancia (px de carrera) → kilómetros con 2 decimales. */
export function formatKm(px: number): string {
  const safe = Number.isFinite(px) && px > 0 ? px : 0;
  const km = (safe * DISTANCE_METERS_PER_PIXEL) / 1000;
  return `${km.toFixed(2)} KM`;
}

/** Textos de una fila de la tabla (todo ya formateado para monospace). */
export interface LeaderboardRowTexts {
  readonly place: string;
  readonly name: string;
  readonly coins: string;
  readonly score: string;
  readonly km: string;
}

/** Formatea los textos de una fila del leaderboard. */
export function leaderboardRowTexts(standing: FinalStanding): LeaderboardRowTexts {
  return {
    place: standing.isWinner ? '♛1' : String(standing.place),
    name: standing.name,
    coins: String(standing.coins),
    score: String(standing.score),
    km: formatKm(standing.distance),
  };
}

/** Mensaje personal bajo el título según el puesto final propio. */
export function personalResultMessage(place: number): string {
  return place === 1 ? '¡GANASTE!' : `TERMINASTE N°${place}`;
}

/** Opciones del widget (default: LEADERBOARD de balance). */
export interface LeaderboardOptions {
  readonly headerY?: number;
  readonly rowStartY?: number;
  readonly rowHeight?: number;
  readonly rowFontSize?: number;
  readonly headerFontSize?: number;
  readonly highlightPeerId?: string | null;
}

/** Fila dibujada (para poder destruir/recrear la tabla). */
interface DrawnRow {
  readonly objects: Phaser.GameObjects.GameObject[];
}

export class Leaderboard {
  private readonly scene: Phaser.Scene;
  private readonly options: Required<LeaderboardOptions>;
  private readonly header: Phaser.GameObjects.GameObject[] = [];
  private rows: DrawnRow[] = [];

  constructor(scene: Phaser.Scene, options: LeaderboardOptions = {}) {
    this.scene = scene;
    this.options = {
      headerY: options.headerY ?? LEADERBOARD.headerY,
      rowStartY: options.rowStartY ?? LEADERBOARD.rowStartY,
      rowHeight: options.rowHeight ?? LEADERBOARD.rowHeight,
      rowFontSize: options.rowFontSize ?? LEADERBOARD.rowFontSize,
      headerFontSize: options.headerFontSize ?? LEADERBOARD.headerFontSize,
      highlightPeerId: options.highlightPeerId ?? null,
    };
  }

  /** Dibuja (o redibuja) la tabla completa con los puestos finales. */
  render(standings: readonly FinalStanding[]): void {
    this.clearRows();
    this.renderHeader();
    standings.forEach((standing, index) => {
      this.renderRow(standing, index);
    });
  }

  /** Encabezados de columna (una vez por render). */
  private renderHeader(): void {
    const headerStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${this.options.headerFontSize}px`,
      color: DIM,
    };
    const columns: [number, string, number][] = [
      [LEADERBOARD.placeX, 'PUT', 0],
      [LEADERBOARD.nameX, 'PILOTO', 0],
      [LEADERBOARD.coinsX, 'MON', 1],
      [LEADERBOARD.scoreX, 'PTS', 1],
      [LEADERBOARD.kmX, 'KM', 1],
    ];
    for (const [x, label, originX] of columns) {
      this.header.push(
        this.scene.add
          .text(x, this.options.headerY, label, headerStyle)
          .setOrigin(originX as 0 | 1, 0.5),
      );
    }
  }

  /** Una fila: cuadrado de color + textos (ganador en dorado con corona). */
  private renderRow(standing: FinalStanding, index: number): void {
    const y = this.options.rowStartY + index * this.options.rowHeight;
    const isSelf = standing.peerId === this.options.highlightPeerId;
    const color = standing.isWinner ? GOLD : TEXT;
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${this.options.rowFontSize}px`,
      color,
    };
    const texts = leaderboardRowTexts(standing);
    const objects: Phaser.GameObjects.GameObject[] = [];

    // Fila propia: velo sutil para encontrarse de un vistazo.
    if (isSelf) {
      objects.push(
        this.scene.add
          .rectangle(this.scene.scale.width / 2, y, 648, this.options.rowHeight - 6, 0xf2f2f2, 0.07),
      );
    }
    objects.push(
      this.scene.add
        .rectangle(
          LEADERBOARD.nameX + 8,
          y,
          LEADERBOARD.swatchSize,
          LEADERBOARD.swatchSize,
          standing.color,
        )
        .setStrokeStyle(2, 0x0c0c14),
    );
    objects.push(
      this.scene.add
        .text(LEADERBOARD.placeX, y, texts.place, style)
        .setOrigin(0, 0.5)
        .setColor(standing.isWinner ? GOLD : DIM),
    );
    objects.push(
      this.scene.add.text(LEADERBOARD.nameX + 30, y, texts.name, style).setOrigin(0, 0.5),
    );
    objects.push(
      this.scene.add.text(LEADERBOARD.coinsX, y, texts.coins, style).setOrigin(1, 0.5),
    );
    objects.push(
      this.scene.add.text(LEADERBOARD.scoreX, y, texts.score, style).setOrigin(1, 0.5),
    );
    objects.push(this.scene.add.text(LEADERBOARD.kmX, y, texts.km, style).setOrigin(1, 0.5));

    this.rows.push({ objects });
  }

  private clearRows(): void {
    for (const row of this.rows) {
      for (const object of row.objects) {
        object.destroy();
      }
    }
    this.rows = [];
    for (const object of this.header) {
      object.destroy();
    }
    this.header.length = 0;
  }

  destroy(): void {
    this.clearRows();
  }
}
