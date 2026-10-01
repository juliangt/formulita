import { describe, expect, it } from 'vitest';
import { MATCH_OVER_GRACE_MS, STATE_HZ } from '../config/balance';
import { SnapshotBuffer } from '../net/interpolation';
import { roundStatePayload, type FinalStanding, type PlayerInfo, type StatePayload } from '../net/protocol';
import { MatchTracker } from '../systems/MatchTracker';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * Integración de la CARRERA compartida (M2) con 2+ FakeNetClient conectados
 * al mismo hub en memoria — misma capa que integración del lobby de M1, pero
 * al nivel de SISTEMAS (sin bootear escenas Phaser): cada "cliente" es el
 * cableado exacto que hace GameScene (tracker + buffers + envío a STATE_HZ +
 * detección de fin), corrido tick a tick como un update().
 *
 * Cubre el ciclo completo visto por los JUGADORES: stream de state con
 * interpolación de fantasmas, crash → eliminated → VIVOS baja, fin al quedar
 * 1 vivo → match-over → ambas partes computan el MISMO ranking; y los casos
 * límite: 0 vivos, match-over duplicado (idempotencia), peerLeave y stale.
 */

/** Tick del stream (ms) = 1/STATE_HZ. */
const TICK_MS = 1000 / STATE_HZ;

/** Reloj lógico compartido por todos los clientes (la red lo entrega ordenado). */
function sharedClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 0;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Auto local simulado de cada cliente (lo que GameScene lee de sus sistemas). */
interface LocalCar {
  distance: number;
  coins: number;
  score: number;
  speed: number;
}

/**
 * Un cliente de carrera: replica el cableado de GameScene (tracker + buffer
 * por rival + sendState/sendEliminated/sendMatchOver + checkMatchEnd con
 * gracia), sin Phaser.
 */
class RaceClient {
  readonly tracker: MatchTracker;
  readonly buffers = new Map<string, SnapshotBuffer>();
  readonly car: LocalCar;
  /** Ranking final computado localmente (null hasta concluir). */
  concluded: FinalStanding[] | null = null;
  matchOverSent = false;

  private graceMs = 0;

  private constructor(
    readonly client: FakeNetClient,
    readonly player: PlayerInfo,
    roster: PlayerInfo[],
    clock: { now: () => number },
  ) {
    this.tracker = new MatchTracker(roster, { now: clock.now, selfPeerId: player.peerId });
    this.car = { distance: 0, coins: 0, score: 0, speed: 400 };
    for (const other of roster) {
      if (other.peerId !== player.peerId) {
        this.buffers.set(other.peerId, new SnapshotBuffer());
      }
    }
    this.client.onPeerState((peerId, payload) => {
      this.buffers.get(peerId)?.push({ t: clock.now(), distance: payload.distance, x: payload.x });
      this.tracker.recordState(peerId, payload);
    });
    this.client.onEliminated((peerId, payload) => {
      this.tracker.eliminate(peerId, payload);
    });
    this.client.onMatchOver((peerId, payload) => {
      this.tracker.recordMatchOver(peerId, payload);
      this.tryConclude(0);
    });
    this.client.onPeerLeave((peerId) => {
      this.tracker.markPeerLeft(peerId);
    });
  }

  /** Crea la sala completa: host + guests ya conectados con roster idéntico. */
  static createRoom(
    names: string[],
    clock: { now: () => number },
  ): { hub: FakeNetHub; clients: RaceClient[]; roster: PlayerInfo[] } {
    const hub = new FakeNetHub();
    const raw: FakeNetClient[] = [];
    names.forEach((name, index) => {
      const client = new FakeNetClient(hub, { peerId: `p${index}-${name}` });
      if (index === 0) {
        client.create({ appId: 'formulita-dev', name });
      } else {
        client.join({ appId: 'formulita-dev', roomWord: raw[0].roomWord ?? '', name });
      }
      raw.push(client);
    });
    // El roster congelado de la carrera es el del start (colores derivados).
    const roster = raw[0].getRoster();
    const clients = raw.map((client) => {
      const player = roster.find((entry) => entry.peerId === client.selfPeerId)!;
      return new RaceClient(client, player, roster, clock);
    });
    return { hub, clients, roster };
  }

  get peerId(): string {
    return this.player.peerId;
  }

  get alive(): boolean {
    return this.tracker.getPlayer(this.peerId)?.alive ?? false;
  }

  /** Un tick de carrera: avanza el auto, difunde state (10 Hz) y chequea fin. */
  tick(): void {
    if (this.alive) {
      this.car.distance += this.car.speed * (TICK_MS / 1000);
      this.car.coins += 1;
      this.car.score += 25;
      this.sendState();
    }
    this.tracker.sweepStale();
    this.tryConclude(TICK_MS);
  }

  private sendState(): void {
    const payload: StatePayload = {
      distance: this.car.distance + 0.37, // floats: el wire los redondea
      x: 360.6,
      speed: this.car.speed,
      turboActive: false,
      coins: this.car.coins,
      score: this.car.score,
    };
    this.client.sendState(roundStatePayload(payload));
  }

  /** Crash propio (lo que GameScene.crash hace en multi). */
  crash(): void {
    const stats = { coins: this.car.coins, score: this.car.score, distance: this.car.distance };
    this.tracker.eliminate(this.peerId, stats);
    this.client.sendEliminated(stats);
  }

  /** Réplica del checkMatchEnd de GameScene (con la misma gracia). */
  private tryConclude(dtMs: number): void {
    if (this.concluded || !this.tracker.isFinished()) {
      this.graceMs = 0;
      return;
    }
    if (this.tracker.shouldBroadcastMatchOver(this.peerId)) {
      const stats = {
        coins: this.car.coins,
        score: this.car.score,
        distance: this.car.distance,
      };
      this.tracker.markSelfBroadcastDone();
      this.client.sendMatchOver(stats);
      this.tracker.recordMatchOver(this.peerId, stats);
      this.matchOverSent = true;
      this.concluded = this.tracker.finalRanking();
      return;
    }
    this.graceMs += dtMs;
    if (this.tracker.hasReceivedMatchOver || this.graceMs >= MATCH_OVER_GRACE_MS) {
      this.concluded = this.tracker.finalRanking();
    }
  }
}

/** Corre N ticks de carrera: avanza el reloj y pasa a todos los clientes. */
function runTicks(clients: RaceClient[], clock: { advance: (ms: number) => void }, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

describe('Integración carrera multi — stream de estado y fantasmas', () => {
  it('A y B corren: el stream llega, se redondea y el fantasma interpola', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto'], clock);
    const [ana, beto] = clients;

    runTicks(clients, clock, 10);

    // El buffer de Beto tiene los snapshots de Ana ya REDONDEADOS por el wire.
    const buffer = beto.buffers.get(ana.peerId)!;
    expect(buffer.size).toBe(10);
    const latest = buffer.latest!;
    expect(Number.isInteger(latest.distance)).toBe(true);

    // Render a t−100 ms: entre los dos últimos snapshots (posición continua,
    // no el último punto — eso es la interpolación que evita teletransportes).
    const renderT = clock.now() - 100;
    const point = buffer.renderAt(renderT)!;
    expect(point.distance).toBeGreaterThan(0);
    expect(point.distance).toBeLessThan(latest.distance + 1);

    // Ambos siguen vivos y sin concluir.
    expect(ana.tracker.aliveCount).toBe(2);
    expect(ana.concluded).toBeNull();
    expect(beto.concluded).toBeNull();
  });
});

describe('Integración carrera multi — eliminación y fin con 2 jugadores', () => {
  it('A choca → B ve VIVOS bajar; queda 1 → match-over → mismo ranking en ambas partes', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto'], clock);
    const [ana, beto] = clients;

    runTicks(clients, clock, 15); // carrera sana
    const anaStatsAtCrash = { ...ana.car };
    ana.crash();

    // Beto ve a Ana eliminada con las stats EXACTAS del crash (no del stream).
    expect(beto.tracker.aliveCount).toBe(1);
    const anaEnBeto = beto.tracker.getPlayer(ana.peerId)!;
    expect(anaEnBeto.frozenStats!.coins).toBe(Math.round(anaStatsAtCrash.coins));
    expect(anaEnBeto.frozenStats!.distance).toBe(Math.round(anaStatsAtCrash.distance));

    // Ana quedó espectando (sigue recibiendo el stream de Beto).
    clock.advance(TICK_MS);
    beto.tick();
    ana.tick();

    // Queda 1 vivo: Beto difunde match-over con SUS stats exactas y concluye.
    expect(beto.matchOverSent).toBe(true);
    expect(beto.concluded).not.toBeNull();
    // El match-over de Beto llegó por la red: Ana concluye sin gracia.
    expect(ana.concluded).not.toBeNull();

    // MISMO ranking en ambas partes (orden, ganador y números).
    expect(ana.concluded).toEqual(beto.concluded);
    expect(ana.concluded!.map((s) => s.peerId)).toEqual([beto.peerId, ana.peerId]);
    expect(ana.concluded![0].isWinner).toBe(true);
    expect(ana.concluded![0].coins).toBe(beto.car.coins); // exactas, no desfasadas
    expect(ana.concluded![1].coins).toBe(Math.round(anaStatsAtCrash.coins));
  });

  it('la gracia: sin match-over (perdido), los eliminados concluyen tras MATCH_OVER_GRACE_MS', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto'], clock);
    const [ana, beto] = clients;

    runTicks(clients, clock, 5);
    beto.car.coins += 3; // desempate claro: Beto muere con más monedas
    ana.crash();
    beto.crash();
    // El match-over de Beto (el último eliminado, el que corresponde) se
    // pierde: no vuelve a difundirse nadie — Ana no era la última.
    beto.matchOverSent = true;

    clock.advance(TICK_MS);
    ana.tick();
    expect(ana.matchOverSent).toBe(false); // no le corresponde a ella
    expect(ana.concluded).toBeNull(); // todavía en gracia

    // Tras la gracia completa concluye con las stats que conoce (las
    // congeladas de los `eliminated`, que sí llegaron).
    runTicks([ana], clock, Math.ceil(MATCH_OVER_GRACE_MS / TICK_MS) + 1);
    expect(ana.concluded).not.toBeNull();
    expect(ana.concluded!.length).toBe(2);
    expect(ana.concluded!.map((s) => s.peerId)).toEqual([beto.peerId, ana.peerId]);
  });
});

describe('Integración carrera multi — caso 0 vivos (muerte simultánea)', () => {
  it('los últimos mueren casi juntos: SOLO el último eliminado difunde y ambos acuerdan', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto'], clock);
    const [ana, beto] = clients;

    runTicks(clients, clock, 8);
    ana.crash(); // entrega inmediata a Beto
    beto.crash(); // entrega inmediata a Ana

    clock.advance(TICK_MS);
    ana.tick();
    beto.tick();

    // Vistas idénticas del orden local: Ana murió 1ª, Beto 2º → difunde Beto.
    expect(ana.matchOverSent).toBe(false);
    expect(beto.matchOverSent).toBe(true);
    expect(ana.concluded).toEqual(beto.concluded);
    expect(ana.concluded!.length).toBe(2);
  });

  it('match-over duplicado es idempotente: varios lo difunden y el ranking no cambia', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto', 'Carla'], clock);
    const [ana, beto, carla] = clients;

    runTicks(clients, clock, 8);
    carla.crash(); // primera eliminada
    ana.crash();
    beto.crash();

    // Los tres difunden match-over (tormenta del peor caso): nadie rompe.
    for (const client of clients) {
      client.client.sendMatchOver({
        coins: client.car.coins,
        score: client.car.score,
        distance: client.car.distance,
      });
    }
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }

    const rankings = clients.map((c) => c.concluded!);
    expect(rankings[0]).toEqual(rankings[1]);
    expect(rankings[1]).toEqual(rankings[2]);
    // Nadie re-difundió por el tracker (idempotencia observable).
    expect(ana.matchOverSent || beto.matchOverSent).toBe(false);
  });
});

describe('Integración carrera multi — desconexiones', () => {
  it('peerLeave: el que se va queda eliminado con su última state y el vivo concluye', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto', 'Carla'], clock);
    const [ana, beto, carla] = clients;

    runTicks(clients, clock, 6);
    carla.crash(); // 2 vivos: Ana y Beto
    const betoLastState = Math.round(beto.car.distance);

    beto.client.leave(); // Beto cierra el juego

    clock.advance(TICK_MS);
    ana.tick();

    // Ana perdió a sus dos rivales: concluye difundiendo match-over.
    expect(ana.concluded).not.toBeNull();
    const betoRow = ana.concluded!.find((s) => s.peerId === beto.peerId)!;
    expect(betoRow.distance).toBe(betoLastState); // stats de su último state
    expect(ana.concluded!.find((s) => s.peerId === carla.peerId)!.coins).toBe(carla.car.coins);
  });

  it('stale: un jugador que deja de mandar state por >20 s se elimina solo', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto'], clock);
    const [ana, beto] = clients;

    runTicks(clients, clock, 10); // ambos vivos y mandando state
    // Ana "se congela" (pestaña muerta): deja de mandar state pero no se va.
    for (let i = 0; i < Math.ceil((20000 / TICK_MS) + 2); i += 1) {
      clock.advance(TICK_MS);
      beto.tick();
    }

    // Beto barrió a Ana por stale y la partida terminó con él de último vivo.
    const anaEnBeto = beto.tracker.getPlayer(ana.peerId)!;
    expect(anaEnBeto.eliminationReason).toBe('stale');
    expect(beto.matchOverSent).toBe(true);
    expect(beto.concluded).not.toBeNull();
    expect(beto.concluded![0].peerId).toBe(beto.peerId);
  });
});

describe('Integración carrera multi — ranking compartido con 3+', () => {
  it('todos los clientes computan el MISMO orden (monedas → km → puntaje)', () => {
    const clock = sharedClock();
    const { clients } = RaceClient.createRoom(['Ana', 'Beto', 'Carla', 'Dani'], clock);
    const [ana, beto, carla, dani] = clients;

    // Carreras asimétricas: cada uno junta distinta cantidad de monedas.
    runTicks(clients, clock, 4);
    ana.car.coins += 40; // Ana rica pero muere temprano
    ana.crash();
    runTicks(clients, clock, 4);
    carla.crash();
    runTicks(clients, clock, 4);
    dani.car.coins += 5;
    dani.crash(); // queda Beto solo → difunde match-over

    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }

    const rankings = clients.map((c) => c.concluded!);
    for (const ranking of rankings) {
      // Monedas: Ana 44 (4+40, murió 1ª) > Dani 17 (12+5) > Beto 13 (el
      // superviviente, con lo que tenía al cerrar) > Carla 8.
      expect(ranking.map((s) => s.peerId)).toEqual([ana.peerId, dani.peerId, beto.peerId, carla.peerId]);
      expect(ranking[0].isWinner).toBe(true);
    }
    // El superviviente NO ganó por sobrevivir: Ana tiene más monedas.
    expect(rankings[0][0].peerId).toBe(ana.peerId);
    expect(rankings[0].find((s) => s.peerId === beto.peerId)!.place).toBe(3);
  });
});
