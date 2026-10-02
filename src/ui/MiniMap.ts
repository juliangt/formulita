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
 *
 * V3 (#14): destacado del auto PROPIO (punto más grande + halo, presentación
 * decidida por la función pura `miniMapDotPresentation`) — OPT-IN por init
 * (`highlightId`): sin la opción el look es exactamente el histórico, así la
 * práctica y el multi no cambian salvo que la escena lo pida.
 */

import Phaser from 'phaser';
import { RACE } from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import type { TrackPath } from '../race/trackPath';
import {
  computeMiniMapTransform,
  miniMapContour,
  miniMapDotPresentation,
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
  /**
   * V3 (#14) — id del coche a DESTACAR (el propio): punto más grande con
   * halo. Opt-in: `undefined` (default) mantiene el look clásico de V1/V2.
   */
  readonly highlightId?: string;
}

export class MiniMap {
  readonly container: Phaser.GameObjects.Container;

  private readonly transform: ReturnType<typeof computeMiniMapTransform>;
  private readonly size: number;
  private readonly highlightId: string | undefined;
  private readonly dots = new Map<string, Phaser.GameObjects.Image>();
  /** Halos de los puntos destacados (mismo id; viven DETRÁS de los puntos). */
  private readonly halos = new Map<string, Phaser.GameObjects.Image>();
  /**
   * Cantidad de hijos de presentación (panel + contorno) previos a los
   * puntos: los halos se insertan en ese índice para quedar por encima de la
   * pista y por DEBAJO de todos los coches.
   */
  private readonly baseChildCount: number;

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
      highlightId,
    } = config;

    this.size = size;
    this.highlightId = highlightId;
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

    this.baseChildCount = this.container.length;
  }

  /**
   * Sincroniza los puntos de los coches con la lista dada (llamado por
   * frame). Crea el punto la primera vez que aparece un id, lo reutiliza
   * después y destruye los que ya no viajan (coches eliminados en V2). El id
   * destacado (`highlightId`) escala su punto y le agrega un halo tenue.
   */
  updateCars(cars: readonly MiniMapCar[]): void {
    const seen = new Set<string>();
    for (const car of cars) {
      seen.add(car.id);
      const presentation = miniMapDotPresentation(car.id === this.highlightId);
      let dot = this.dots.get(car.id);
      if (!dot) {
        dot = this.container.scene.add
          .image(0, 0, TEXTURE_KEYS.particle)
          .setScale(presentation.scale)
          .setTint(car.tint);
        this.dots.set(car.id, dot);
        this.container.add(dot);
      }
      dot.setScale(presentation.scale);
      const point = worldToMiniMap(car.x, car.y, this.transform);
      const px = point.x - this.size / 2;
      const py = point.y - this.size / 2;
      dot.setPosition(px, py);
      if (presentation.halo) {
        let halo = this.halos.get(car.id);
        if (!halo) {
          halo = this.container.scene.add
            .image(0, 0, TEXTURE_KEYS.particle)
            .setTint(presentation.halo.tint);
          this.halos.set(car.id, halo);
          this.container.add(halo);
          // El halo entra por DEBAJO de todos los puntos (encima del panel).
          this.container.moveTo(halo, this.baseChildCount);
        }
        halo.setScale(presentation.halo.scale).setAlpha(presentation.halo.alpha);
        halo.setPosition(px, py);
      } else {
        this.halos.get(car.id)?.destroy();
        this.halos.delete(car.id);
      }
    }
    for (const [id, dot] of this.dots) {
      if (!seen.has(id)) {
        dot.destroy();
        this.dots.delete(id);
        this.halos.get(id)?.destroy();
        this.halos.delete(id);
      }
    }
  }

  destroy(): void {
    this.container.destroy();
    this.dots.clear();
    this.halos.clear();
  }
}
