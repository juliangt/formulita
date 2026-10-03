import { describe, expect, it } from 'vitest';
import {
  allPeersResolved,
  shouldAcceptRaceOver,
  shouldBroadcastRaceOver,
} from '../../race/raceClose';

/**
 * QA issue #35 T5 — decisiones PURAS del cierre de la carrera multi, en
 * `race/raceClose`:
 *
 * 1. `allPeersResolved`: los desconectados (leave o stale) cuentan como
 *    resueltos — jamás mandarán `rfin`, así que exigirlos bloqueaba el
 *    cierre hasta la gracia completa de 30 s (sub-hallazgo 1).
 * 2. `shouldBroadcastRaceOver` / `shouldAcceptRaceOver`: autoridad
 *    determinista del `race-over` (finisher de peerId menor, el MISMO
 *    tiebreak peerId ASC de `raceRanking`) y UNA sola aceptación — el
 *    "primer rfin visto localmente" es ambiguo con cruces casi simultáneos
 *    y cada máquina difundía/aceptaba standings distintas (sub-hallazgo 2).
 */

describe('raceClose — allPeersResolved (los desconectados no bloquean el cierre)', () => {
  it('todos terminaron: true (comportamiento previo intacto)', () => {
    expect(allPeersResolved(['a', 'b', 'c'], ['a', 'b', 'c'], [])).toBe(true);
  });

  it('terminaron todos menos uno, y el que falta está DESCONECTADO: true (el fix)', () => {
    // El caso de la teoría T5-1: el rival se cayó a mitad de carrera — no
    // existe `rfin` posible para él, así que no puede bloquear el cierre.
    expect(allPeersResolved(['a', 'b', 'c'], ['a', 'b'], ['c'])).toBe(true);
  });

  it('queda un peer EN CARRERA (ni rfin ni desconectado): false', () => {
    expect(allPeersResolved(['a', 'b', 'c'], ['a'], ['c'])).toBe(false);
    expect(allPeersResolved(['a', 'b', 'c'], ['a', 'c'], [])).toBe(false);
  });

  it('nadie resolvió aún: false', () => {
    expect(allPeersResolved(['a', 'b'], [], [])).toBe(false);
  });

  it('un desconectado que igual alcanzó a mandar rfin cuenta como resuelto (OR, no exclusión)', () => {
    expect(allPeersResolved(['a', 'b'], ['a', 'b'], ['b'])).toBe(true);
  });

  it('un peer que NO está en el roster no puede resolver nada por sí solo', () => {
    // finished/disconnected con peerId fuera del roster se IGNORA: el roster
    // congelado manda (mismo gate que el resto de la escena).
    expect(allPeersResolved(['a', 'b'], ['a', 'x'], ['y'])).toBe(false);
  });

  it('roster sin peers: true (every de vacío — no bloquea nada)', () => {
    expect(allPeersResolved([], [], [])).toBe(true);
  });
});

describe('raceClose — shouldBroadcastRaceOver (autoridad determinista del race-over)', () => {
  it('soy el ÚNICO finisher: difundo yo (sin cambio de comportamiento)', () => {
    expect(shouldBroadcastRaceOver(['yo'], 'yo')).toBe(true);
  });

  it('hay varios finishers y soy el de peerId menor: difundo yo', () => {
    expect(shouldBroadcastRaceOver(['b', 'a', 'c'], 'a')).toBe(true);
  });

  it('hay varios finishers y NO soy el de peerId menor: NO difundo', () => {
    // El caso de la teoría T5-2: con cruces casi simultáneos, antes cada
    // máquina se creía ganadora por su primer rfin LOCAL y difundían todos.
    expect(shouldBroadcastRaceOver(['b', 'a', 'c'], 'b')).toBe(false);
    expect(shouldBroadcastRaceOver(['b', 'a', 'c'], 'c')).toBe(false);
  });

  it('yo no terminé: NO difundo aunque sea el peerId menor del roster', () => {
    expect(shouldBroadcastRaceOver(['b', 'c'], 'a')).toBe(false);
  });

  it('sin finishers conocidos: false', () => {
    expect(shouldBroadcastRaceOver([], 'a')).toBe(false);
  });

  it('tiebreak peerId ASC lexicográfico, el MISMO criterio de raceRanking', () => {
    // 'qa10' < 'qa2' como string ('1' viene antes que '2'): igual que el
    // byPeerId de raceRanking — NO es orden numérico.
    expect(shouldBroadcastRaceOver(['qa2', 'qa10'], 'qa10')).toBe(true);
    expect(shouldBroadcastRaceOver(['qa2', 'qa10'], 'qa2')).toBe(false);
  });
});

describe('raceClose — shouldAcceptRaceOver (una sola aceptación, sólo de la autoridad)', () => {
  const finishers = ['b', 'a', 'c'];

  it('remitente es el finisher de peerId menor que conozco y no acepté ninguno: true', () => {
    expect(shouldAcceptRaceOver('a', finishers, false)).toBe(true);
  });

  it('remitente NO es el de peerId menor: false (un duplicado no pisa la clasificación)', () => {
    expect(shouldAcceptRaceOver('b', finishers, false)).toBe(false);
    expect(shouldAcceptRaceOver('c', finishers, false)).toBe(false);
  });

  it('remitente NO está entre MIS finishers conocidos: false', () => {
    // Vista local transitoriamente incompleta: el race-over legítimo puede
    // rechazarse — TRADEOFF documentado: la conclusión local determinista y
    // la gracia de respaldo cubren el caso.
    expect(shouldAcceptRaceOver('x', finishers, false)).toBe(false);
  });

  it('ya acepté UNO: false para cualquier remitente posterior (el primero gana)', () => {
    expect(shouldAcceptRaceOver('a', finishers, true)).toBe(false);
  });

  it('vista local sin finishers: false', () => {
    expect(shouldAcceptRaceOver('a', [], false)).toBe(false);
  });
});
