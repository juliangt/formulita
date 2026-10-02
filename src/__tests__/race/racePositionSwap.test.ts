import { describe, expect, it } from 'vitest';
import { RACE_VS_CPU } from '../../config/balance';
import { PositionSwapDetector } from '../../race/racePositionSwap';

/**
 * Tests de la detección de cambio de posición propia (issue #14, V3): la
 * fuente del SFX de adelantamiento. Reglas del issue: máximo 1 sonido por
 * cambio y enfriamiento (~2 s) que no acumula deuda — la dirección siempre
 * se calcula contra la ÚLTIMA posición observada, sonara o no.
 */

const COOLDOWN_MS = RACE_VS_CPU.positionSfxCooldownMs;

describe('PositionSwapDetector — reglas base (V3 #14)', () => {
  it('la primera lectura es la línea base: no suena (la salida no es adelantamiento)', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    expect(detector.update(8, 1000)).toBeNull();
  });

  it('mantener la posición no suena', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(5, 1000);
    expect(detector.update(5, 1250)).toBeNull();
    expect(detector.update(5, 1500)).toBeNull();
  });

  it('ganar lugares (5→4) suena gained; perderlos (4→5) suena lost', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(5, 0);
    expect(detector.update(4, 250)).toBe('gained');
    expect(detector.update(5, 250 + COOLDOWN_MS)).toBe('lost');
  });

  it('más de un lugar a la vez también es UN solo cambio (7→3 = gained)', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(7, 0);
    expect(detector.update(3, 9999)).toBe('gained');
  });
});

describe('PositionSwapDetector — enfriamiento (V3 #14)', () => {
  it('un cambio dentro de la ventana no suena (el badge sí muestra la posición)', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(4, 0);
    expect(detector.update(3, 100)).toBe('gained');
    // 1 s después (< 2 s): otro cambio real, pero su SFX se descarta.
    expect(detector.update(5, 100 + COOLDOWN_MS - 500)).toBeNull();
  });

  it('pasada la ventana vuelve a sonar', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(4, 0);
    expect(detector.update(3, 100)).toBe('gained');
    expect(detector.update(5, 100 + COOLDOWN_MS)).toBe('lost');
  });

  it('el límite de la ventana es inclusivo: exactamente cooldown sí suena', () => {
    const detector = new PositionSwapDetector(2000);
    detector.update(4, 1000);
    expect(detector.update(3, 1100)).toBe('gained'); // arma el enfriamiento
    expect(detector.update(5, 1100 + 1999)).toBeNull(); // 1 ms antes: suprimido
    expect(detector.update(4, 1100 + 2000)).toBe('gained'); // justo la ventana
  });

  it('la dirección NO acumula deuda en el ida-y-vuelta 5→4→5→4', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(5, 0);
    expect(detector.update(4, 100)).toBe('gained'); // suena
    expect(detector.update(5, 200)).toBeNull(); // suprimido
    // El último visto es 5 (no 4): volver a 4 es de nuevo "gained", y ya
    // venció la ventana → suena UNA vez, sin dobles.
    expect(detector.update(4, 100 + COOLDOWN_MS)).toBe('gained');
  });

  it('varios cambios seguidos dentro de la ventana sólo suenan al vencerla', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(6, 0);
    expect(detector.update(5, 100)).toBe('gained');
    expect(detector.update(4, 200)).toBeNull();
    expect(detector.update(3, 300)).toBeNull();
    expect(detector.update(8, 300 + COOLDOWN_MS)).toBe('lost');
  });
});

describe('PositionSwapDetector — defensas y reinicio (V3 #14)', () => {
  it('lecturas basura se ignoran sin tocar el estado', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(4, 0);
    expect(detector.update(Number.NaN, 100)).toBeNull();
    expect(detector.update(0, 200)).toBeNull();
    expect(detector.update(-3, 300)).toBeNull();
    expect(detector.update(3, Number.NaN)).toBeNull();
    // El estado sigue en 4: pasar a 3 después del enfriamiento suena gained.
    expect(detector.update(3, COOLDOWN_MS)).toBe('gained');
  });

  it('cooldown ≤ 0 degrada a sin enfriamiento (cada cambio suena)', () => {
    const detector = new PositionSwapDetector(0);
    detector.update(4, 0);
    expect(detector.update(3, 10)).toBe('gained');
    expect(detector.update(2, 20)).toBe('gained');
  });

  it('cooldown no finito degrada igual que 0', () => {
    const detector = new PositionSwapDetector(Number.NaN);
    detector.update(4, 0);
    expect(detector.update(5, 10)).toBe('lost');
    expect(detector.update(4, 20)).toBe('gained');
  });

  it('reset limpia línea base y enfriamiento (restart de la escena)', () => {
    const detector = new PositionSwapDetector(COOLDOWN_MS);
    detector.update(4, 0);
    detector.update(3, 100);
    detector.reset();
    // Tras reset la primera lectura vuelve a ser línea base.
    expect(detector.update(7, 200)).toBeNull();
    expect(detector.update(6, 200 + COOLDOWN_MS)).toBe('gained');
  });
});
