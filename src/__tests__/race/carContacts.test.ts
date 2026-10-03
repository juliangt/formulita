/**
 * Tests de `race/carContacts` (#39): contactos entre autos del GRAN PREMIO.
 *
 * El resolver es puro y determinista: cada test arma una geometría concreta
 * de par (o paquete) y verifica la TRES promesas del issue:
 * 1. nadie atraviesa a nadie (separación posicional SIEMPRE),
 * 2. toque de atrás = empujón a la víctima + frenada del agresor,
 * 3. el ángulo manda: roce lateral desvía, toque limpio de cola no.
 */

import { describe, expect, it } from 'vitest';

import { RACE_CONTACT } from '../../config/balance';
import { resolveCarContacts } from '../../race/carContacts';
import type { CarState } from '../../race/circuitPhysics';

/** Auto de prueba en el origen, mirando a +x, quieto. */
function car(x: number, y: number, heading = 0, speed = 0): CarState {
  return { x, y, heading, speed };
}

/** Distancia entre dos autos. */
function dist(a: CarState, b: CarState): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('resolveCarContacts — sin contacto no pasa nada', () => {
  it('autos separados no se mutan ni generan eventos', () => {
    const a = car(0, 0, 0, 400);
    const b = car(200, 0, 0, 400);
    const snapshot = { ax: a.x, ay: a.y, as: a.speed, bx: b.x, by: b.y, bs: b.speed };
    const contacts = resolveCarContacts([a, b]);
    expect(contacts).toEqual([]);
    expect(a).toEqual({ x: snapshot.ax, y: snapshot.ay, heading: 0, speed: snapshot.as });
    expect(b).toEqual({ x: snapshot.bx, y: snapshot.by, heading: 0, speed: snapshot.bs });
  });

  it('autos pegados pero Alejándose sólo se separan: sin impulso', () => {
    // b (adelante) más rápido: se aleja a lo largo de la normal.
    const a = car(0, 0, 0, 100);
    const b = car(50, 0, 0, 400);
    const contacts = resolveCarContacts([a, b]);
    expect(contacts).toEqual([]);
    expect(dist(a, b)).toBeGreaterThanOrEqual(RACE_CONTACT.radiusPx * 2);
    expect(a.speed).toBe(100); // Sin frenada: no hubo golpe.
    expect(b.speed).toBe(400); // Sin empujón: no hubo golpe.
  });
});

describe('resolveCarContacts — separación (anti-atravesamiento)', () => {
  it('dos autos solapados quedan fuera de solaparse, cada uno cede la mitad', () => {
    const a = car(0, 0, 0, 0);
    const b = car(40, 0, 0, 0); // 40 < 2×30: solapados.
    const contacts = resolveCarContacts([a, b]);
    expect(dist(a, b)).toBeCloseTo(RACE_CONTACT.radiusPx * 2, 6);
    // La separación va A LO LARGO de la normal (eje x acá).
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(40);
    expect(a.y).toBe(0);
    // Velocidades intactas: van a la misma velocidad (sin acercamiento).
    expect(contacts).toEqual([]);
  });

  it('un paquete denso de 8 autos (primera curva del GP) queda sin pares solapados', () => {
    // Grilla 2×4 cada 50 px: TODOS los vecinos arrancan solapados (60 de
    // diámetro); las barridas del resolver deben expandir el paquete entero.
    const cars: CarState[] = [];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        cars.push(car(col * 50, row * 50, Math.PI / 2, 300));
      }
    }
    resolveCarContacts(cars);
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        // Épsilon de 1e-3 px: en esta densidad extrema la convergencia por
        // barridas deja un residuo de milésimas — inobservable en carrera.
        expect(
          dist(cars[i], cars[j]),
          `los autos ${i} y ${j} siguen solapados`,
        ).toBeGreaterThanOrEqual(RACE_CONTACT.radiusPx * 2 - 1e-3);
      }
    }
    // La expansión es acotada: nadie fue teletransportado.
    for (const c of cars) {
      expect(Math.hypot(c.x, c.y)).toBeLessThan(200);
    }
  });
});

describe('resolveCarContacts — toque de atrás (el pedido del issue)', () => {
  it('el de adelante recibe el empujón y el de atrás se frena', () => {
    const agresor = car(0, 0, 0, 400); // Detrás, más rápido.
    const victima = car(50, 0, 0, 300); // Adelante: 50 < 60 → contacto.
    const contacts = resolveCarContacts([agresor, victima]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({ a: 0, b: 1, impact: 100 });

    // Víctima: gana velocidad hacia ADELANTE (su heading intacto).
    expect(victima.speed).toBeCloseTo(300 + RACE_CONTACT.pushFactor * 100, 6);
    expect(victima.heading).toBe(0);
    expect(victima.speed).toBeGreaterThan(300);
    // Agresor: se frena MÁS de lo que empuja (golpear nunca es rentable).
    expect(agresor.speed).toBeCloseTo(400 - RACE_CONTACT.ramSlowFactor * 100, 6);
    const perdida = 400 - agresor.speed;
    const ganancia = victima.speed - 300;
    expect(perdida).toBeGreaterThan(ganancia);
    expect(agresor.heading).toBe(0); // Toque limpio de cola: sin desvío.
  });

  it('el empujón escala con la alineación: diagonal empuja menos que de frente', () => {
    const ganancia = (agresorHeading: number): number => {
      const agresor = car(0, 0, agresorHeading, 500);
      const victima = car(50, 0, 0, 300);
      resolveCarContacts([agresor, victima]);
      return victima.speed - 300;
    };
    const deFrente = ganancia(0);
    const enDiagonal = ganancia(Math.PI / 4);
    expect(deFrente).toBeGreaterThan(0);
    expect(enDiagonal).toBeGreaterThan(0);
    // El impacto de la diagonal llega más lento a lo largo de la normal:
    // menos empujón para la víctima.
    expect(enDiagonal).toBeLessThan(deFrente);
  });
});

describe('resolveCarContacts — el ángulo desvía', () => {
  it('un roce con offset lateral desvía los headings en sentidos opuestos', () => {
    // El agresor viene pegado abajo-izquierda: la normal tiene componente y.
    const agresor = car(0, 0, 0, 400);
    const victima = car(52, 8, 0, 300);
    resolveCarContacts([agresor, victima]);
    // El agresor (recibe la normal hacia abajo-izquierda) se desvía hacia
    // arriba (heading negativo en y-hacia-abajo); la víctima, hacia abajo.
    expect(agresor.heading).toBeLessThan(0);
    expect(victima.heading).toBeGreaterThan(0);
    // Y la víctima también ganó su empujón (la normal mayormente alineada).
    expect(victima.speed).toBeGreaterThan(300);
    expect(agresor.speed).toBeLessThan(400);
  });

  it('a mayor ángulo (offset lateral), mayor desvío', () => {
    const run = (offsetY: number): number => {
      const agresor = car(0, 0, 0, 400);
      const victima = car(52, offsetY, 0, 300);
      resolveCarContacts([agresor, victima]);
      return victima.heading;
    };
    const pocoAngulo = run(4);
    const muchoAngulo = run(14);
    expect(muchoAngulo).toBeGreaterThan(pocoAngulo);
    expect(pocoAngulo).toBeGreaterThan(0);
  });
});

describe('resolveCarContacts — choque frontal', () => {
  it('ambos se frenan y nadie gana velocidad', () => {
    const a = car(0, 0, 0, 300);
    const b = car(50, 0, Math.PI, 300);
    const contacts = resolveCarContacts([a, b]);
    expect(contacts).toHaveLength(1);
    // Impacto clampeado al máximo por paso.
    expect(contacts[0].impact).toBe(RACE_CONTACT.maxImpactPx);
    expect(a.speed).toBeCloseTo(300 - RACE_CONTACT.ramSlowFactor * contacts[0].impact, 6);
    expect(b.speed).toBeCloseTo(300 - RACE_CONTACT.ramSlowFactor * contacts[0].impact, 6);
    expect(a.speed).toBeLessThan(300);
    expect(b.speed).toBeLessThan(300);
  });
});

describe('resolveCarContacts — robustez y determinismo', () => {
  it('es determinista: dos corridas sobre estados iguales dan resultados idénticos', () => {
    const make = (): CarState[] => [
      car(0, 0, 0, 400),
      car(50, 0, 0, 300),
      car(200, 30, Math.PI / 2, 350),
      car(205, 34, 0, 320),
    ];
    const run1 = make();
    const run2 = make();
    const contacts1 = resolveCarContacts(run1);
    const contacts2 = resolveCarContacts(run2);
    expect(contacts1).toEqual(contacts2);
    expect(run1).toEqual(run2);
  });

  it('dos autos en el MISMO punto no lanzan ni producen NaN', () => {
    const a = car(100, 100, 0, 200);
    const b = car(100, 100, Math.PI / 2, 200);
    expect(() => resolveCarContacts([a, b])).not.toThrow();
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    expect(dist(a, b)).toBeGreaterThanOrEqual(RACE_CONTACT.radiusPx * 2);
  });

  it('posiciones NaN se tratan sin lanzar (defensa de estado corrupto)', () => {
    const a = car(Number.NaN, 0, 0, 100);
    const b = car(30, 0, 0, 100);
    expect(() => resolveCarContacts([a, b])).not.toThrow();
  });
});
