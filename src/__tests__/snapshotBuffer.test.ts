import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../net/interpolation';

/**
 * Tests del buffer de snapshots de interpolación de fantasmas (M2).
 *
 * Contrato de `renderAt(t)`: posición CONTINUA (interpola entre los dos
 * estados que rodean t), clamp al primer snapshot si t es más viejo que el
 * buffer, y extrapolación ACOTADA a un intervalo si no llegó estado nuevo —
 * la propiedad clave es que NUNCA teletransporta.
 */

function pushLine(buffer: SnapshotBuffer, t0: number, count: number, dtMs: number, speedPxPerMs = 0.36): void {
  for (let i = 0; i < count; i += 1) {
    const t = t0 + i * dtMs;
    buffer.push({ t, distance: t * speedPxPerMs, x: 100 });
  }
}

describe('SnapshotBuffer — interpolación', () => {
  it('interpola linealmente entre dos estados que rodean t', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 100, x: 200 });
    buffer.push({ t: 1100, distance: 200, x: 260 });

    // Punto medio: mitad de camino en distance y en x.
    const mid = buffer.renderAt(1050);
    expect(mid).not.toBeNull();
    expect(mid!.distance).toBeCloseTo(150, 6);
    expect(mid!.x).toBeCloseTo(230, 6);

    // Un cuarto del segundo intervalo.
    const quarter = buffer.renderAt(1025);
    expect(quarter!.distance).toBeCloseTo(125, 6);

    // Exactamente sobre cada snapshot cae en él.
    expect(buffer.renderAt(1000)!.distance).toBe(100);
    expect(buffer.renderAt(1100)!.distance).toBe(200);
  });

  it('interpola a través de varios snapshots por el par correcto', () => {
    const buffer = new SnapshotBuffer({ capacity: 10 });
    pushLine(buffer, 0, 5, 100, 0.5); // distance = t/2

    const point = buffer.renderAt(250);
    expect(point!.distance).toBeCloseTo(125, 6);
  });
});

describe('SnapshotBuffer — clamps', () => {
  it('t más viejo que el buffer devuelve el PRIMER estado (nunca hacia atrás)', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 400, x: 10 });
    buffer.push({ t: 1100, distance: 500, x: 20 });

    expect(buffer.renderAt(0)).toEqual({ distance: 400, x: 10 });
    expect(buffer.renderAt(999)).toEqual({ distance: 400, x: 10 });
    expect(buffer.renderAt(-500)).toEqual({ distance: 400, x: 10 });
  });

  it('buffer vacío devuelve null', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.renderAt(12345)).toBeNull();
  });

  it('t no finito devuelve null', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 0, distance: 0, x: 0 });
    expect(buffer.renderAt(Number.NaN)).toBeNull();
  });
});

describe('SnapshotBuffer — extrapolación acotada', () => {
  it('sin estado nuevo extrapola con la velocidad de los dos últimos…', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 100, x: 0 });
    buffer.push({ t: 1100, distance: 200, x: 0 }); // 100 px por 100 ms

    // 50 ms después del último: medio intervalo más de distancia.
    const point = buffer.renderAt(1150);
    expect(point!.distance).toBeCloseTo(250, 6);
  });

  it('…pero JAMÁS más allá del techo (un intervalo): se congela', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 100, x: 0 });
    buffer.push({ t: 1100, distance: 200, x: 0 });

    const capped = buffer.renderAt(1100 + 100); // exactamente el techo
    expect(capped!.distance).toBeCloseTo(300, 6);

    // Mucho después: MISMO punto congelado (sin teletransporte ni vuelo).
    const frozen = buffer.renderAt(1100 + 5000);
    expect(frozen!.distance).toBeCloseTo(300, 6);
    const frozenLater = buffer.renderAt(1100 + 60000);
    expect(frozenLater!.distance).toBeCloseTo(300, 6);
  });

  it('con un solo snapshot no extrapola: siempre ese punto', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 42, x: 7 });
    expect(buffer.renderAt(2000)).toEqual({ distance: 42, x: 7 });
  });

  it('el render es continuo: sin saltos al cruzar el último snapshot', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 100, x: 0 });
    buffer.push({ t: 1100, distance: 200, x: 0 });

    const before = buffer.renderAt(1099)!.distance;
    const after = buffer.renderAt(1101)!.distance;
    expect(Math.abs(after - before)).toBeLessThan(5); // ~2 px a esa velocidad
  });
});

describe('SnapshotBuffer — higiene del buffer', () => {
  it('descarta snapshots fuera de orden (la red en malla desordena)', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 2000, distance: 200, x: 0 });
    buffer.push({ t: 1000, distance: 999, x: 0 }); // viejo: ignorado
    buffer.push({ t: 2000, distance: 888, x: 0 }); // mismo t: ignorado

    expect(buffer.size).toBe(1);
    expect(buffer.renderAt(5000)).toEqual({ distance: 200, x: 0 });
  });

  it('descarta snapshots con campos no finitos', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: Number.NaN, x: 0 });
    buffer.push({ t: 2000, distance: 10, x: Number.POSITIVE_INFINITY });
    expect(buffer.size).toBe(0);
  });

  it('mantiene un largo acotado (descarta los más viejos)', () => {
    const buffer = new SnapshotBuffer({ capacity: 3 });
    pushLine(buffer, 0, 10, 100, 1);
    expect(buffer.size).toBe(3);
    // Los sobrevivientes son los más nuevos (t 700, 800, 900).
    expect(buffer.renderAt(0)).toEqual({ distance: 700, x: 100 });
  });

  it('clear vacía el historial', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1, distance: 1, x: 1 });
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.renderAt(1)).toBeNull();
  });
});
