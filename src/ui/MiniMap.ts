/**
 * MiniMap — minimapa de la carrera en circuito (issue #9, V1).
 *
 * Widget de presentación puro (no conoce física ni escenas): recibe el
 * `TrackPath` de la pista y dibuja UNA vez el contorno a escala (la
 * matemática vive en `race/minimap.ts`, testeable headless) sobre un panel
 * semitransparente; por frame sólo reposiciona los puntos de los coches
 * (imágenes de la partícula procedural tintable — cero Graphics dinámicos
 * en update, PLAN_DESARROLLO.md §Riesgos).
 *
 * V2 (multi): `updateCars` acepta N coches con tinte (la paleta del roster);
 * V1 pasa sólo el auto del jugador.
 */

import Phaser from 'phaser';
import { RACE } from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import type { TrackPath } from '../race/trackPath';
import {
  computeMiniMapTransform,
  miniMapContour,
  worldToMiniMap,
} from '../race/minimap';

/** Color del panel semitransparente del minimapa. */
const PANEL_COLOR = 0x0c0c14;
/** Alfa del panel (semitransparente: se sigue viendo la pista debajo). */
const PANEL_ALPHA = 0.62;
/** Grosor del borde del panel (px). */
const BORDER_PX = 3;
/** Color y grosor del contorno de la pista. */
const CONTOUR_COLOR = 0xe8e6e0;
const CONTOUR_WIDTH_PX = 3;
/** Escala de la partícula 4×4 usada como punto de coche. */
const CAR_DOT_SCALE = 3;

/** Coche a dibujar sobre el minimapa. */
export interface MiniMapCar {
  /** Identidad estable del coche (V1: 'player'; V2: peerId). */
  readonly id: string;
  /** Posición en el mundo (px). */
  readonly x: number;
  readonly y: number;
  /** Tinte del punto (0xrrggbb; la paleta del roster en V2). */
  readonly tint: number;
}

export interface MiniMapConfig {
  /** Centro X del minimapa (px de pantalla). */
  readonly x: number;
  /** Centro Y del minimapa (px de pantalla). */
  readonly y: number;
  /** Lado del cuadrado (px). */
  readonly size?: number;
  /** Padding interno entre borde y contorno (px). */
  readonly padding?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class MiniMap {
  readonly container: Phaser.GameObjects.Container;

  private readonly transform: ReturnType<typeof computeMiniMapTransform>;
  private readonly size: number;
  private readonly dots = new Map<string, Phaser.GameObjects.Image>();

  constructor(
    scene: Phaser.Scene,
    path: TrackPath,
    config: MiniMapConfig,
  ) {
    const {
      x,
      y,
      size = RACE.miniMapSize,
      padding = RACE.miniMapPadding,
      depth = 0,
    } = config;

    this.size = size;
    this.transform = computeMiniMapTransform(path, size, padding);

    this.container = scene.add.container(x, y).setDepth(depth);

    // Panel semitransparente con borde (primitivas, nada interactivo).
    this.container.add(
      scene.add.rectangle(0, 0, size, size, PANEL_COLOR, PANEL_ALPHA).setStrokeStyle(BORDER_PX, CONTOUR_COLOR),
    );

    // Contorno de la pista: UNA vez en la construcción (Graphics de sólo
    // lectura a partir de acá: por frame no se redibuja nada). El contorno
    // vive en coords del panel (0..size) y se recentra al local (0,0).
    const contour = scene.make.graphics({ x: 0, y: 0 }, false);
    contour.lineStyle(CONTOUR_WIDTH_PX, CONTOUR_COLOR, 1);
    const points = miniMapContour(path, this.transform).map((p) =>
      new Phaser.Math.Vector2(p.x - size / 2, p.y - size / 2),
    );
    contour.strokePoints(points, true);
    this.container.add(contour);
  }

  /**
   * Sincroniza los puntos de los coches con la lista dada (llamado por
   * frame). Crea el punto la primera vez que aparece un id, lo reutiliza
   * después y destruye los que ya no viajan (coches eliminados en V2).
   */
  updateCars(cars: readonly MiniMapCar[]): void {
    const seen = new Set<string>();
    for (const car of cars) {
      seen.add(car.id);
      let dot = this.dots.get(car.id);
      if (!dot) {
        dot = this.container.scene.add
          .image(0, 0, TEXTURE_KEYS.particle)
          .setScale(CAR_DOT_SCALE)
          .setTint(car.tint);
        this.dots.set(car.id, dot);
        this.container.add(dot);
      }
      const point = worldToMiniMap(car.x, car.y, this.transform);
      dot.setPosition(point.x - this.size / 2, point.y - this.size / 2);
    }
    for (const [id, dot] of this.dots) {
      if (!seen.has(id)) {
        dot.destroy();
        this.dots.delete(id);
      }
    }
  }

  destroy(): void {
    this.container.destroy();
    this.dots.clear();
  }
}
