import { describe, expect, it } from 'vitest';
import { assignGridOrder } from '../../race/gridOrder';
import { TrackPath } from '../../race/trackPath';
import { TRACKS, buildTrackPath } from '../../race/tracks';

/**
 * Tests de REGRESIÓN del criterio del issue #20 (Fase 2): la LARGADA es
 * hacia ARRIBA de la pantalla en las 6 pistas y la inversión de los
 * waypoints no cambió la geometría.
 *
 * La Fase 1 invirtió el orden de los waypoints de las 5 pistas (los MISMOS
 * puntos, listados en orden de carrera): la tangente del eje en s=0 — la que
 * `gridOrder` consume vía `path.sample(s).angle` para orientar la parrilla —
 * pasó a apuntar hacia ARRIBA (Δy < 0 y más vertical que horizontal). Como
 * la curva es CERRADA, recorrerla al revés conserva perímetro, polilínea
 * densa y radios de curvatura.
 *
 * FUENTE DE VERDAD: el ángulo se lee de `sample(0).angle`, el MISMO valor
 * que `assignGridOrder` copia a `slot.angle` (atan2-style con la y de
 * pantalla hacia abajo: "arriba" ⇒ sin(angle) < 0).
 *
 * Lo que ya cubren otros tests y acá NO se duplica:
 * - `tracks.test.ts`: cierre, auto-intersección, radio de curvatura y banda
 *   de vuelta de las 5 pistas.
 * - `gridOrder.test.ts`: determinismo, escalonado y laterales de la parrilla.
 * - `trackScale.test.ts`: pins del issue #18 (zoom, escalas, pasos).
 * - `raceControls.test.ts`: gas manual (puente input→física, teclas, táctil).
 */

describe('issue #20 — la tangente de largada apunta hacia ARRIBA (criterio)', () => {
  for (const def of TRACKS) {
    it(`${def.name}: sample(0) tiene Δy < 0 y es más vertical que horizontal`, () => {
      // El TrackPath REAL de la pista (no una reconstrucción del test): la
      // misma fuente de verdad que consume `gridOrder` para el heading
      // inicial de los autos.
      const path = buildTrackPath(def);
      const start = path.sample(0);

      // Phaser: y crece hacia abajo ⇒ "hacia arriba" es sin(angle) < 0.
      expect(Math.sin(start.angle)).toBeLessThan(0);
      // Más vertical que horizontal: la largada pinta la pantalla hacia
      // arriba, no en diagonal (criterio literal del issue).
      expect(Math.abs(Math.sin(start.angle))).toBeGreaterThan(
        Math.abs(Math.cos(start.angle)),
      );

      // Y el Δ de posición por unidad de arco (cómo AVANZA el eje) coincide
      // con el signo del ángulo: a 1 px de arco la muestra cae MÁS ARRIBA.
      const ahead = path.sample(1);
      const dx = ahead.x - start.x;
      const dy = ahead.y - start.y;
      expect(dy).toBeLessThan(0);
      expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
    });
  }
});

describe('issue #20 — la parrilla de salida mira hacia arriba', () => {
  // 8 autos = 4 filas: la parrilla completa del GRAN PREMIO.
  const roster = Array.from({ length: 8 }, (_, i) => ({ peerId: `peer-${i}` }));

  for (const def of TRACKS) {
    it(`${def.name}: la pole apunta hacia arriba y ninguna fila mira hacia abajo`, () => {
      const path = buildTrackPath(def);
      const grid = assignGridOrder(roster, 20, path);
      // Con pista, cada casilla copia `sample(s).angle` del eje: el MISMO
      // valor que orienta los autos en la escena (gridOrder.test.ts ya cubre
      // el escalonado; acá sólo importa el SIGNO vertical).
      const byIndex = [...grid].sort((a, b) => a.index - b.index);

      // Primera fila (pole + su par): hacia arriba y más vertical que
      // horizontal — el arranque completo respeta el criterio, no sólo s=0.
      for (const slot of byIndex.slice(0, 2)) {
        expect(slot.angle).toBeTypeOf('number');
        expect(Math.sin(slot.angle!)).toBeLessThan(0);
        expect(Math.abs(Math.sin(slot.angle!))).toBeGreaterThan(
          Math.abs(Math.cos(slot.angle!)),
        );
      }

      // Toda la parrilla vive en los últimos ~1000 px de arco (detrás de la
      // meta), que la inversión dejó apuntando hacia arriba.
      for (const slot of grid) {
        expect(Math.sin(slot.angle!)).toBeLessThan(0);
      }
    });
  }
});

describe('issue #20 — la inversión de waypoints no cambia la geometría', () => {
  // Pins del estado invertido (Fase 1): si retocar el orden de los waypoints
  // moviera el largo o la cantidad de puntos de control, esto lo grita.
  const WAYPOINT_COUNTS = {
    monaco: 30,
    monza: 26,
    silverstone: 28,
    spa: 30,
    suzuka: 32,
    galvez: 31,
  } as const;

  for (const def of TRACKS) {
    it(`${def.name}: perímetro en la banda pinneada 18.124–18.130 px`, () => {
      // Regresión de la inversión: mismo set de puntos ⇒ mismo perímetro (y
      // la banda de vuelta 36–44 s de tracks.test.ts sigue cerrando).
      const path = buildTrackPath(def);
      expect(path.totalLength).toBeGreaterThanOrEqual(18124);
      expect(path.totalLength).toBeLessThanOrEqual(18130);
    });

    it(`${def.name}: misma cantidad de waypoints que el diseño`, () => {
      expect(def.waypoints.length).toBe(WAYPOINT_COUNTS[def.id]);
    });

    it(`${def.name}: recorrer los MISMOS puntos al revés da el mismo perímetro`, () => {
      // Invariancia pura de la inversión: una curva cerrada recorrida en
      // sentido contrario conserva perímetro y polilínea densa.
      const path = buildTrackPath(def);
      const reversed = new TrackPath([...def.waypoints].reverse());
      expect(reversed.totalLength).toBeCloseTo(path.totalLength, 6);
      expect(reversed.pointsCount).toBe(path.pointsCount);
    });
  }
});
