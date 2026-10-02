import { describe, expect, it } from 'vitest';
import { DISTANCE_METERS_PER_PIXEL } from '../config/balance';
import {
  formatDistance,
  formatGrandPrixChip,
  formatLapBadge,
  formatLapMs,
  formatRaceGaps,
  formatScore,
} from '../ui/format';

/**
 * Tests del formateo puro de la UI (Fase 5): los números que muestran el HUD
 * de carrera (`ScoreHud`) y la pantalla de resultados (`GameOverScene`).
 * Extraídos de las escenas a `ui/format.ts` para tener una sola fuente de
 * verdad del look arcade (ceros a la izquierda, m/km) y poder testearlo.
 */

describe('formatScore — marcador arcade de 6 dígitos', () => {
  it('rellena con ceros a la izquierda', () => {
    expect(formatScore(0)).toBe('000000');
    expect(formatScore(7)).toBe('000007');
    expect(formatScore(1234)).toBe('001234');
    expect(formatScore(999999)).toBe('999999');
  });

  it('trunca fraccionales hacia abajo (nunca redondea el puntaje hacia arriba)', () => {
    expect(formatScore(99.9)).toBe('000099');
    expect(formatScore(1500.9999)).toBe('001500');
  });

  it('es defensivo: NaN, infinitos y negativos muestran 0', () => {
    expect(formatScore(Number.NaN)).toBe('000000');
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('000000');
    expect(formatScore(Number.NEGATIVE_INFINITY)).toBe('000000');
    expect(formatScore(-1)).toBe('000000');
    expect(formatScore(-0.5)).toBe('000000');
  });

  it('un puntaje fuera de 6 dígitos no se recorta (crece a la derecha)', () => {
    expect(formatScore(1234567)).toBe('1234567');
  });
});

describe('formatDistance — metros por debajo del km, km después', () => {
  it('usa la conversión del balance (px → m)', () => {
    // 10 px = 1 m según DISTANCE_METERS_PER_PIXEL.
    expect(DISTANCE_METERS_PER_PIXEL).toBe(0.1);
    expect(formatDistance(10)).toBe('1 M');
    expect(formatDistance(5000)).toBe('500 M');
  });

  it('redondea al metro más cercano', () => {
    expect(formatDistance(95)).toBe('10 M'); // 9.5 m → 10
    expect(formatDistance(94)).toBe('9 M'); // 9.4 m → 9
  });

  it('cambia a KM con un decimal al llegar al kilómetro', () => {
    expect(formatDistance(9990)).toBe('999 M'); // 999 m: todavía en metros
    expect(formatDistance(10000)).toBe('1.0 KM'); // 1000 m exactos
    expect(formatDistance(12340)).toBe('1.2 KM'); // 1234 m
    expect(formatDistance(15000)).toBe('1.5 KM');
    expect(formatDistance(100000)).toBe('10.0 KM');
  });

  it('es defensivo: NaN, infinitos y negativos muestran 0 M', () => {
    expect(formatDistance(0)).toBe('0 M');
    expect(formatDistance(Number.NaN)).toBe('0 M');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0 M');
    expect(formatDistance(-500)).toBe('0 M');
  });
});

describe('formatLapMs — cronómetro de la carrera en circuito (V1)', () => {
  it('formatea M:SS.mmm', () => {
    expect(formatLapMs(0)).toBe('0:00.000');
    expect(formatLapMs(42_317)).toBe('0:42.317');
    expect(formatLapMs(63_456)).toBe('1:03.456');
    expect(formatLapMs(601_234)).toBe('10:01.234');
  });

  it('trunca los fraccionales de milisegundo (no redondea el cronómetro)', () => {
    expect(formatLapMs(42_317.9)).toBe('0:42.317');
  });

  it('es defensivo: NaN, infinitos y negativos muestran 0:00.000', () => {
    expect(formatLapMs(Number.NaN)).toBe('0:00.000');
    expect(formatLapMs(Number.POSITIVE_INFINITY)).toBe('0:00.000');
    expect(formatLapMs(Number.NEGATIVE_INFINITY)).toBe('0:00.000');
    expect(formatLapMs(-1)).toBe('0:00.000');
  });
});

describe('formatLapBadge — badge VUELTA n/N del HUD de carrera (V1)', () => {
  it('formatea la vuelta en curso sobre el total', () => {
    expect(formatLapBadge(1, 3)).toBe('VUELTA 1/3');
    expect(formatLapBadge(2, 3)).toBe('VUELTA 2/3');
    expect(formatLapBadge(3, 3)).toBe('VUELTA 3/3');
  });

  it('clampea la vuelta entrante a [1, totalLaps]', () => {
    expect(formatLapBadge(0, 3)).toBe('VUELTA 1/3');
    expect(formatLapBadge(-2, 3)).toBe('VUELTA 1/3');
    expect(formatLapBadge(9, 3)).toBe('VUELTA 3/3');
  });

  it('es defensivo: total inválido cae a 1 y NaN da vuelta 1', () => {
    expect(formatLapBadge(1, Number.NaN)).toBe('VUELTA 1/1');
    expect(formatLapBadge(Number.NaN, 3)).toBe('VUELTA 1/3');
    expect(formatLapBadge(2, 0)).toBe('VUELTA 1/1');
  });
});

describe('formatGrandPrixChip — chip de contexto del GRAN PREMIO (#14, V3)', () => {
  it('une modo, pista y dificultad con el separador del chip', () => {
    expect(formatGrandPrixChip('MÓNACO', 'DIFÍCIL')).toBe('GRAN PREMIO · MÓNACO · DIFÍCIL');
    expect(formatGrandPrixChip('MONZA', 'NORMAL')).toBe('GRAN PREMIO · MONZA · NORMAL');
  });

  it('omite los segmentos vacíos junto con su separador (nunca deja "· " colgando)', () => {
    expect(formatGrandPrixChip('', 'DIFÍCIL')).toBe('GRAN PREMIO · DIFÍCIL');
    expect(formatGrandPrixChip('SPA', '')).toBe('GRAN PREMIO · SPA');
    expect(formatGrandPrixChip('', '')).toBe('GRAN PREMIO');
  });

  it('es defensivo: espacios alrededor se recortan', () => {
    expect(formatGrandPrixChip('  SUZUKA  ', ' FÁCIL ')).toBe('GRAN PREMIO · SUZUKA · FÁCIL');
    expect(formatGrandPrixChip('   ', '   ')).toBe('GRAN PREMIO');
  });
});

describe('formatRaceGaps — línea de gaps del HUD vs CPU (#14, V3)', () => {
  it('muestra adelante (positivo) y atrás (negativo) con unidad y 1 decimal', () => {
    expect(formatRaceGaps(1.2, -0.8)).toBe('+1.2s -0.8s');
    expect(formatRaceGaps(30, -30)).toBe('+30.0s -30.0s');
  });

  it('con un solo vecino muestra sólo ese lado', () => {
    expect(formatRaceGaps(2.5, null)).toBe('+2.5s');
    expect(formatRaceGaps(null, -0.4)).toBe('-0.4s');
  });

  it('sin vecinos devuelve vacío (el HUD oculta la línea)', () => {
    expect(formatRaceGaps(null, null)).toBe('');
  });

  it('es defensivo: valores no finitos no se muestran', () => {
    expect(formatRaceGaps(Number.NaN, Number.POSITIVE_INFINITY)).toBe('');
    expect(formatRaceGaps(1, Number.NaN)).toBe('+1.0s');
    expect(formatRaceGaps(Number.NEGATIVE_INFINITY, -1)).toBe('-1.0s');
  });
});
