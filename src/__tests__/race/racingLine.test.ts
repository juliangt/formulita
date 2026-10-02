import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import {
  buildRacingLine,
  RACING_LINE_EDGE_MARGIN_PX,
  type RacingLinePoint,
} from '../../race/ai/racingLine';
import { TrackPath } from '../../race/trackPath';
import { TRACKS, buildTrackPath } from '../../race/tracks';
import type { TrackDefinition } from '../../race/tracks';

/**
 * QA issue #14 V1 — la línea de carrera (`race/ai/racingLine.ts`), SIN
 * Phaser: geometría pura determinista que comparten los 7 rivales.
 *
 * - Muestreo: anillo equiespaciado (~25 px de arco desde el issue #18, que
 *   escaló el mundo ×2.5) que cubre el MISMO perímetro que el eje, con
 *   envoltura circular sana.
 * - targetSpeed por punto: velocidad máxima SOSTENIBLE según la curvatura
 *   local (misma resolución analítica de `turnRateAtSpeed` que la validación
 *   de pistas de #9), con factor de seguridad y recortada a maxSpeed. En las
 *   5 pistas queda en (0, maxSpeed], siempre muy por encima de la mitad de
 *   la referencia (ninguna curva del CPU es un muro): mínimos medidos 465
 *   (Suzuka) a 558 (Monza/Spa) contra referenceSpeed/2 = 225.
 * - Trazada: offset hacia el INTERIOR de cada curva (corte de apex) y al
 *   centro en recta, SIEMPRE dentro del asfalto con margen al borde
 *   (máximos medidos: 103–128 px contra topes de 110–153 px) y SIN zigzag
 *   (deltas entre puntos consecutivos medidos ≤ 14 px por paso de 25 px).
 * - Determinista: la misma (pista, ancho) devuelve exactamente la misma
 *   línea, punto por punto.
 */

/** Paso objetivo entre puntos de la línea (px de arco; constante del módulo). */
const STEP_PX = 25;

/** Tolerancia flotante para comparaciones geométricas. */
const EPS = 1e-6;

/** Círculo sintético perfecto: radio, ancho de asfalto y centro (#18: la
 * escala ×2.5 mantiene el fixture en el mismo régimen relativo del módulo). */
const CIRCLE_RADIUS_PX = 375;
const CIRCLE_WIDTH_PX = 300;
const CIRCLE_CENTER = { x: 3500, y: 3500 };
const CIRCLE_WAYPOINTS = 24;

/** Cuadrado sintético gigante: el tramo medio de cada lado es recta perfecta. */
const SQUARE_SIDE_PX = 200_000;

/** Punto medio del lado inferior del cuadrado (índice sobre el anillo). */
function squareMiddleBottomIndex(line: ReturnType<typeof buildRacingLine>): number {
  return line.indexAtS(SQUARE_SIDE_PX / 2);
}

/** Distancia de un punto al centro del círculo sintético. */
function distToCircleCenter(point: RacingLinePoint): number {
  return Math.hypot(point.x - CIRCLE_CENTER.x, point.y - CIRCLE_CENTER.y);
}

describe('buildRacingLine — muestreo y contrato del anillo (5 pistas)', () => {
  for (const track of TRACKS) {
    it(`${track.id}: anillo equiespaciado que cubre el perímetro del eje`, () => {
      const path = buildTrackPath(track);
      const line = buildRacingLine(path, track.widthPx);

      // Paso ~STEP_PX y un punto por paso (el anillo NO repite el primero).
      expect(line.pointCount).toBe(Math.max(8, Math.round(path.totalLength / STEP_PX)));
      expect(line.stepPx).toBeCloseTo(path.totalLength / line.pointCount, 6);
      expect(line.totalLength).toBeCloseTo(path.totalLength, 6);

      // s consecutivos separados por el paso; el cierre vuelve a envolver.
      for (let i = 0; i < line.pointCount; i += 1) {
        const a = line.pointAtIndex(i);
        const b = line.pointAtIndex(i + 1);
        const gap = b.s - a.s;
        if (i + 1 < line.pointCount) {
          expect(gap).toBeCloseTo(line.stepPx, 6);
        } else {
          // El punto "count" es el 0: la envoltura cierra el anillo.
          expect(gap).toBeCloseTo(-line.totalLength + line.stepPx, 6);
        }
        expect(a.s).toBeGreaterThanOrEqual(0);
        expect(a.s).toBeLessThan(line.totalLength);
      }

      // Envoltura: pointAtS es periódica en totalLength y el índice 0 es s=0.
      expect(line.pointAtS(0).s).toBe(0);
      const some = line.pointAtS(line.totalLength / 3);
      expect(line.pointAtS(line.totalLength / 3 + line.totalLength)).toEqual(some);
      expect(line.pointAtIndex(-1)).toEqual(line.pointAtIndex(line.pointCount - 1));
    });
  }
});

describe('buildRacingLine — targetSpeed sostenible por curvatura (5 pistas)', () => {
  for (const track of TRACKS) {
    it(`${track.id}: cada targetSpeed ∈ (0, maxSpeed] y ninguna curva es un muro`, () => {
      const path = buildTrackPath(track);
      const line = buildRacingLine(path, track.widthPx);

      for (let i = 0; i < line.pointCount; i += 1) {
        const point = line.pointAtIndex(i);
        expect(point.targetSpeed).toBeGreaterThan(0);
        expect(point.targetSpeed).toBeLessThanOrEqual(CIRCUIT.maxSpeed + EPS);
      }

      // Hay recta (alguien llega a la punta) Y hay frenada (alguien frena
      // muy por debajo del cap: la línea discrimina la curvatura).
      let minTs = Infinity;
      let maxTs = 0;
      for (let i = 0; i < line.pointCount; i += 1) {
        const ts = line.pointAtIndex(i).targetSpeed;
        minTs = Math.min(minTs, ts);
        maxTs = Math.max(maxTs, ts);
      }
      expect(maxTs).toBeCloseTo(CIRCUIT.maxSpeed, 0);
      // Medido: 465–558 px/s según pista (escala ×2.5 del issue #18) — muy
      // por encima de un muro.
      expect(minTs).toBeGreaterThan(CIRCUIT.referenceSpeed / 2);
      expect(minTs).toBeLessThan(CIRCUIT.maxSpeed * 0.85);
    });
  }
});

describe('buildRacingLine — trazada: apex, asfalto y suavidad (5 pistas)', () => {
  for (const track of TRACKS) {
    it(`${track.id}: |offset| dentro del asfalto, lineal por paso (sin zigzag)`, () => {
      const path = buildTrackPath(track);
      const line = buildRacingLine(path, track.widthPx);
      const maxOffset = track.widthPx / 2 - RACING_LINE_EDGE_MARGIN_PX;

      let maxDelta = 0;
      for (let i = 0; i < line.pointCount; i += 1) {
        const a = line.pointAtIndex(i);
        const b = line.pointAtIndex(i + 1);
        // Margen al borde: la línea nunca sale del asfalto.
        expect(Math.abs(a.offset)).toBeLessThanOrEqual(maxOffset + EPS);
        // Suavidad: el desplazamiento lateral por paso es acotado (medido
        // ≤ 5.7 px por paso de 10 px) — la recta no generará volantazos.
        maxDelta = Math.max(maxDelta, Math.abs(b.offset - a.offset));
      }
      // El par de CIERRRE (último → primero) también queda acotado: el
      // suavizado es circular y el anillo no tiene costura.
      const seam = Math.abs(
        line.pointAtIndex(line.pointCount - 1).offset - line.pointAtIndex(0).offset,
      );
      maxDelta = Math.max(maxDelta, seam);
      expect(maxDelta).toBeLessThanOrEqual(line.stepPx);
    });

    it(`${track.id}: cada punto queda en la normal del eje a SU offset`, () => {
      const path = buildTrackPath(track);
      const line = buildRacingLine(path, track.widthPx);
      for (let i = 0; i < line.pointCount; i += 1) {
        const point = line.pointAtIndex(i);
        const sample = path.sample(point.s);
        const normal = sample.angle + Math.PI / 2;
        expect(point.x).toBeCloseTo(sample.x + Math.cos(normal) * point.offset, 6);
        expect(point.y).toBeCloseTo(sample.y + Math.sin(normal) * point.offset, 6);
      }
    });
  }

  it('círculo sintético: la línea corta hacia el INTERIOR (apex) en toda la curva', () => {
    // Círculo perfecto de 24 waypoints: curvatura constante ⇒ la línea debe
    // quedar SIEMPRE más cerca del centro que el eje (corte de apex) y
    // dentro del asfalto. Valida el SIGNO del offset de punta a punta.
    const waypoints = Array.from({ length: CIRCLE_WAYPOINTS }, (_, i) => {
      const angle = (i / CIRCLE_WAYPOINTS) * Math.PI * 2;
      return {
        x: CIRCLE_CENTER.x + Math.cos(angle) * CIRCLE_RADIUS_PX,
        y: CIRCLE_CENTER.y + Math.sin(angle) * CIRCLE_RADIUS_PX,
      };
    });
    const path = new TrackPath(waypoints);
    const line = buildRacingLine(path, CIRCLE_WIDTH_PX);

    for (let i = 0; i < line.pointCount; i += 1) {
      const distance = distToCircleCenter(line.pointAtIndex(i));
      // Corte de apex: claramente por dentro del eje…
      expect(distance).toBeLessThan(CIRCLE_RADIUS_PX - CIRCLE_WIDTH_PX / 4);
      // …pero SIN salirse del asfalto por dentro (no es una cuerda).
      expect(distance).toBeGreaterThan(CIRCLE_RADIUS_PX - CIRCLE_WIDTH_PX / 2);
    }
  });

  it('recta sintética perfecta: offset al centro y targetSpeed en la punta', () => {
    // Cuadrado gigante (misma técnica del full-flow de #9): el tramo medio
    // de cada lado es una recta PERFECTA — ahí la línea converge al eje y
    // la velocidad objetivo es la punta.
    const square = new TrackPath([
      { x: 0, y: 0 },
      { x: SQUARE_SIDE_PX, y: 0 },
      { x: SQUARE_SIDE_PX, y: SQUARE_SIDE_PX },
      { x: 0, y: SQUARE_SIDE_PX },
    ]);
    const line = buildRacingLine(square, TRACKS[0].widthPx);
    const middle = line.pointAtIndex(squareMiddleBottomIndex(line));
    expect(Math.abs(middle.offset)).toBeLessThan(1);
    expect(middle.targetSpeed).toBe(CIRCUIT.maxSpeed);
  });
});

describe('buildRacingLine — determinismo', () => {
  it('la misma (pista, ancho) devuelve la misma línea, punto por punto', () => {
    for (const track of TRACKS) {
      const path = buildTrackPath(track);
      const a = buildRacingLine(path, track.widthPx);
      const b = buildRacingLine(path, track.widthPx);
      expect(a.pointCount).toBe(b.pointCount);
      expect(a.stepPx).toBe(b.stepPx);
      expect(a.totalLength).toBe(b.totalLength);
      for (let i = 0; i < a.pointCount; i += 1) {
        expect(a.pointAtIndex(i)).toEqual(b.pointAtIndex(i));
      }
    }
  });

  it('cada pista produce SU línea (los offsets dependen de SU curvatura)', () => {
    const monaco = buildRacingLine(buildTrackPath(getTrack('monaco')), getTrack('monaco').widthPx);
    const monza = buildRacingLine(buildTrackPath(getTrack('monza')), getTrack('monza').widthPx);
    expect(monaco.pointCount).toBe(monza.pointCount); // mismo perímetro ~18125
    // …pero los offsets difieren: cada trazada es función de SU curvatura.
    const differ = Array.from({ length: monaco.pointCount }, (_, i) =>
      monaco.pointAtIndex(i).offset !== monza.pointAtIndex(i).offset,
    ).some(Boolean);
    expect(differ).toBe(true);
  });
});

/** Pista por id con defensa de tipo (getTrackById puede devolver undefined). */
function getTrack(id: TrackDefinition['id']): TrackDefinition {
  const track = TRACKS.find((entry) => entry.id === id);
  if (!track) {
    throw new Error(`pista ausente: ${id}`);
  }
  return track;
}
