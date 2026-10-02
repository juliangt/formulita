import { describe, expect, it } from 'vitest';
import {
  carProgress,
  finalClassification,
  rankCars,
} from '../../race/raceRanking';
import type { FinalCar } from '../../race/raceRanking';

/**
 * Tests del ranking en vivo y la clasificación final (issue #9, V0):
 * progreso lap×L+s DESC con tiebreak peerId ASC, y clasificación final
 * determinista con terminados / en carrera / desconectados.
 */

const L = 7200;

describe('rankCars — ranking en vivo', () => {
  it('ordena por progreso lap×L+s DESC', () => {
    const own = { peerId: 'b', lap: 1, s: 100 };
    const remotes = [
      { peerId: 'a', lap: 1, s: 3000 },
      { peerId: 'c', lap: 0, s: 7000 },
      { peerId: 'd', lap: 2, s: 10 },
    ];
    const standings = rankCars(own, remotes, L);
    expect(standings.map((s) => s.peerId)).toEqual(['d', 'a', 'b', 'c']);
    expect(standings[0].position).toBe(1);
    expect(standings[3].position).toBe(4);
    expect(standings[1].progress).toBe(1 * L + 3000);
  });

  it('tiebreak de progreso igual cae a peerId ASC', () => {
    const own = { peerId: 'z', lap: 1, s: 500 };
    const remotes = [
      { peerId: 'm', lap: 0, s: 1 * L + 500 },
      { peerId: 'a', lap: 2, s: 500 - L },
    ];
    // Los tres suman exactamente el mismo progreso.
    const standings = rankCars(own, remotes, L);
    expect(standings.map((s) => s.peerId)).toEqual(['a', 'm', 'z']);
  });

  it('no muta los rosters recibidos y es estable ante orden distinto', () => {
    const own = { peerId: 'b', lap: 1, s: 100 };
    const remotes = [{ peerId: 'a', lap: 1, s: 3000 }];
    const first = rankCars(own, remotes, L);
    const second = rankCars(remotes[0], [own], L);
    expect(first.map((s) => s.peerId)).toEqual(second.map((s) => s.peerId));
    expect(remotes).toEqual([{ peerId: 'a', lap: 1, s: 3000 }]);
  });

  it('campos no finitos aportan progreso 0 (defensa)', () => {
    const corrupt = { peerId: 'x', lap: Number.NaN, s: Number.NaN };
    const clean = { peerId: 'y', lap: 0, s: 50 };
    const standings = rankCars(clean, [corrupt], L);
    expect(standings[0].peerId).toBe('y');
    expect(standings[1].progress).toBe(0);
    expect(carProgress(corrupt, L)).toBe(0);
  });
});

describe('finalClassification — clasificación final', () => {
  const cars: FinalCar[] = [
    { peerId: 'fast', lap: 3, s: 10, status: 'finished', totalMs: 118000 },
    { peerId: 'slow', lap: 3, s: 50, status: 'finished', totalMs: 130500 },
    { peerId: 'dnf', lap: 2, s: 3600, status: 'running' },
    { peerId: 'gone', lap: 1, s: 1200, status: 'disconnected' },
    { peerId: 'mid', lap: 2, s: 7100, status: 'running' },
  ];

  it('ordena: terminados por totalMs ASC → en carrera por progreso DESC → desconectados', () => {
    const standings = finalClassification(cars, L);
    expect(standings.map((s) => s.peerId)).toEqual([
      'fast', // finished, menor totalMs
      'slow', // finished
      'mid', // running, progreso 2L+7100
      'dnf', // running, progreso 2L+3600
      'gone', // disconnected
    ]);
    standings.forEach((s, i) => {
      expect(s.position).toBe(i + 1);
    });
  });

  it('los desconectados ordenan entre sí por último progreso DESC', () => {
    const withTwoGone: FinalCar[] = [
      { peerId: 'g1', lap: 1, s: 500, status: 'disconnected' },
      { peerId: 'g2', lap: 2, s: 100, status: 'disconnected' },
      { peerId: 'f', lap: 3, s: 0, status: 'finished', totalMs: 120000 },
    ];
    const standings = finalClassification(withTwoGone, L);
    expect(standings.map((s) => s.peerId)).toEqual(['f', 'g2', 'g1']);
  });

  it('tiebreak total peerId ASC', () => {
    const tied: FinalCar[] = [
      { peerId: 'z', lap: 1, s: 500, status: 'running' },
      { peerId: 'a', lap: 0, s: 1 * L + 500, status: 'running' },
      { peerId: 'm', lap: 3, s: 0, status: 'finished', totalMs: 120000 },
      { peerId: 'b', lap: 3, s: 0, status: 'finished', totalMs: 120000 },
    ];
    const standings = finalClassification(tied, L);
    expect(standings.map((s) => s.peerId)).toEqual(['b', 'm', 'a', 'z']);
  });

  it('finished sin totalMs finito cae al final de su grupo (defensa)', () => {
    const weird: FinalCar[] = [
      { peerId: 'ok', lap: 3, s: 0, status: 'finished', totalMs: 120000 },
      { peerId: 'corrupt', lap: 3, s: 100, status: 'finished', totalMs: Number.NaN },
    ];
    const standings = finalClassification(weird, L);
    expect(standings.map((s) => s.peerId)).toEqual(['ok', 'corrupt']);
  });

  it('expone totalMs sólo para terminados', () => {
    const standings = finalClassification(cars, L);
    for (const s of standings) {
      if (s.status === 'finished') {
        expect(s.totalMs).not.toBeNull();
      } else {
        expect(s.totalMs).toBeNull();
      }
    }
  });
});
