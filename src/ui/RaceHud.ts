/**
 * RaceHud — HUD de la carrera en circuito (issue #9, V1).
 *
 * Widget de presentación (mismo estilo que ScoreHud/EnergyBar: primitivas,
 * textos monospace con contorno, repinta sólo cuando cambia lo mostrado).
 * A diferencia del HUD de la fase BATALLA (conectado por EventBus), acá la
 * RaceScene lo alimenta por métodos directos: los datos salen del LapTracker
 * de la misma escena y V2 (multi) reutilizará el widget con los datos del
 * auto propio. No conoce sistemas ni bus.
 *
 * Contenido (posiciones en `RACE`, balance.ts):
 * - badge "VUELTA 2/3" (oro),
 * - tiempo de la vuelta en curso,
 * - tiempo total desde el GO!.
 */

import Phaser from 'phaser';
import { RACE } from '../config/balance';
import { formatLapBadge, formatLapMs } from './format';

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
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class RaceHud {
  readonly container: Phaser.GameObjects.Container;

  private readonly lapBadgeText: Phaser.GameObjects.Text;
  private readonly lapTimeText: Phaser.GameObjects.Text;
  private readonly totalTimeText: Phaser.GameObjects.Text;

  private lastBadge = '';
  private lastLapTime = '';
  private lastTotalTime = '';

  constructor(scene: Phaser.Scene, config: RaceHudConfig = {}) {
    const {
      x = RACE.hudX,
      lapBadgeY = RACE.lapBadgeY,
      lapTimeY = RACE.lapTimeY,
      totalTimeY = RACE.totalTimeY,
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

    this.container.add([this.lapBadgeText, this.lapTimeText, this.totalTimeText]);
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

  destroy(): void {
    this.container.destroy();
  }
}
