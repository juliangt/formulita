import { describe, expect, it } from 'vitest';
import { CIRCUIT, MAX_SPEED, MIN_SPEED } from '../../config/balance';
import { raceEngineSpeed } from '../../race/raceAudio';

/**
 * Tests del puente puro física del circuito → dron del motor (issue #9, V4).
 * El AudioManager (con el perfil móvil de #4 intacto) mapea velocidad →
 * frecuencia sobre el dominio de la BATALLA [MIN_SPEED, MAX_SPEED] px/s; la
 * velocidad del circuito vive en [0, CIRCUIT.maxSpeed] y `raceEngineSpeed`
 * la normaliza a ese dominio.
 */
describe('raceEngineSpeed — mapeo del circuito al dominio del dron (V4)', () => {
  it('auto detenido cae en el piso del dominio (MIN_SPEED)', () => {
    expect(raceEngineSpeed(0)).toBe(MIN_SPEED);
  });

  it('la punta del circuito cae en el techo del dominio (MAX_SPEED)', () => {
    expect(raceEngineSpeed(CIRCUIT.maxSpeed)).toBe(MAX_SPEED);
  });

  it('es lineal en la fracción speed/maxSpeed del circuito', () => {
    const quarter = raceEngineSpeed(CIRCUIT.maxSpeed / 4);
    const expected = MIN_SPEED + (MAX_SPEED - MIN_SPEED) / 4;
    expect(quarter).toBeCloseTo(expected, 9);
  });

  it('es monótona creciente en todo el rango del circuito', () => {
    let previous = raceEngineSpeed(0);
    for (let speed = 1; speed <= CIRCUIT.maxSpeed; speed += 10) {
      const current = raceEngineSpeed(speed);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('siempre devuelve valores dentro del dominio del dron', () => {
    expect(raceEngineSpeed(-50)).toBe(MIN_SPEED);
    expect(raceEngineSpeed(CIRCUIT.maxSpeed * 3)).toBe(MAX_SPEED);
    const mapped = raceEngineSpeed(CIRCUIT.maxSpeed / 2);
    expect(mapped).toBeGreaterThanOrEqual(MIN_SPEED);
    expect(mapped).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('es defensivo: NaN e infinitos caen al piso del dominio (no finitos = 0)', () => {
    expect(raceEngineSpeed(Number.NaN)).toBe(MIN_SPEED);
    expect(raceEngineSpeed(Number.POSITIVE_INFINITY)).toBe(MIN_SPEED);
  });
});
