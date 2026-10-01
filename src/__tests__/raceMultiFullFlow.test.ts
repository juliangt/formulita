import { describe, expect, it } from 'vitest';
import { MATCH_OVER_GRACE_MS, SNAPSHOT_BUFFER_SIZE, STATE_HZ } from '../config/balance';
import { SnapshotBuffer } from '../net/interpolation';
import {
  parseMultiplayerInit,
  roundStatePayload,
  type FinalStanding,
  type MultiplayerInit,
  type StartPayload,
  type StatePayload,
} from '../net/protocol';
import { hashStringToSeed } from '../net/roomRng';
import { MatchTracker } from '../systems/MatchTracker';
import { SpeedSystem, composeEffectiveSpeed } from '../systems/SpeedSystem';
import { TurboSystem } from '../systems/TurboSystem';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * QA automatizado de M3 — FLUJO COMPLETO de una partida con 3 clientes fake,
 * de punta a punta y SIN Phaser:
 *
 *   lobby (crear + unirse) → anfitrión difunde `start {seed, players}` →
 *   cada cliente construye SU carrera del payload (parseMultiplayerInit, el
 *   mismo init data que LobbyScene le pasa a GameScene) → N ticks a nivel
 *   SISTEMAS con perfiles de manejo DISTINTOS (uno acelera con turbo pegado,
 *   otro frena a fondo, otro va a la base) difundiendo `state` a STATE_HZ →
 *   dos chocan en momentos distintos (`sendEliminated`) → queda 1 vivo →
 *   difunde `match-over` → los 3 computan el MISMO ranking.
 *
 * Complementa a `raceMultiIntegration.test.ts` (que prueba el cableado de la
 * carrera caso por caso): acá lo que se ejercita es la PARTIDA entera vista
 * por los jugadores, con los sistemas reales de velocidad/turbo moviendo los
 * autos. Todo determinista: semilla fija, perfiles fijos, reloj inyectado —
 * sin Math.random ni Date.now en el camino.
 */

/** Tick del stream (ms) = 1/STATE_HZ (cada cliente difunde a 10 Hz). */
const TICK_MS = 1000 / STATE_HZ;

/** Mismo tick en segundos (dt de los sistemas). */
const TICK_S = 1 / STATE_HZ;

/** Semilla de la sala (uint32 determinista — la que viajaría en `start`). */
const ROOM_SEED = hashStringToSeed('m3-full-flow');

/**
 * Perfil de manejo de un cliente: el input sostenido de su "jugador" y su
 * ritmo de monedas (fórmula determinista del pase por las líneas de monedas
 * — la pista es la misma para todos, lo que varía es quién pasa por dónde).
 */
interface DriveProfile {
  readonly label: string;
  readonly throttle: boolean;
  readonly brake: boolean;
  readonly wantsTurbo: boolean;
  /** Carril que maneja (x que viaja en cada `state`). */
  readonly x: number;
  /** Monedas juntadas en el tick n (determinista). */
  readonly coinsPerTick: (tick: number) => number;
}

/** Ana: acelera a fondo CON TURBO pegado — rápida, rica en monedas, choca 1ª. */
const TURBO_PROFILE: DriveProfile = {
  label: 'turbo',
  throttle: true,
  brake: false,
  wantsTurbo: true,
  x: 130,
  coinsPerTick: () => 2,
};

/** Beto: frena a fondo — lento, casi no junta monedas, choca 2º. */
const BRAKE_PROFILE: DriveProfile = {
  label: 'brake',
  throttle: false,
  brake: true,
  wantsTurbo: false,
  x: 590,
  coinsPerTick: (tick) => (tick % 10 === 0 ? 1 : 0),
};

/** Carla: ni acelera ni frena, base constante — la superviviente. */
const BASE_PROFILE: DriveProfile = {
  label: 'base',
  throttle: false,
  brake: false,
  wantsTurbo: false,
  x: 360,
  coinsPerTick: (tick) => (tick % 2 === 0 ? 1 : 0),
};

/** Reloj lógico compartido por los tres clientes (la red entrega ordenado). */
function sharedClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 0;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/**
 * Un cliente de carrera full-flow: el wiring EXACTO de GameScene (tracker +
 * buffer por rival + SpeedSystem/TurboSystem reales + sendState a STATE_HZ +
 * detección de fin con gracia), construido a partir del payload `start` que
 * le llegó por la red (o que él mismo difundió como anfitrión).
 */
class FullFlowClient {
  readonly tracker: MatchTracker;
  readonly buffers = new Map<string, SnapshotBuffer>();
  readonly speed = new SpeedSystem();
  readonly turbo = new TurboSystem();
  /** Ranking final computado localmente (null hasta concluir). */
  concluded: FinalStanding[] | null = null;
  matchOverSent = false;

  /** Stats vivas: lo que GameScene leería de sus propios sistemas. */
  distance = 0;
  coins = 0;
  score = 0;

  private graceMs = 0;
  private tickCount = 0;

  private constructor(
    readonly client: FakeNetClient,
    readonly init: MultiplayerInit,
    private readonly profile: DriveProfile,
    clock: { now: () => number },
  ) {
    this.tracker = new MatchTracker(init.players, {
      now: clock.now,
      selfPeerId: init.myPeerId,
    });
    for (const other of init.players) {
      if (other.peerId !== init.myPeerId) {
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

  /**
   * Construye el cliente desde el payload `start` recibido: exactamente el
   * init data que LobbyScene le pasa a GameScene (mismo `parseMultiplayerInit`
   * defensivo). Los invitados se construyen DENTRO de su onStart; el anfitrión
   * desde el payload que acaba de difundir (como hace startRace).
   */
  static fromStart(
    client: FakeNetClient,
    payload: StartPayload,
    profile: DriveProfile,
    clock: { now: () => number },
  ): FullFlowClient {
    const init = parseMultiplayerInit({
      mode: 'multi',
      seed: payload.seed,
      players: payload.players,
      myPeerId: client.selfPeerId,
      roomWord: client.roomWord ?? '',
    });
    if (!init) {
      throw new Error(`start payload inválido para ${client.selfPeerId}`);
    }
    return new FullFlowClient(client, init, profile, clock);
  }

  get peerId(): string {
    return this.init.myPeerId;
  }

  get alive(): boolean {
    return this.tracker.getPlayer(this.peerId)?.alive ?? false;
  }

  /** Un tick de carrera: sistemas reales → avance → state a 10 Hz → fin. */
  tick(): void {
    this.tickCount += 1;
    if (this.alive) {
      this.speed.update(TICK_S, { throttle: this.profile.throttle, brake: this.profile.brake });
      this.turbo.update(TICK_S, this.profile.wantsTurbo);
      const effective = composeEffectiveSpeed(this.speed.speed, this.turbo.speedMultiplier, 1);
      this.distance += effective * TICK_S;
      const picked = this.profile.coinsPerTick(this.tickCount);
      this.coins += picked;
      this.score += 10 + picked * 50;
      this.sendState(effective);
    }
    this.tracker.sweepStale();
    this.tryConclude(TICK_MS);
  }

  private sendState(effectiveSpeed: number): void {
    const payload: StatePayload = {
      distance: this.distance + 0.37, // floats: el wire los redondea
      x: this.profile.x,
      speed: effectiveSpeed,
      turboActive: this.turbo.isActive,
      coins: this.coins,
      score: this.score,
    };
    this.client.sendState(roundStatePayload(payload));
  }

  /** Crash propio (lo que GameScene.crash hace en multi). */
  crash(): void {
    const stats = { coins: this.coins, score: this.score, distance: this.distance };
    this.tracker.eliminate(this.peerId, stats);
    this.client.sendEliminated(stats);
  }

  /** Réplica del checkMatchEnd de GameScene (misma gracia). */
  private tryConclude(dtMs: number): void {
    if (this.concluded || !this.tracker.isFinished()) {
      this.graceMs = 0;
      return;
    }
    if (this.tracker.shouldBroadcastMatchOver(this.peerId)) {
      const stats = { coins: this.coins, score: this.score, distance: this.distance };
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

/** Corre N ticks para todos los clientes (avanza el reloj compartido). */
function runTicks(
  clients: FullFlowClient[],
  clock: { advance: (ms: number) => void },
  ticks: number,
): void {
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

describe('QA M3 — flujo completo de partida con 3 clientes (lobby → start → carrera → match-over)', () => {
  it('los 3 perfiles corren, 2 chocan en momentos distintos y TODOS computan el mismo ranking', () => {
    const clock = sharedClock();

    /* ---------- 1) LOBBY: crear + unirse (mismo contrato que M1) -------- */
    const hub = new FakeNetHub();
    const ana = new FakeNetClient(hub, { peerId: 'ff-1-ana' });
    ana.create({ appId: 'formulita-dev', name: 'Ana' });
    const beto = new FakeNetClient(hub, { peerId: 'ff-2-beto' });
    beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });
    const carla = new FakeNetClient(hub, { peerId: 'ff-3-carla' });
    carla.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Carla' });

    // Roster idéntico en los tres ANTES de arrancar.
    expect(ana.getRoster()).toEqual(beto.getRoster());
    expect(beto.getRoster()).toEqual(carla.getRoster());
    expect(ana.isHost()).toBe(true);

    /* ---------- 2) START: el anfitrión difunde seed + players ----------- */
    const startPayload: StartPayload = {
      seed: ROOM_SEED,
      players: ana.getRoster(),
      startAt: 1700000000000,
    };

    // Los INVITADOS se construyen dentro de su onStart (así arranca su
    // carrera en producción); el anfitrión desde el payload que difundió.
    const raceClients: FullFlowClient[] = [];
    const guest = (
      client: FakeNetClient,
      profile: DriveProfile,
    ): void => {
      client.onStart((payload) => {
        raceClients.push(FullFlowClient.fromStart(client, payload, profile, clock));
      });
    };
    guest(beto, BRAKE_PROFILE);
    guest(carla, BASE_PROFILE);
    ana.start(startPayload); // entrega síncrona a Beto y Carla
    raceClients.unshift(FullFlowClient.fromStart(ana, startPayload, TURBO_PROFILE, clock));

    // El init data parseado es la carrera correcta para cada uno.
    const [anaRace, betoRace, carlaRace] = raceClients;
    expect(raceClients).toHaveLength(3);
    for (const race of raceClients) {
      expect(race.init.seed).toBe(ROOM_SEED); // pista determinista compartida
      expect(race.init.players).toHaveLength(3);
      expect(race.init.players).toEqual(startPayload.players); // roster congelado
      expect(race.init.players.map((p) => p.peerId)).toContain(race.peerId);
    }

    /* ---------- 3) CARRERA: 30 ticks sanos con perfiles distintos ------ */
    runTicks(raceClients, clock, 30);

    // Todos vivos, todos viendo el stream de todos (redondeado por el wire).
    expect(anaRace.tracker.aliveCount).toBe(3);
    expect(anaRace.concluded).toBeNull();
    const anaInBeto = betoRace.buffers.get(anaRace.peerId)!;
    // El buffer es una ventana deslizante de SNAPSHOT_BUFFER_SIZE (~2 s de
    // stream): llegó TODO, se conservan los últimos 20.
    expect(anaInBeto.size).toBe(SNAPSHOT_BUFFER_SIZE);
    expect(Number.isInteger(anaInBeto.latest!.distance)).toBe(true);
    const anaLastSnapshotT = anaInBeto.latest!.t;
    // El turbo de Ana fue REAL: avanzó más que Beto frenando a fondo.
    expect(anaRace.distance).toBeGreaterThan(betoRace.distance);
    expect(anaRace.turbo.isActive).toBe(true); // drena 28/s: a 3 s queda medidor

    /* ---------- 4) Ana (turbo, rica) choca PRIMERA ---------------------- */
    const anaCoinsAtCrash = anaRace.coins;
    const anaDistanceAtCrash = anaRace.distance;
    anaRace.crash();

    // Beto y Carla la ven eliminada con sus stats EXACTAS del crash.
    expect(betoRace.tracker.aliveCount).toBe(2);
    expect(carlaRace.tracker.aliveCount).toBe(2);
    expect(betoRace.tracker.getPlayer(anaRace.peerId)!.eliminationOrder).toBe(1);
    expect(carlaRace.tracker.getPlayer(anaRace.peerId)!.eliminationOrder).toBe(1);
    expect(betoRace.tracker.getPlayer(anaRace.peerId)!.frozenStats!.coins).toBe(anaCoinsAtCrash);
    expect(betoRace.tracker.getPlayer(anaRace.peerId)!.frozenStats!.distance).toBe(
      Math.round(anaDistanceAtCrash),
    );

    /* ---------- 5) 45 ticks más: Ana especta, Beto sigue frenando ------ */
    runTicks(raceClients, clock, 45);

    // Espectador: Ana dejó de difundir — su último snapshot en los otros NO
    // avanza (el fantasma se congela), mientras el de Carla sigue fresco.
    expect(anaInBeto.size).toBe(SNAPSHOT_BUFFER_SIZE);
    expect(anaInBeto.latest!.t).toBe(anaLastSnapshotT);
    expect(carlaRace.buffers.get(anaRace.peerId)!.latest!.t).toBe(anaLastSnapshotT);
    const carlaInBeto = betoRace.buffers.get(carlaRace.peerId)!;
    expect(carlaInBeto.latest!.t).toBeGreaterThan(anaLastSnapshotT);
    // Y Carla (base) ya recorrió más km que la difunta Ana.
    expect(carlaRace.distance).toBeGreaterThan(anaDistanceAtCrash);

    /* ---------- 6) Beto choca SEGUNDO → queda Carla sola ---------------- */
    const betoCoinsAtCrash = betoRace.coins;
    betoRace.crash();
    expect(betoCoinsAtCrash).toBe(7); // 1 moneda cada 10 ticks × 75 ticks

    runTicks(raceClients, clock, 1); // el tick que cierra la partida

    // Carla (única viva) difundió match-over con SUS stats exactas.
    expect(carlaRace.matchOverSent).toBe(true);
    expect(anaRace.matchOverSent).toBe(false);
    expect(betoRace.matchOverSent).toBe(false);

    /* ---------- 7) Los 3 computan el MISMO ranking ---------------------- */
    const rankings = [anaRace.concluded, betoRace.concluded, carlaRace.concluded];
    for (const ranking of rankings) {
      expect(ranking).not.toBeNull();
    }
    expect(rankings[1]).toEqual(rankings[0]);
    expect(rankings[2]).toEqual(rankings[0]);

    const ranking = rankings[0]!;
    // Orden por MONEDAS: Ana 60 > Carla 38 > Beto 7.
    expect(ranking.map((s) => s.peerId)).toEqual([anaRace.peerId, carlaRace.peerId, betoRace.peerId]);
    expect(ranking.map((s) => s.place)).toEqual([1, 2, 3]);
    expect(ranking.filter((s) => s.isWinner)).toHaveLength(1);

    // La ganadora es Ana (más monedas) AUNQUE Carla sobrevivió el triple de
    // tiempo y recorrió más km: sobrevivir da tiempo, no corona.
    expect(ranking[0].peerId).toBe(anaRace.peerId);
    expect(ranking[0].coins).toBe(60); // 2 por tick × 30 ticks
    expect(ranking[0].distance).toBe(Math.round(anaDistanceAtCrash)); // congeladas al crash
    const carlaRow = ranking.find((s) => s.peerId === carlaRace.peerId)!;
    expect(carlaRow.place).toBe(2);
    expect(carlaRow.coins).toBe(38); // 1 cada 2 ticks × 76 ticks
    expect(carlaRow.distance).toBe(Math.round(carlaRace.distance)); // sus match-over exactas
    const betoRow = ranking.find((s) => s.peerId === betoRace.peerId)!;
    expect(betoRow.place).toBe(3);
    expect(betoRow.coins).toBe(betoCoinsAtCrash);

    // Desempate en acción: Carla tiene MÁS km que Ana pero MENOS monedas —
    // el orden es monedas primero, kilómetros después.
    expect(carlaRow.distance).toBeGreaterThan(ranking[0].distance);

    // El orden de eliminación también coincide en los tres clientes.
    for (const race of raceClients) {
      expect(race.tracker.getPlayer(anaRace.peerId)!.eliminationOrder).toBe(1);
      expect(race.tracker.getPlayer(betoRace.peerId)!.eliminationOrder).toBe(2);
    }
  });
});
