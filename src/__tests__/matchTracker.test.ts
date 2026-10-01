import { describe, expect, it } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import { MatchTracker, statsFromState } from '../systems/MatchTracker';
import type { PlayerInfo, StatePayload } from '../net/protocol';

/**
 * Tests de MatchTracker (M2) — el corazón de la partida distribuida.
 *
 * Todo lo que cada cliente debe decidir IGUAL sin negociar vive acá:
 * congelado de stats por `eliminated`, idempotencia de `match-over`,
 * eliminación por salida de peer y por staleness, fin al quedar ≤1 vivo,
 * ranking determinístico monedas→km→puntaje y el caso 0 vivos.
 */

/** Reloj manual inyectable. */
function manualClock(startAt = 0): { now: () => number; advance: (ms: number) => void } {
  let current = startAt;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function players(...ids: string[]): PlayerInfo[] {
  return ids.map((peerId, index) => ({
    peerId,
    name: `P-${peerId}`,
    color: MULTIPLAYER.palette[index] ?? 0xffffff,
  }));
}

function stateOf(distance: number, coins: number, score: number): StatePayload {
  return { distance, x: 360, speed: 400, turboActive: false, coins, score };
}

describe('MatchTracker — estado base', () => {
  it('arranca con todos vivos y sin stats congeladas', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c'), {});
    expect(tracker.totalCount).toBe(3);
    expect(tracker.aliveCount).toBe(3);
    expect(tracker.isFinished()).toBe(false);
    for (const player of tracker.getAllPlayers()) {
      expect(player.alive).toBe(true);
      expect(player.frozenStats).toBeNull();
      expect(player.lastState).toBeNull();
    }
  });

  it('recordState refresca presencia pero NO congela stats', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    expect(tracker.recordState('a', stateOf(500, 3, 900))).toBe(true);
    const player = tracker.getPlayer('a');
    expect(player!.lastState!.distance).toBe(500);
    expect(player!.frozenStats).toBeNull();
    expect(tracker.recordState('zzz', stateOf(1, 1, 1))).toBe(false);
  });
});

describe('MatchTracker — eliminación por crash congela stats', () => {
  it('eliminate congela las stats exactas y baja los vivos', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c'), {});
    expect(tracker.eliminate('b', { coins: 7, score: 1234, distance: 5678 })).toBe('eliminated');

    const player = tracker.getPlayer('b');
    expect(player!.alive).toBe(false);
    expect(player!.frozenStats).toEqual({ coins: 7, score: 1234, distance: 5678 });
    expect(tracker.aliveCount).toBe(2);
    expect(tracker.isFinished()).toBe(false);
  });

  it('es idempotente: las PRIMERAS stats congeladas ganan', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('b', { coins: 7, score: 100, distance: 1000 });
    expect(tracker.eliminate('b', { coins: 99, score: 999, distance: 9999 })).toBe('already-eliminated');
    expect(tracker.getPlayer('b')!.frozenStats).toEqual({ coins: 7, score: 100, distance: 1000 });
    expect(tracker.aliveCount).toBe(1); // no doble-cuenta
  });

  it('peer desconocido → unknown-peer', () => {
    const tracker = new MatchTracker(players('a'), {});
    expect(tracker.eliminate('zzz', { coins: 0, score: 0, distance: 0 })).toBe('unknown-peer');
  });

  it('puesto de eliminación = eliminados antes + 1', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c', 'd'), {});
    tracker.eliminate('c', { coins: 1, score: 1, distance: 1 });
    tracker.eliminate('a', { coins: 2, score: 2, distance: 2 });
    expect(tracker.eliminationPlaceOf('c')).toBe(1);
    expect(tracker.eliminationPlaceOf('a')).toBe(2);
    tracker.eliminate('d', { coins: 3, score: 3, distance: 3 });
    expect(tracker.eliminationPlaceOf('d')).toBe(3);
    expect(tracker.eliminationPlaceOf('b')).toBeNull();
  });
});

describe('MatchTracker — fin de partida distribuida', () => {
  it('termina apenas queda 1 vivo', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c'), {});
    tracker.eliminate('a', { coins: 1, score: 1, distance: 1 });
    expect(tracker.isFinished()).toBe(false);
    tracker.eliminate('b', { coins: 2, score: 2, distance: 2 });
    expect(tracker.isFinished()).toBe(true);
  });

  it('con 2 jugadores, la primera eliminación termina la partida', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 5, score: 50, distance: 500 });
    expect(tracker.aliveCount).toBe(1);
    expect(tracker.isFinished()).toBe(true);
  });

  it('el último en pie debe difundir match-over (una sola vez)', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 1, score: 1, distance: 1 });

    expect(tracker.shouldBroadcastMatchOver('a')).toBe(false); // el muerto no
    expect(tracker.shouldBroadcastMatchOver('b')).toBe(true); // el último vivo

    tracker.markSelfBroadcastDone();
    expect(tracker.shouldBroadcastMatchOver('b')).toBe(false); // idempotente
  });

  it('match-over recibido concluye la partida aunque queden 2 vivos', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c'), {});
    tracker.recordMatchOver('c', { coins: 9, score: 90, distance: 900 });
    expect(tracker.hasReceivedMatchOver).toBe(true);
    expect(tracker.isFinished()).toBe(true);
    expect(tracker.shouldBroadcastMatchOver('a')).toBe(false); // ya concluyó
  });

  it('match-over congela las stats exactas del emisor (idempotente)', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.recordMatchOver('b', { coins: 9, score: 90, distance: 900 });
    tracker.recordMatchOver('b', { coins: 100, score: 1, distance: 1 }); // repetido: gana el 1º
    expect(tracker.getPlayer('b')!.frozenStats).toEqual({ coins: 9, score: 90, distance: 900 });
  });

  it('caso 0 vivos: el ÚLTIMO eliminado también difunde match-over', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 1, score: 1, distance: 1 });
    tracker.eliminate('b', { coins: 2, score: 2, distance: 2 });

    expect(tracker.aliveCount).toBe(0);
    expect(tracker.isFinished()).toBe(true);
    // a fue eliminado primero: no le toca cerrar. b fue el último: sí.
    expect(tracker.shouldBroadcastMatchOver('a')).toBe(false);
    expect(tracker.shouldBroadcastMatchOver('b')).toBe(true);
  });

  it('varios clientes que difunden match-over no rompen nada (idempotente)', () => {
    // Dos vistas independientes de la misma muerte simultánea: cada una
    // congela con su propio orden local, pero el RANKING no cambia.
    const ids = players('a', 'b');
    const view1 = new MatchTracker(ids, {});
    const view2 = new MatchTracker(ids, {});
    view1.eliminate('a', { coins: 3, score: 30, distance: 300 });
    view1.eliminate('b', { coins: 4, score: 40, distance: 400 });
    view2.eliminate('b', { coins: 4, score: 40, distance: 400 });
    view2.eliminate('a', { coins: 3, score: 30, distance: 300 });

    // Ambos difunden desde ambas vistas (0 vivos): misma conclusión.
    view1.recordMatchOver('b', { coins: 4, score: 40, distance: 400 });
    view2.recordMatchOver('b', { coins: 4, score: 40, distance: 400 });

    const ranking1 = view1.finalRanking().map((s) => s.peerId);
    const ranking2 = view2.finalRanking().map((s) => s.peerId);
    expect(ranking1).toEqual(['b', 'a']);
    expect(ranking2).toEqual(['b', 'a']);
  });
});

describe('MatchTracker — peerLeave y staleness', () => {
  it('peerLeave marca eliminado con la última stats conocida', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.recordState('b', stateOf(1234, 6, 789));
    expect(tracker.markPeerLeft('b')).toBe('eliminated');

    const player = tracker.getPlayer('b');
    expect(player!.alive).toBe(false);
    expect(player!.frozenStats).toEqual(statsFromState(stateOf(1234, 6, 789)));
    expect(player!.eliminationReason).toBe('peer-leave');
    expect(tracker.isFinished()).toBe(true);
    expect(tracker.markPeerLeft('b')).toBe('already-eliminated');
  });

  it('peerLeave sin stats previas congela en cero', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.markPeerLeft('b');
    expect(tracker.getPlayer('b')!.frozenStats).toEqual({ coins: 0, score: 0, distance: 0 });
  });

  it('stale: >20 s sin state de un VIVO lo elimina (reloj inyectado)', () => {
    const clock = manualClock();
    const tracker = new MatchTracker(players('a', 'b', 'c'), { now: clock.now });

    clock.advance(5000);
    tracker.recordState('a', stateOf(100, 0, 0));
    tracker.recordState('b', stateOf(200, 0, 0));

    clock.advance(19000); // a y b: 19 s sin state; c: 24 s y NUNCA mandó
    expect(tracker.sweepStale()).toEqual(['c']);
    expect(tracker.getPlayer('c')!.eliminationReason).toBe('stale');

    clock.advance(1500); // a y b pasan los 20 s
    expect(new Set(tracker.sweepStale())).toEqual(new Set(['a', 'b']));
    expect(tracker.aliveCount).toBe(0);
  });

  it('un vivo que sigue mandando state nunca queda stale', () => {
    const clock = manualClock();
    const tracker = new MatchTracker(players('a', 'b'), { now: clock.now });
    for (let tick = 0; tick < 10; tick += 1) {
      tracker.recordState('a', stateOf(tick * 100, 0, 0));
      tracker.recordState('b', stateOf(tick * 100, 0, 0));
      clock.advance(15000);
      expect(tracker.sweepStale()).toEqual([]);
    }
    expect(tracker.aliveCount).toBe(2);
  });

  it('los muertos no se barren por stale (ya están congelados)', () => {
    const clock = manualClock();
    const tracker = new MatchTracker(players('a', 'b'), { now: clock.now });
    tracker.eliminate('a', { coins: 1, score: 1, distance: 1 });
    clock.advance(60000);
    expect(tracker.sweepStale()).toEqual(['b']); // solo el vivo
  });

  it('el peerId propio JAMÁS se barre por stale (su stream no viene por red)', () => {
    const clock = manualClock();
    const tracker = new MatchTracker(players('yo', 'otro'), { now: clock.now, selfPeerId: 'yo' });
    // Ni yo ni el otro mandaron nada por 60 s: solo barre al rival.
    clock.advance(60000);
    expect(tracker.sweepStale()).toEqual(['otro']);
    expect(tracker.getPlayer('yo')!.alive).toBe(true);
    // Y puede cerrar la partida como superviviente.
    expect(tracker.shouldBroadcastMatchOver('yo')).toBe(true);
  });
});

describe('MatchTracker — ranking final determinístico', () => {
  it('ordena por monedas DESC y marca el ganador', () => {
    const tracker = new MatchTracker(players('a', 'b', 'c'), {});
    tracker.eliminate('a', { coins: 10, score: 5000, distance: 50000 });
    tracker.eliminate('b', { coins: 30, score: 100, distance: 1000 });
    tracker.recordMatchOver('c', { coins: 20, score: 200, distance: 2000 });

    const ranking = tracker.finalRanking();
    expect(ranking.map((s) => s.peerId)).toEqual(['b', 'c', 'a']);
    expect(ranking.map((s) => s.place)).toEqual([1, 2, 3]);
    expect(ranking[0].isWinner).toBe(true);
    expect(ranking[1].isWinner).toBe(false);
    expect(ranking[0].coins).toBe(30);
  });

  it('empate de monedas → más kilómetros DESC', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 10, score: 9999, distance: 5000 });
    tracker.eliminate('b', { coins: 10, score: 10, distance: 9000 });
    const ranking = tracker.finalRanking();
    expect(ranking[0].peerId).toBe('b'); // más km con las mismas monedas
  });

  it('empate de monedas y km → más puntaje DESC', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 10, score: 400, distance: 5000 });
    tracker.eliminate('b', { coins: 10, score: 700, distance: 5000 });
    expect(tracker.finalRanking()[0].peerId).toBe('b');
  });

  it('doble empate total → peerId ASC (determinístico entre clientes)', () => {
    const tracker = new MatchTracker(players('zzz', 'aaa', 'mmm'), {});
    tracker.eliminate('zzz', { coins: 5, score: 50, distance: 500 });
    tracker.eliminate('aaa', { coins: 5, score: 50, distance: 500 });
    tracker.eliminate('mmm', { coins: 5, score: 50, distance: 500 });
    expect(tracker.finalRanking().map((s) => s.peerId)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('el ganador es el de más monedas AUNQUE no sea el último vivo', () => {
    // El superviviente juntó menos monedas que un eliminado temprano:
    // sobrevivir no premia, solo da tiempo para juntar.
    const tracker = new MatchTracker(players('sob', 'rico'), {});
    tracker.eliminate('rico', { coins: 50, score: 50, distance: 50 });
    tracker.recordMatchOver('sob', { coins: 20, score: 2000, distance: 20000 });

    const ranking = tracker.finalRanking();
    expect(ranking[0].peerId).toBe('rico');
    expect(ranking[0].isWinner).toBe(true);
    expect(ranking[1].peerId).toBe('sob');
  });

  it('usa el ÚLTIMO state solo si NUNCA llegaron stats congeladas', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.recordState('b', stateOf(777, 8, 88));
    tracker.eliminate('a', { coins: 3, score: 3, distance: 3 }); // deja 1 vivo → fin
    const frozen = tracker.finalRanking().find((s) => s.peerId === 'b');
    expect(frozen!.coins).toBe(8); // fallback del stream
    expect(frozen!.place).toBe(1);
  });

  it('stats congeladas PISAN al stream (el stream puede venir desfasado)', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.recordState('b', stateOf(999, 99, 999)); // stream viejo
    tracker.recordMatchOver('b', { coins: 10, score: 100, distance: 1000 });
    const standing = tracker.finalRanking().find((s) => s.peerId === 'b');
    expect(standing!.coins).toBe(10);
  });

  it('mismas entradas ⇒ MISMO orden en cualquier cliente (determinismo)', () => {
    const ids = players('a', 'b', 'c', 'd');
    const build = (): MatchTracker => {
      const tracker = new MatchTracker(ids, {});
      tracker.recordState('a', stateOf(10, 1, 10));
      tracker.recordState('b', stateOf(20, 2, 20));
      tracker.recordState('c', stateOf(30, 3, 30));
      tracker.recordState('d', stateOf(40, 4, 40));
      tracker.eliminate('c', { coins: 3, score: 300, distance: 3000 });
      tracker.eliminate('a', { coins: 12, score: 100, distance: 1000 });
      tracker.recordMatchOver('d', { coins: 7, score: 700, distance: 7000 });
      return tracker;
    };
    const first = build().finalRanking();
    const second = build().finalRanking();
    const third = build().finalRanking();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Orden esperado por monedas: a (12) > d (7) > c (3) > b (stream: 2).
    expect(first.map((s) => s.peerId)).toEqual(['a', 'd', 'c', 'b']);
  });
});

describe('MatchTracker — saneo defensivo', () => {
  it('stats basura se congelan saneadas (enteros ≥ 0)', () => {
    const tracker = new MatchTracker(players('a', 'b'), {});
    tracker.eliminate('a', { coins: 2.6, score: -5, distance: Number.NaN });
    expect(tracker.getPlayer('a')!.frozenStats).toEqual({ coins: 3, score: 0, distance: 0 });
  });
});
