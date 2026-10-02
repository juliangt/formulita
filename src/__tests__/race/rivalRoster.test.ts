import { describe, expect, it } from 'vitest';
import { MULTIPLAYER, RACE_AI } from '../../config/balance';
import {
  buildRivalRoster,
  rivalDriverConfig,
  type Rival,
} from '../../race/ai/rivalRoster';
import type { CpuDifficulty } from '../../race/results';

/**
 * QA issue #14 V1 — el roster de los 7 rivales CPU (`race/ai/rivalRoster.ts`),
 * SIN Phaser: la misma (seed, dificultad) devuelve EXACTAMENTE los mismos
 * rivales (personalidad, nombre, color y seed propia derivada) — la carrera
 * es reproducible de punta a punta.
 *
 * - 7 rivales (`RACE_AI.rivalCount`), peerIds canónicos únicos (`rival-0..6`).
 * - Nombres y paleta distintos: cada rival toma un índice DISTINTO de
 *   `MULTIPLAYER.palette`, sin el 0 (el rojo F1 es del jugador).
 * - Personalidad dentro de rango: speedScale = 1 ± speedPctSpread,
 *   aggression ∈ [0, 1), |lineOffsetPx| ≤ lineOffsetSpreadPx.
 * - Seeds derivadas: distintas ENTRE rivales (cada uno reproducible por
 *   separado) y sensibles a la seed de carrera.
 * - `rivalDriverConfig` resuelve preset × personalidad: la dificultad ordena
 *   el ritmo (easy < normal < hard) y la agresividad recorta el margen de
 *   frenada — ÚNICO lugar donde se resuelven los presets.
 */

/** Seeds fijas de los tests (cualquiera sirve: todo es determinista). */
const TEST_SEED = 20260101;
const OTHER_SEED = 987654321;

const DIFFICULTIES: readonly CpuDifficulty[] = ['easy', 'normal', 'hard'];

describe('buildRivalRoster — forma del roster', () => {
  it('devuelve RACE_AI.rivalCount rivales con peerIds únicos', () => {
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    expect(roster).toHaveLength(RACE_AI.rivalCount);
    expect(RACE_AI.rivalCount).toBe(7);
    expect(new Set(roster.map((rival) => rival.peerId)).size).toBe(RACE_AI.rivalCount);
    // peerIds canónicos de parrilla (mismo contrato que el multi).
    expect(roster.map((rival) => rival.peerId)).toEqual(
      roster.map((_, i) => `rival-${i}`),
    );
  });

  it('nombres visibles y distintos entre sí', () => {
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    const names = roster.map((rival) => rival.name);
    expect(new Set(names).size).toBe(roster.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('colores de paleta: índices distintos, nunca el 0 (rojo del jugador)', () => {
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    const indices = roster.map((rival) => rival.paletteIndex);
    expect(new Set(indices).size).toBe(roster.length);
    for (const rival of roster) {
      expect(rival.paletteIndex).toBeGreaterThanOrEqual(1);
      expect(rival.paletteIndex).toBeLessThan(MULTIPLAYER.palette.length);
      expect(rival.color).toBe(MULTIPLAYER.palette[rival.paletteIndex]);
    }
  });
});

describe('buildRivalRoster — personalidad dentro de rango', () => {
  it('speedScale = 1 ± speedPctSpread (el rival rápido es rápido en todo)', () => {
    const roster = buildRivalRoster(TEST_SEED, 'hard');
    for (const rival of roster) {
      expect(rival.speedScale).toBeGreaterThanOrEqual(1 - RACE_AI.speedPctSpread);
      expect(rival.speedScale).toBeLessThanOrEqual(1 + RACE_AI.speedPctSpread);
    }
    // La personalidad NO es clonada: hay rivales por encima y por debajo de 1.
    const speeds = roster.map((rival) => rival.speedScale);
    expect(Math.max(...speeds)).toBeGreaterThan(Math.min(...speeds));
  });

  it('aggression ∈ [0, 1) y |lineOffsetPx| ≤ lineOffsetSpreadPx', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const rival of buildRivalRoster(TEST_SEED, difficulty)) {
        expect(rival.aggression).toBeGreaterThanOrEqual(0);
        expect(rival.aggression).toBeLessThan(1);
        expect(Math.abs(rival.lineOffsetPx)).toBeLessThanOrEqual(
          RACE_AI.lineOffsetSpreadPx,
        );
      }
    }
  });

  it('la personalidad varía entre rivales (no todos sacaron el mismo roll)', () => {
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    expect(new Set(roster.map((rival) => rival.aggression)).size).toBeGreaterThan(1);
    expect(new Set(roster.map((rival) => rival.lineOffsetPx)).size).toBe(roster.length);
  });
});

describe('buildRivalRoster — determinismo y seeds derivadas', () => {
  it('misma (seed, dificultad) dos veces ⇒ EXACTAMENTE los mismos rivales', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = buildRivalRoster(TEST_SEED, difficulty);
      const b = buildRivalRoster(TEST_SEED, difficulty);
      expect(a).toEqual(b);
    }
  });

  it('otra seed cambia la personalidad (la carrera no es idéntica para siempre)', () => {
    const a = buildRivalRoster(TEST_SEED, 'normal');
    const b = buildRivalRoster(OTHER_SEED, 'normal');
    expect(a).not.toEqual(b);
  });

  it('las seeds derivadas son distintas ENTRE rivales y sensibles a la seed', () => {
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    const seeds = roster.map((rival) => rival.seed);
    expect(new Set(seeds).size).toBe(roster.length);
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThan(0);
    }
    // Misma seed de carrera ⇒ mismas seeds derivadas; otra seed ⇒ otras.
    expect(buildRivalRoster(TEST_SEED, 'normal').map((r) => r.seed)).toEqual(seeds);
    const other = buildRivalRoster(OTHER_SEED, 'normal').map((rival) => rival.seed);
    expect(other).not.toEqual(seeds);
  });

  it('el orden del roster es canónico (sin mezclar: la parrilla mezcla aparte)', () => {
    // Dos seeds distintos: los NOMBRES en orden son los mismos (orden fijo);
    // la permutación de parrilla es cosa de assignGridOrder, no del roster.
    const a = buildRivalRoster(TEST_SEED, 'normal');
    const b = buildRivalRoster(OTHER_SEED, 'normal');
    expect(a.map((rival) => rival.name).join('|')).toBe(
      b.map((rival) => rival.name).join('|'),
    );
  });
});

describe('rivalDriverConfig — preset de dificultad × personalidad', () => {
  const roster = buildRivalRoster(TEST_SEED, 'normal');
  const rival: Rival = roster[0];

  it('la dificultad ordena el ritmo: easy < normal < hard en AMBOS presets', () => {
    const configs = DIFFICULTIES.map((difficulty) => rivalDriverConfig(rival, difficulty));
    const fractions = configs.map((config) => config.targetSpeedFraction);
    const scales = configs.map((config) => config.lineSpeedScale);
    expect(fractions[0]).toBeLessThan(fractions[1]);
    expect(fractions[1]).toBeLessThan(fractions[2]);
    expect(scales[0]).toBeLessThan(scales[1]);
    expect(scales[1]).toBeLessThan(scales[2]);
    // La personalidad escala AMBOS presets por el mismo factor.
    for (const difficulty of DIFFICULTIES) {
      const config = rivalDriverConfig(rival, difficulty);
      expect(config.targetSpeedFraction).toBeCloseTo(
        RACE_AI.targetSpeedFraction[difficulty] * rival.speedScale,
        12,
      );
      expect(config.lineSpeedScale).toBeCloseTo(
        RACE_AI.lineSpeedScale[difficulty] * rival.speedScale,
        12,
      );
    }
  });

  it('el cap de recta nunca supera maxSpeed (fracción clampeada a [0, 1])', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const entry of roster) {
        const config = rivalDriverConfig(entry, difficulty);
        expect(config.targetSpeedFraction).toBeGreaterThanOrEqual(0);
        expect(config.targetSpeedFraction).toBeLessThanOrEqual(1);
        expect(config.lineSpeedScale).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('la agresividad efectiva recorta el margen de frenada (los agresivos frenan tarde)', () => {
    // El más agresivo del roster frena con MENOS margen que el más timido
    // (orden por la agresividad EFECTIVA del config, no la cruda).
    const byAggression = [...roster]
      .map((entry) => ({ entry, config: rivalDriverConfig(entry, 'normal') }))
      .sort((a, b) => a.config.aggression - b.config.aggression);
    const shy = byAggression[0].config;
    const wild = byAggression[byAggression.length - 1].config;
    expect(wild.brakeMarginSpeedPx).toBeLessThan(shy.brakeMarginSpeedPx);

    // Y el valor es exactamente la fórmula documentada en RACE_AI, ahora con
    // la agresividad EFECTIVA (preset desviado por la personalidad).
    for (const entry of roster) {
      const config = rivalDriverConfig(entry, 'hard');
      expect(config.brakeMarginSpeedPx).toBeCloseTo(
        RACE_AI.brakeMarginSpeedPx * (1 - config.aggression * RACE_AI.aggressionBrakeGain),
        12,
      );
    }
  });

  it('la agresividad EFECTIVA = base del preset ± spread, clampeada a [0, 1]', () => {
    for (const difficulty of DIFFICULTIES) {
      const base = RACE_AI.aggression[difficulty];
      for (const entry of roster) {
        const config = rivalDriverConfig(entry, difficulty);
        const expected = Math.min(
          Math.max(base + (entry.aggression - 0.5) * 2 * RACE_AI.aggressionSpread, 0),
          1,
        );
        expect(config.aggression).toBeCloseTo(expected, 12);
        expect(config.aggression).toBeGreaterThanOrEqual(0);
        expect(config.aggression).toBeLessThanOrEqual(1);
      }
      // La media del roster ronda la base del preset (desvía DENTRO).
      const mean =
        roster.reduce((sum, entry) => sum + rivalDriverConfig(entry, difficulty).aggression, 0) /
        roster.length;
      expect(Math.abs(mean - base)).toBeLessThanOrEqual(RACE_AI.aggressionSpread);
    }
  });

  it('los presets V2 ordenan por dificultad: velocidad, errores, agresión y goma', () => {
    // Tabla del issue #14: fácil lento y humano, difícil rápido y quirúrgico.
    for (const rival of buildRivalRoster(TEST_SEED, 'normal')) {
      const configs = DIFFICULTIES.map((difficulty) => rivalDriverConfig(rival, difficulty));
      for (const key of [
        'targetSpeedFraction',
        'lineSpeedScale',
        'mistakeEverySec',
        'aggression',
      ] as const) {
        expect(configs[0][key]).toBeLessThan(configs[1][key]);
        expect(configs[1][key]).toBeLessThan(configs[2][key]);
      }
      for (const key of ['mistakeMagPx', 'rubberBandPct'] as const) {
        expect(configs[0][key]).toBeGreaterThan(configs[1][key]);
        expect(configs[1][key]).toBeGreaterThan(configs[2][key]);
      }
    }
    // Y los presets de balance respetan la tabla del issue.
    expect(RACE_AI.targetSpeedFraction.easy).toBeGreaterThan(0.7);
    expect(RACE_AI.targetSpeedFraction.hard).toBeLessThanOrEqual(1);
    expect(RACE_AI.rubberBandPct.easy).toBeGreaterThan(RACE_AI.rubberBandPct.hard);
    expect(RACE_AI.mistakeEverySec.easy).toBeLessThan(RACE_AI.mistakeEverySec.hard);
  });

  it('la trazada propia viaja intacta y los parámetros comunes salen de RACE_AI', () => {
    for (const entry of roster) {
      const config = rivalDriverConfig(entry, 'easy');
      expect(config.lineOffsetPx).toBe(entry.lineOffsetPx);
      expect(config.lookAheadPx).toBe(RACE_AI.lookAheadPx);
      expect(config.steerDeadzoneRad).toBe(RACE_AI.steerDeadzoneRad);
      expect(config.rubberBandPct).toBe(RACE_AI.rubberBandPct.easy);
      expect(config.mistakeEverySec).toBe(RACE_AI.mistakeEverySec.easy);
      expect(config.mistakeMagPx).toBe(RACE_AI.mistakeMagPx.easy);
    }
  });
});
