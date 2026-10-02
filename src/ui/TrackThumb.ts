/**
 * TrackThumb — miniatura del trazado de una pista (issue #9, V2).
 *
 * Widget de presentación puro para el picker de pistas del lobby: dibuja UNA
 * vez el contorno del `TrackPath` a escala (la matemática vive en
 * `race/minimap.ts`, la misma del MiniMap) sobre un panel redondeado, más un
 * punto marcando la meta (s=0). Cero Graphics dinámicos: se construye y ya.
 */

import Phaser from 'phaser';
import { computeMiniMapTransform, miniMapContour } from '../race/minimap';
import type { TrackPath } from '../race/trackPath';
import { TEXTURE_KEYS } from '../systems/TextureFactory';

/** Color del panel de la miniatura. */
const PANEL_COLOR = 0x0c0c14;
/** Alfa del panel (los thumbnails viven sobre el velo del lobby). */
const PANEL_ALPHA = 0.9;
/** Grosor del borde del panel (px). */
const BORDER_PX = 3;
/** Color y grosor del contorno de la pista. */
const CONTOUR_COLOR = 0xe8e6e0;
const CONTOUR_WIDTH_PX = 3;
/** Color de la meta (oro del repo) y escala del punto que la marca. */
const START_DOT_COLOR = 0xf7c531;
const START_DOT_SCALE = 2;
/** Padding interno entre el borde del panel y el contorno (px). */
const THUMB_PADDING = 8;

export interface TrackThumbConfig {
  /** Centro X del thumbnail (px de pantalla). */
  readonly x: number;
  /** Centro Y del thumbnail (px de pantalla). */
  readonly y: number;
  /** Lado del cuadrado (px). */
  readonly size?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class TrackThumb {
  readonly container: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    path: TrackPath,
    config: TrackThumbConfig,
  ) {
    const { x, y, size = 88, depth = 0 } = config;

    this.container = scene.add.container(x, y).setDepth(depth);
    this.container.add(
      scene.add.rectangle(0, 0, size, size, PANEL_COLOR, PANEL_ALPHA).setStrokeStyle(BORDER_PX, CONTOUR_COLOR),
    );

    const transform = computeMiniMapTransform(path, size, THUMB_PADDING);
    const contour = scene.make.graphics({ x: 0, y: 0 }, false);
    contour.lineStyle(CONTOUR_WIDTH_PX, CONTOUR_COLOR, 1);
    const points = miniMapContour(path, transform).map((p) =>
      new Phaser.Math.Vector2(p.x - size / 2, p.y - size / 2),
    );
    contour.strokePoints(points, true);
    this.container.add(contour);

    // Punto de la meta (s=0): orientación visual del trazado.
    const start = path.sample(0);
    const startLocal = {
      x: start.x * transform.scale + transform.offsetX - size / 2,
      y: start.y * transform.scale + transform.offsetY - size / 2,
    };
    this.container.add(
      scene.add
        .image(startLocal.x, startLocal.y, TEXTURE_KEYS.particle)
        .setScale(START_DOT_SCALE)
        .setTint(START_DOT_COLOR),
    );
  }

  destroy(): void {
    this.container.destroy();
  }
}
