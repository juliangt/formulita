import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  CIRCUIT,
  MAX_SPEED,
  MIN_SPEED,
  RACE,
  RACE_AI,
  RACE_VS_CPU,
  SPAWN,
  TRACK,
} from '../config/balance';
import { GAME_WIDTH } from '../config/gameConfig';
import { TRACKS, buildTrackPath } from '../race/tracks';
import { buildRacingLine } from '../race/ai/racingLine';
import { computeMiniMapTransform, miniMapContour } from '../race/minimap';

/**
 * Tests de regresión del issue #18 (pista agrandada, Fase 2).
 *
 * La Fase 1 escaló el mundo del circuito ×2.5 (waypoints, `widthPx`, mundo
 * 7000×7000, pasos de muestreo, offsets de IA y parrilla) y subió
 * `RACE.cameraZoom` de 0.8 a 2.2 para que el ASFALTO visible ocupe ≥ 80% del
 * ancho de pantalla (720 px). Las velocidades escalaron ×2.5 y los turn rates
 * NO cambiaron: la equivalencia a escala mantiene el gameplay relativo (y los
 * récords) intactos.
 *
 * Este archivo fija el CRITERIO del issue y las invariantes de escala para que
 * nadie las regrese sin notarse. Los valores se leen de `TRACKS` y `balance`
 * (cero números de pista duplicados); los pins exactos documentan decisiones
 * de diseño: retunearlos exige actualizar estos tests a conciencia.
 *
 * Lo que ya cubren otros tests y acá NO se duplica:
 * - `tracks.test.ts`: cierre/auto-intersección/radio de curvatura, banda de
 *   vuelta en px, waypoints dentro del mundo (margen literal 250) y
 *   `worldSize` 7000 para las 6.
 * - `gridOrder.test.ts`: consumo de los offsets de parrilla (coherencia
 *   geométrica de las posiciones y `lateral < widthPx/2`).
 * - `balance.test.ts`: coherencia RELACIONAL del modo batalla (max > base >
 *   min, layout simétrico de `TRACK`, tiling). Acá sólo se pinnean valores
 *   históricos exactos como borde del issue (#18 no debía tocarlos).
 */

describe('issue #18 — criterio del 80%: el asfalto llena la pantalla', () => {
  // El criterio del issue: widthPx × cameraZoom ≥ 80% del ancho de diseño.
  const criterio = 0.8 * GAME_WIDTH;

  it('RACE.cameraZoom mantiene el valor de diseño 2.2 (era 0.8 antes del issue)', () => {
    expect(RACE.cameraZoom).toBe(2.2);
  });

  for (const def of TRACKS) {
    it(`${def.name}: widthPx ${def.widthPx} × zoom ≥ 80% de ${GAME_WIDTH} px`, () => {
      const asfaltoVisible = def.widthPx * RACE.cameraZoom;
      expect(asfaltoVisible).toBeGreaterThanOrEqual(criterio);
    });
  }

  it('la pista más angosta (Mónaco) es la que manda: sin ella no hay criterio', () => {
    const masAngosta = Math.min(...TRACKS.map((t) => t.widthPx));
    expect(masAngosta * RACE.cameraZoom).toBeGreaterThanOrEqual(criterio);
  });
});

describe('issue #18 — mundo escalado coherente (×2.5: 2800 → 7000)', () => {
  for (const def of TRACKS) {
    it(`${def.name}: mundo 7000×7000 y TODO el asfalto dentro de los bounds`, () => {
      // Regresión: que nadie vuelva a 2800 sin escalar lo demás.
      expect(def.worldSize.width).toBe(7000);
      expect(def.worldSize.height).toBe(7000);
      // Los waypoints deben dejar lugar al asfalto completo: margen al borde
      // del mundo ≥ widthPx / 2 (el eje + media calzada dentro siempre).
      const half = def.widthPx / 2;
      for (const wp of def.waypoints) {
        expect(wp.x).toBeGreaterThanOrEqual(half);
        expect(wp.y).toBeGreaterThanOrEqual(half);
        expect(wp.x).toBeLessThanOrEqual(def.worldSize.width - half);
        expect(wp.y).toBeLessThanOrEqual(def.worldSize.height - half);
      }
    });
  }
});

describe('issue #18 — equivalencia a escala (récords válidos)', () => {
  it('las velocidades del circuito escalaron ×2.5 junto al mundo', () => {
    // Pins del diseño (valores pre-escala: 300/240/640/130/180). Si el mundo
    // y la velocidad escalan IGUAL, el gameplay relativo (y los récords en
    // tiempo de vuelta) no cambia.
    expect(CIRCUIT.maxSpeed).toBe(750);
    expect(CIRCUIT.acceleration).toBe(600);
    expect(CIRCUIT.brakeDeceleration).toBe(1600);
    expect(CIRCUIT.coastDrag).toBe(325);
    expect(CIRCUIT.referenceSpeed).toBe(450);
  });

  it('los turn rates NO escalaron (los rad/s son adimensionales al mundo)', () => {
    expect(CIRCUIT.turnRateBase).toBe(3.4);
    expect(CIRCUIT.turnRateAtMaxSpeed).toBe(1.2);
  });

  for (const def of TRACKS) {
    it(`${def.name}: una vuelta a referenceSpeed dura ${CIRCUIT.lapMinSeconds}–${CIRCUIT.lapMaxSeconds} s`, () => {
      // Check directo del issue en segundos (tracks.test.ts valida la banda
      // equivalente en px): mundo ×2.5 + velocidad ×2.5 ⇒ vuelta ~40 s
      // intacta. El objetivo declarado de cada pista cae dentro de la banda.
      const lapSeconds = buildTrackPath(def).totalLength / CIRCUIT.referenceSpeed;
      expect(lapSeconds).toBeGreaterThanOrEqual(CIRCUIT.lapMinSeconds);
      expect(lapSeconds).toBeLessThanOrEqual(CIRCUIT.lapMaxSeconds);
      expect(def.lapTargetMs / 1000).toBeGreaterThanOrEqual(CIRCUIT.lapMinSeconds);
      expect(def.lapTargetMs / 1000).toBeLessThanOrEqual(CIRCUIT.lapMaxSeconds);
    });
  }
});

describe('issue #18 — pasos de muestreo consistentes (×2.5 vía API pública)', () => {
  for (const def of TRACKS) {
    const path = buildTrackPath(def);
    const line = buildRacingLine(path, def.widthPx);

    it(`${def.name}: paso denso del TrackPath ≈ 30 px (el viejo 12 ya no vale)`, () => {
      // DENSE_SPACING es privado; el paso REAL medio es público y estable:
      // totalLength / pointsCount. Hoy ≈ 29.3–29.7 (≤ 30 por el ceil); con el
      // viejo paso de 12 daría ~11.7 y con 60 daría ~57: fuera de banda.
      const meanStep = path.totalLength / path.pointsCount;
      expect(meanStep).toBeGreaterThan(15);
      expect(meanStep).toBeLessThanOrEqual(30.5);
    });

    it(`${def.name}: paso de la línea de carrera ≈ 25 px y contorno del minimapa con los mismos puntos`, () => {
      // RacingLine.stepPx es público: L / round(L / 25) ≈ 25 (el viejo 10
      // daría ~10). El contorno del minimapa muestrea a ~120 px de arco:
      // ~152 puntos con el mundo actual (el viejo paso 48 daría ~378 y un
      // mundo sin escalar daría ~61 — ambos fuera de banda).
      expect(line.stepPx).toBeGreaterThan(20);
      expect(line.stepPx).toBeLessThanOrEqual(30);
      const transform = computeMiniMapTransform(path, RACE.miniMapSize, RACE.miniMapPadding);
      const contourPoints = miniMapContour(path, transform).length;
      expect(contourPoints).toBeGreaterThanOrEqual(125);
      expect(contourPoints).toBeLessThanOrEqual(175);
    });
  }
});

describe('issue #18 — parrilla de salida escalada (px de mundo ×2.5)', () => {
  // Pins de la recalibración (pre-escala: 70/35/140). gridOrder.test.ts ya
  // valida el CONSUMO geométrico de estos offsets; acá se fijan los valores.
  it('gridRowStepPx / gridLateralOffsetPx / gridStartOffsetPx = 175 / 88 / 350', () => {
    expect(CIRCUIT.gridRowStepPx).toBe(175);
    expect(CIRCUIT.gridLateralOffsetPx).toBe(88);
    expect(CIRCUIT.gridStartOffsetPx).toBe(350);
  });

  it('la parrilla escalada sigue cabiendo en una vuelta de cualquier pista', () => {
    // 10 jugadores ⇒ 5 filas: la última no debe envolver pasada la meta.
    const minLap = CIRCUIT.lapMinSeconds * CIRCUIT.referenceSpeed;
    const gridDepth = CIRCUIT.gridStartOffsetPx + 4 * CIRCUIT.gridRowStepPx;
    expect(gridDepth).toBeLessThan(minLap);
  });
});

describe('issue #18 — la IA vs CPU escaló sus px con el mundo', () => {
  it('los px/px-s de mira, errores y adelantamiento mantienen la recalibración ×2.5', () => {
    // Pre-escala: lookahead 120, gap 240, desvío 34, lateral 170, goma 600,
    // error 45/26/12, gap mínimo propio 30 (en RACE_VS_CPU).
    expect(RACE_AI.lookAheadPx).toBe(300);
    expect(RACE_AI.overtakeGapPx).toBe(600);
    expect(RACE_AI.overtakeSidePx).toBe(85);
    expect(RACE_AI.overtakeLateralSpeedPx).toBe(425);
    expect(RACE_AI.rubberBandFullGapPx).toBe(1500);
    expect(RACE_AI.mistakeMagPx).toEqual({ easy: 113, normal: 65, hard: 30 });
    expect(RACE_VS_CPU.gapMinOwnSpeedPx).toBe(75);
  });

  it('lo adimensional de la IA no escaló (rad, ms, fracciones, probabilidades)', () => {
    expect(RACE_AI.steerDeadzoneRad).toBe(0.06);
    expect(RACE_AI.mistakeMs).toBe(500);
    expect(RACE_AI.mistakeLateralChance).toBe(0.5);
    expect(RACE_AI.rubberBandPct).toEqual({ easy: 0.06, normal: 0.03, hard: 0.01 });
  });
});

describe('issue #18 — modo batalla intacto (fuera del alcance del issue)', () => {
  // balance.test.ts ya valida la COHERENCIA interna de estos bloques (orden
  // de velocidades, layout simétrico, tiling); acá se pinnean valores
  // históricos exactos como borde del issue: el escalado ×2.5 era SOLO del
  // circuito, ningún px de la batalla debía moverse.
  it('velocidades de la batalla sin tocar', () => {
    expect(BASE_SPEED).toBe(360);
    expect(MAX_SPEED).toBe(504);
    expect(MIN_SPEED).toBe(190);
  });

  it('layout del asfalto de la batalla sin tocar', () => {
    expect(TRACK.width).toBe(720);
    expect(TRACK.roadLeft).toBe(76);
    expect(TRACK.roadRight).toBe(644);
  });

  it('spawns de la batalla sin tocar', () => {
    expect(SPAWN.laneCount).toBe(4);
    expect(SPAWN.spawnY).toBe(-96);
    expect(SPAWN.despawnY).toBe(1376);
  });
});
