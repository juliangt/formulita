import { describe, expect, it } from 'vitest';
import { PLAYER_STALE_MS } from '../../config/balance';
import { RaceStaleTracker } from '../../race/raceStale';

/**
 * Tests del tracker de staleness de la carrera (issue #9, V3): el mismo
 * patrón del barrido de `MatchTracker` (#1) aplicado al stream `rstate` —
 * un peer que deja de mandar a mitad de carrera pasa a IDO a los
 * `PLAYER_STALE_MS` (marcado PERMANENTE) y el barrido es idempotente (sólo
 * reporta recién vencidos). El reloj es inyectado por llamada, igual que el
 * tracker de la BATALLA.
 */

describe('raceStale — RaceStaleTracker (peers muertos a mitad de carrera, V3)', () => {
  it('default: el umbral es PLAYER_STALE_MS (heredado de #1)', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);

    expect(tracker.sweep(PLAYER_STALE_MS - 1)).toEqual([]);
    expect(tracker.sweep(PLAYER_STALE_MS)).toEqual([]); // "más de", no igual
    expect(tracker.sweep(PLAYER_STALE_MS + 1)).toEqual(['beto']);
  });

  it('cada rstate refresca la presencia: un peer vivo nunca vence', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);

    // El stream corre a 10 Hz: señales cada 100 ms durante 30 s.
    for (let t = 100; t <= 30000; t += 100) {
      tracker.record('beto', t);
      expect(tracker.sweep(t)).toEqual([]);
    }
  });

  it('deja de mandar a mitad de carrera: vence PLAYER_STALE_MS después del último rstate', () => {
    const tracker = new RaceStaleTracker();
    const lastStateAt = 12345;
    tracker.record('beto', lastStateAt);

    expect(tracker.sweep(lastStateAt + PLAYER_STALE_MS)).toEqual([]);
    expect(tracker.sweep(lastStateAt + PLAYER_STALE_MS + 1)).toEqual(['beto']);
  });

  it('el barrido es idempotente: un peer vencido no se reporta dos veces', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);

    expect(tracker.sweep(PLAYER_STALE_MS + 1)).toEqual(['beto']);
    expect(tracker.sweep(PLAYER_STALE_MS + 2000)).toEqual([]);
    expect(tracker.isStale('beto')).toBe(true);
    // Y los records tardíos del peer marcado se ignoran (marca permanente).
    tracker.record('beto', PLAYER_STALE_MS + 2000);
    expect(tracker.sweep(PLAYER_STALE_MS + 3000)).toEqual([]);
  });

  it('sólo vencen los peers realmente mudos (los demás siguen)', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);
    tracker.record('ana', 0);
    tracker.record('carla', 0);

    // Beto mudo desde el arranque; ana y carla siguen mandando.
    for (let t = 100; t <= PLAYER_STALE_MS + 2000; t += 100) {
      tracker.record('ana', t);
      tracker.record('carla', t);
    }
    expect(tracker.sweep(PLAYER_STALE_MS + 2000)).toEqual(['beto']);
  });

  it('un peer que NUNCA mandó no aparece en el barrido (la escena lo da de alta)', () => {
    const tracker = new RaceStaleTracker();
    // Sin record previo: no hay nada que barrer — el alta inicial la hace la
    // escena al armar la parrilla (record por rival, igual criterio que el
    // startedAt de MatchTracker).
    expect(tracker.sweep(PLAYER_STALE_MS * 10)).toEqual([]);
  });

  it('markStale (onPeerLeave) saca al peer de los futuros barridos', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);
    tracker.markStale('beto');

    expect(tracker.isStale('beto')).toBe(true);
    expect(tracker.sweep(PLAYER_STALE_MS + 1)).toEqual([]);
  });

  it('umbral inyectable (tests/afinado sin tocar balance)', () => {
    const tracker = new RaceStaleTracker(500);
    tracker.record('beto', 0);

    expect(tracker.sweep(500)).toEqual([]);
    expect(tracker.sweep(501)).toEqual(['beto']);
  });

  it('nowMs no finito no rompe el barrido ni el record (defensa)', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', Number.NaN);
    expect(tracker.sweep(Number.NaN)).toEqual([]);
    expect(tracker.isStale('beto')).toBe(false);
  });

  it('clear resetea todo (reset de escena)', () => {
    const tracker = new RaceStaleTracker();
    tracker.record('beto', 0);
    tracker.markStale('ana');

    tracker.clear();
    expect(tracker.isStale('beto')).toBe(false);
    expect(tracker.isStale('ana')).toBe(false);
    // Tras el clear el peer vuelve a estar sujeto al umbral desde su alta.
    tracker.record('beto', 0);
    expect(tracker.sweep(PLAYER_STALE_MS + 1)).toEqual(['beto']);
  });
});
