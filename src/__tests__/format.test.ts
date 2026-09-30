import { describe, expect, it } from 'vitest';
import { DISTANCE_METERS_PER_PIXEL } from '../config/balance';
import { formatDistance, formatScore } from '../ui/format';

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
