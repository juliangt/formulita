/**
 * RaceHud — HUD de la carrera en circuito (issue #9, V1).
 *
 * Widget de presentación (mismo estilo que ScoreHud/EnergyBar: primitivas,
 * textos monospace con contorno, repinta sólo cuando cambia lo mostrado).
 * A diferencia del HUD de la fase BATALLA (conectado por EventBus), acá la
 * RaceScene lo alimenta por métodos directos: los datos salen del LapTracker
 * de la misma escena y V2 (multi) reutiliza el widget con los datos del
 * auto propio. No conoce sistemas ni bus.
 *
 * Contenido (posiciones en `RACE`, balance.ts):
 * - badge "VUELTA 2/3" (oro),
 * - tiempo de la vuelta en curso,
 * - tiempo total desde el GO!,
 * - V2 — badge de posición en vivo "P3/8" (sólo multi/vs-cpu; `setPosition`).
 * - V3 (#14) — línea de gaps a los rivales "+1.2s -0.8s" (`setGaps`) y chip
 *   de contexto "GRAN PREMIO · MÓNACO · DIFÍCIL" (`setInfoChip`): sólo la
 *   rama vs CPU los alimenta (práctica y multi quedan como estaban).
 */

import Phaser from 'phaser';
import { RACE, RACE_VS_CPU } from '../config/balance';
import { formatGrandPrixChip, formatLapBadge, formatLapMs, formatRaceGaps } from './format';

const STROKE_COLOR = '#0c0c14';
const GOLD_COLOR = '#f7c531';
const DIM_COLOR = '#c8ccd4';

export interface RaceHudConfig {
  /** X del borde izquierdo de los textos. */
  readonly x?: number;
  /** Y del badge de vuelta (centro). */
  readonly lapBadgeY?: number;
  /** Y del tiempo de vuelta (centro). */
  readonly lapTimeY?: number;
  /** Y del tiempo total (centro). */
  readonly totalTimeY?: number;
  /** Y del badge de posición (centro; V2 multi). */
  readonly positionY?: number;
  /** Y de la línea de gaps (centro; V3 #14, bajo el badge de posición). */
  readonly gapY?: number;
  /** Y del chip de modo/pista/dificultad (centro; V3 #14). */
  readonly infoChipY?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class RaceHud {
  readonly container: Phaser.GameObjects.Container;

  private readonly lapBadgeText: Phaser.GameObjects.Text;
  private readonly lapTimeText: Phaser.GameObjects.Text;
  private readonly totalTimeText: Phaser.GameObjects.Text;
  private readonly positionText: Phaser.GameObjects.Text;
  private readonly gapText: Phaser.GameObjects.Text;
  private readonly infoChipText: Phaser.GameObjects.Text;

  private lastBadge = '';
  private lastLapTime = '';
  private lastTotalTime = '';
  private lastPosition = '';
  private lastGaps = '';
  private lastInfoChip = '';

  constructor(scene: Phaser.Scene, config: RaceHudConfig = {}) {
    const {
      x = RACE.hudX,
      lapBadgeY = RACE.lapBadgeY,
      lapTimeY = RACE.lapTimeY,
      totalTimeY = RACE.totalTimeY,
      positionY = RACE.positionBadgeY,
      gapY = RACE_VS_CPU.gapY,
      infoChipY = RACE_VS_CPU.infoChipY,
      depth = 0,
    } = config;

    this.container = scene.add.container(0, 0).setDepth(depth);

    this.lapBadgeText = scene.add
      .text(x, lapBadgeY, formatLapBadge(1, 1), {
        fontFamily: 'monospace',
        fontSize: `${RACE.lapBadgeFontSize}px`,
        color: GOLD_COLOR,
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 6);

    this.lapTimeText = scene.add
      .text(x, lapTimeY, formatLapMs(0), {
        fontFamily: 'monospace',
        fontSize: `${RACE.lapTimeFontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 6);

    this.totalTimeText = scene.add
      .text(x, totalTimeY, `TOTAL ${formatLapMs(0)}`, {
        fontFamily: 'monospace',
        fontSize: `${RACE.totalTimeFontSize}px`,
        color: DIM_COLOR,
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 4);

    // V2 — posición en vivo: oculta en práctica (nunca se llama setPosition).
    this.positionText = scene.add
      .text(x, positionY, '', {
        fontFamily: 'monospace',
        fontSize: `${RACE.lapBadgeFontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 6)
      .setVisible(false);

    // V3 (#14) — gap a los rivales de adelante/atrás: discreto, mismo estilo
    // del tiempo total (dim + stroke fino). Oculto hasta el primer `setGaps`.
    this.gapText = scene.add
      .text(x, gapY, '', {
        fontFamily: 'monospace',
        fontSize: `${RACE_VS_CPU.gapFontSize}px`,
        color: DIM_COLOR,
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 4)
      .setVisible(false);

    // V3 (#14) — chip "GRAN PREMIO · MÓNACO · DIFÍCIL": cierra la columna.
    // Oculto salvo que la rama vs CPU lo alimente (`setInfoChip`).
    this.infoChipText = scene.add
      .text(x, infoChipY, '', {
        fontFamily: 'monospace',
        fontSize: `${RACE_VS_CPU.infoChipFontSize}px`,
        color: DIM_COLOR,
      })
      .setOrigin(0, 0.5)
      .setStroke(STROKE_COLOR, 4)
      .setVisible(false);

    this.container.add([
      this.lapBadgeText,
      this.lapTimeText,
      this.totalTimeText,
      this.positionText,
      this.gapText,
      this.infoChipText,
    ]);
  }

  /**
   * Repinta el badge de vuelta. Repinta sólo si cambió el texto formateado
   * (el update de la escena llama por frame).
   */
  setLap(lap: number, totalLaps: number): void {
    const badge = formatLapBadge(lap, totalLaps);
    if (badge !== this.lastBadge) {
      this.lastBadge = badge;
      this.lapBadgeText.setText(badge);
    }
  }

  /** Repinta los tiempos (vuelta en curso y total, ms). */
  setTimings(currentLapMs: number, totalMs: number): void {
    const lapTime = formatLapMs(currentLapMs);
    if (lapTime !== this.lastLapTime) {
      this.lastLapTime = lapTime;
      this.lapTimeText.setText(lapTime);
    }
    const totalTime = `TOTAL ${formatLapMs(totalMs)}`;
    if (totalTime !== this.lastTotalTime) {
      this.lastTotalTime = totalTime;
      this.totalTimeText.setText(totalTime);
    }
  }

  /**
   * V2 (multi) — badge de posición en vivo "P3/8" (ranking de `rankCars`).
   * Repinta sólo si cambió; la primera llamada muestra el badge (en práctica
   * no se llama y queda oculto).
   */
  setPosition(position: number, total: number): void {
    const label = `P${Math.max(1, Math.floor(position))}/${Math.max(1, Math.floor(total))}`;
    if (label !== this.lastPosition) {
      this.lastPosition = label;
      this.positionText.setText(label).setVisible(true);
    }
  }

  /**
   * V3 (#14) — gaps en segundos a los rivales de adelante/atrás (null = sin
   * vecino de ese lado o velocidad propia muy baja para estimar). Repinta
   * sólo si cambió el texto; sin vecinos oculta la línea.
   */
  setGaps(aheadSeconds: number | null, behindSeconds: number | null): void {
    const label = formatRaceGaps(aheadSeconds, behindSeconds);
    if (label === this.lastGaps) {
      return;
    }
    this.lastGaps = label;
    if (label.length > 0) {
      this.gapText.setText(label).setVisible(true);
    } else {
      this.gapText.setVisible(false);
    }
  }

  /**
   * V3 (#14) — chip de contexto "GRAN PREMIO · MÓNACO · DIFÍCIL" (sólo lo
   * llama la rama vs CPU; etiqueta vacía no lo muestra). Repinta sólo si
   * cambió.
   */
  setInfoChip(trackName: string, difficultyLabel: string): void {
    const label = formatGrandPrixChip(trackName, difficultyLabel);
    if (label === this.lastInfoChip) {
      return;
    }
    this.lastInfoChip = label;
    this.infoChipText.setText(label).setVisible(true);
  }

  destroy(): void {
    this.container.destroy();
  }
}
