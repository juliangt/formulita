import { describe, expect, it } from 'vitest';
import { RACE_FINISH_GRACE_MS, STATE_HZ } from '../../config/balance';
import { SnapshotBuffer } from '../../net/interpolation';
import {
  parseRaceInit,
  parseRaceOverPayload,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type PlayerInfo,
  type RaceStartInit,
} from '../../net/protocol';
import { hashStringToSeed } from '../../net/roomRng';
import {
  finalClassification,
  type FinalCar,
  type FinalStanding as RaceFinalStanding,
} from '../../race/raceRanking';
import { LapTracker } from '../../race/lapTracker';
import { unrollProgress, type RaceRemoteSample } from '../../race/raceRemote';
import { assignGridOrder } from '../../race/gridOrder';
import { buildTrackPath, getTrackById } from '../../race/tracks';
import { FakeNetClient, FakeNetHub } from '../fakes/FakeNetClient';

/**
 * QA del issue #9 V2 — FLUJO COMPLETO de una CARRERA en circuito con 3
 * clientes fake (hub en memoria), de punta a punta y SIN Phaser:
 *
 *   lobby (crear + unirse) → anfitrión difunde `start` extendido
 *   {gameMode:'race', trackId, seed} → cada cliente arma SU carrera con
 *   parseRaceInit + parrilla determinista (assignGridOrder) → todos difunden
 *   `rstate` a STATE_HZ en coordenadas de pista → los `rfin` llegan en orden
 *   scripteado → el GANADOR (primer rfin) difunde `race-over` con la
 *   clasificación de `finalClassification` → los 3 computan standings
 *   IDÉNTICAS. Caso gracia: un auto no termina y la carrera cierra por
 *   RACE_FINISH_GRACE_MS desde el primer rfin, clasificándolo por progreso.
 *
 * Espeja el cableado EXACTO de RaceScene en multi (mismas funciones puras:
 * roundRaceStatePayload, unrollProgress, SnapshotBuffer genérico,
 * LapTracker, rankCars/finalClassification) al nivel sistemas, igual que
 * raceMultiFullFlow.test.ts hace con la BATALLA. Todo determinista: seed
 * fija, velocidades fijas, reloj lógico inyectado.
 */

/** Tick del stream (ms): cada cliente difunde a STATE_HZ. */
const TICK_MS = 1000 / STATE_HZ;

/** Semilla de la sala (viaja en el `start` y gobierna la parrilla). */
const ROOM_SEED = hashStringToSeed('race-v2-full-flow');

/** Pista elegida por el anfitrión. */
const TRACK_ID = 'monza';

/**
 * Perfil de manejo scripteado: velocidad CONSTANTE (px/s) a lo largo del eje
 * y lateral fijo. La física real la ejercitan los tests de circuitPhysics;
 * acá importa el NETCODE (el wire es el mismo para cualquier velocidad).
 */
interface DriveProfile {
  readonly speed: number;
  readonly lateral: number;
}

/** Beto: el más rápido — gana. */
const BETO: DriveProfile = { speed: 5200, lateral: -20 };
/** Ana: media — segunda. */
const ANA: DriveProfile = { speed: 4600, lateral: 20 };
/** Carla: lenta — termina tercera (o NUNCA, en el caso gracia). */
const CARLA: DriveProfile = { speed: 4100, lateral: 0 };
/** Carla del caso gracia: tan lenta que no termina dentro del test. */
const CARLA_LENTA: DriveProfile = { speed: 300, lateral: 10 };

/** Reloj lógico compartido (la red fake entrega síncrono y en orden). */
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
 * Un cliente de carrera full-flow: el wiring EXACTO de RaceScene multi
 * (buffer por rival, progreso desenrollado, `rfin` propio una vez, condición
 * de ganador con el primer `rfin`, gracia de RACE_FINISH_GRACE_MS y
 * clasificación determinista de `finalClassification`).
 */
class RaceFlowClient {
  readonly path = buildTrackPath(getTrackById(TRACK_ID)!);
  readonly init: RaceStartInit;
  readonly lapTracker: LapTracker;
  readonly buffers = new Map<string, SnapshotBuffer<RaceRemoteSample>>();
  readonly remoteProgress = new Map<string, { lap: number; s: number }>();
  readonly finishedPeers = new Map<string, { totalMs: number; bestLapMs: number }>();
  readonly disconnected = new Set<string>();

  firstFinish: { peerId: string; at: number } | null = null;
  raceOverSent = false;
  raceOverReceived: RaceFinalStanding[] | null = null;
  /** Clasificación con la que concluyó (null hasta el cierre). */
  concluded: RaceFinalStanding[] | null = null;

  private readonly client: FakeNetClient;
  private readonly profile: DriveProfile;
  private readonly clock: { now: () => number };
  private readonly lapLength: number;
  private readonly halfWidth: number;
  private readonly ownGridS: number;
  private distance = 0;
  private lastS = 0;
  private lastLap = 0;
  private selfFinished = false;

  constructor(
    client: FakeNetClient,
    init: RaceStartInit,
    profile: DriveProfile,
    clock: { now: () => number },
  ) {
    this.client = client;
    this.init = init;
    this.profile = profile;
    this.clock = clock;
    this.lapLength = this.path.totalLength;
    this.halfWidth = getTrackById(TRACK_ID)!.widthPx / 2;

    // Parrilla determinista: mismos (players, seed) ⇒ misma parrilla.
    const slots = assignGridOrder(init.players, init.seed, this.path);
    const ownSlot = slots.find((slot) => slot.peerId === client.selfPeerId)!;
    this.ownGridS = ownSlot.s;

    this.lapTracker = new LapTracker(this.path);
    this.lapTracker.onRaceFinished = (event) => this.handleSelfRaceFinished(event);

    for (const player of init.players) {
      if (player.peerId === client.selfPeerId) {
        continue;
      }
      const slot = slots.find((entry) => entry.peerId === player.peerId)!;
      this.buffers.set(player.peerId, new SnapshotBuffer<RaceRemoteSample>());
      this.remoteProgress.set(player.peerId, { lap: 0, s: slot.s });
    }

    client.onRaceState((peerId, payload) => {
      if (!this.buffers.has(peerId)) {
        return; // Peer fuera del roster congelado: ignorar.
      }
      const clean = roundRaceStatePayload(payload, this.lapLength, this.halfWidth);
      this.buffers.get(peerId)?.push({
        t: this.clock.now(),
        progress: unrollProgress(clean.lap, clean.s, this.lapLength),
        o: clean.o,
      });
      this.remoteProgress.set(peerId, { lap: clean.lap, s: clean.s });
    });
    client.onRaceFinish((peerId, payload) => {
      if (this.finishedPeers.has(peerId)) {
        return; // rfin es UNA vez (idempotencia).
      }
      const clean = roundRaceFinishPayload(payload);
      this.finishedPeers.set(peerId, clean);
      if (!this.firstFinish) {
        this.firstFinish = { peerId, at: this.clock.now() };
      }
    });
    client.onRaceOver((_peerId, payload) => {
      this.raceOverReceived = parseRaceOverPayload(payload)?.standings ?? null;
    });
    client.onPeerLeave((peerId) => this.disconnected.add(peerId));
  }

  get peerId(): string {
    return this.client.selfPeerId;
  }

  get players(): PlayerInfo[] {
    return this.init.players;
  }

  get winnerPeerId(): string | null {
    return this.firstFinish?.peerId ?? null;
  }

  /** Un tick: conducción scripteada → rstate a STATE_HZ → cierre de carrera. */
  tick(): void {
    if (!this.selfFinished) {
      this.distance += (this.profile.speed * TICK_MS) / 1000;
      const raw = this.ownGridS + this.distance;
      const s = raw % this.lapLength;
      this.lastS = s;
      this.lastLap = this.lapTracker.lapsCompleted;
      this.lapTracker.update(s, TICK_MS); // dispara onRaceFinished al cierre
      // Broadcast propio a STATE_HZ (ventana de un tick: 100 ms == 1/10 Hz).
      // Igual que RaceScene: en el tick del cruce final YA no se difunde
      // (onRaceFinished marcó selfFinished durante el lapTracker.update).
      if (!this.selfFinished) {
        this.client.sendRaceState(
          roundRaceStatePayload(
            { s, o: this.profile.lateral, v: this.profile.speed, lap: this.lastLap },
            this.lapLength,
            this.halfWidth,
          ),
        );
      }
    }
    this.checkRaceEnd();
  }

  /** handleSelfRaceFinished de RaceScene: rfin UNA vez + condición ganador. */
  private handleSelfRaceFinished(event: { totalMs: number; bestLapMs: number }): void {
    if (this.selfFinished) {
      return;
    }
    this.selfFinished = true;
    this.finishedPeers.set(this.peerId, {
      totalMs: event.totalMs,
      bestLapMs: event.bestLapMs,
    });
    if (!this.firstFinish) {
      this.firstFinish = { peerId: this.peerId, at: this.clock.now() };
    }
    this.client.sendRaceFinish(
      roundRaceFinishPayload({ totalMs: event.totalMs, bestLapMs: event.bestLapMs }),
    );
  }

  /** Réplica del checkRaceEnd + broadcastRaceOverIfWinner de RaceScene. */
  private checkRaceEnd(): void {
    if (this.concluded) {
      return;
    }
    if (this.raceOverReceived) {
      this.concluded = this.raceOverReceived;
      return;
    }
    const allFinished = this.players.every((player) => this.finishedPeers.has(player.peerId));
    const graceExpired =
      this.firstFinish !== null && this.clock.now() - this.firstFinish.at >= RACE_FINISH_GRACE_MS;
    if (!allFinished && !graceExpired) {
      return;
    }
    if (!this.raceOverSent && this.winnerPeerId === this.peerId) {
      this.raceOverSent = true;
      this.client.sendRaceOver({ standings: this.classifyLocally() });
    }
    this.concluded = this.classifyLocally();
  }

  /** buildFinalClassification de RaceScene (determinista). */
  private classifyLocally(): RaceFinalStanding[] {
    const cars: FinalCar[] = this.players.map((player) => {
      const peerId = player.peerId;
      const progress =
        peerId === this.peerId
          ? { lap: this.lastLap, s: this.lastS }
          : (this.remoteProgress.get(peerId) ?? { lap: 0, s: 0 });
      const finish = this.finishedPeers.get(peerId);
      if (finish) {
        return { peerId, ...progress, status: 'finished' as const, totalMs: finish.totalMs };
      }
      if (this.disconnected.has(peerId)) {
        return { peerId, ...progress, status: 'disconnected' as const };
      }
      return { peerId, ...progress, status: 'running' as const };
    });
    return finalClassification(cars, this.lapLength);
  }
}

/** Arma el lobby + start extendido y devuelve los tres clientes de carrera. */
function setupRace(carlaProfile: DriveProfile): {
  clock: ReturnType<typeof sharedClock>;
  clients: [RaceFlowClient, RaceFlowClient, RaceFlowClient];
} {
  const clock = sharedClock();
  const hub = new FakeNetHub();
  const ana = new FakeNetClient(hub, { peerId: 'race-ana' });
  ana.create({ appId: 'formulita-dev', name: 'Ana' });
  const beto = new FakeNetClient(hub, { peerId: 'race-beto' });
  beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });
  const carla = new FakeNetClient(hub, { peerId: 'race-carla' });
  carla.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Carla' });

  expect(ana.getRoster()).toEqual(beto.getRoster());
  expect(ana.isHost()).toBe(true);

  // El anfitrión difunde el start EXTENDIDO (modo CARRERA + pista + seed).
  const startPayload = {
    seed: ROOM_SEED,
    players: ana.getRoster(),
    startAt: 1700000000000,
    gameMode: 'race' as const,
    trackId: TRACK_ID,
  };

  // Los invitados construyen su carrera dentro de onStart, con el MISMO
  // parseRaceInit defensivo que usa LobbyScene.startRace para decidir escena.
  const clients: RaceFlowClient[] = [];
  const guest = (client: FakeNetClient, profile: DriveProfile): void => {
    client.onStart((payload) => {
      const init = parseRaceInit(payload);
      expect(init?.gameMode).toBe('race');
      clients.push(new RaceFlowClient(client, init!, profile, clock));
    });
  };
  guest(beto, BETO);
  guest(carla, carlaProfile);
  ana.start(startPayload);
  const anaInit = parseRaceInit(startPayload)!;
  clients.unshift(new RaceFlowClient(ana, anaInit, ANA, clock));

  const [anaRace, betoRace, carlaRace] = clients;
  expect(betoRace).toBeDefined();
  expect(carlaRace).toBeDefined();
  // Todos ven la MISMA pista/roster, y cada remote aparece con la MISMA
  // casilla de parrilla en el client que lo mira (vista por perspectiva:
  // el propio no está en SU mapa de remotos).
  expect(betoRace.init.trackId).toBe(TRACK_ID);
  expect(betoRace.init.players).toEqual(anaInit.players);
  expect(anaRace.remoteProgress.get(carlaRace.peerId)).toEqual(
    betoRace.remoteProgress.get(carlaRace.peerId),
  );
  expect(carlaRace.remoteProgress.get(betoRace.peerId)).toEqual(
    anaRace.remoteProgress.get(betoRace.peerId),
  );

  return { clock, clients: [anaRace, betoRace, carlaRace] };
}

/** Corre ticks para todos (avanza el reloj compartido entre ticks). */
function runTicks(
  clock: ReturnType<typeof sharedClock>,
  clients: RaceFlowClient[],
  ticks: number,
): void {
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

describe('QA issue #9 V2 — flujo completo de CARRERA con 3 clientes (start → rstate → rfin → race-over)', () => {
  it('los rfin llegan en orden scripteado y los 3 computan standings IDÉNTICAS', () => {
    const { clock, clients } = setupRace(CARLA);
    const [ana, beto, carla] = clients;
    const lapLength = ana.path.totalLength;

    /* ---------- carrera: ticks hasta que los tres terminen -------------- */
    // Velocidades 4600/5200/4100 px/s: Beto termina primero, luego Ana,
    // luego Carla (3 vueltas + trecho de parrilla cada uno).
    const maxTicks = Math.ceil((4 * lapLength) / 4100) * (1000 / TICK_MS) + 20;
    runTicks(clock, clients, maxTicks);

    // El ganador es BETO (primer rfin) y él fue quien difundió race-over.
    expect(beto.winnerPeerId).toBe(beto.peerId);
    expect(ana.winnerPeerId).toBe(beto.peerId);
    expect(carla.winnerPeerId).toBe(beto.peerId);
    expect(beto.raceOverSent).toBe(true);
    expect(ana.raceOverSent).toBe(false);
    expect(carla.raceOverSent).toBe(false);

    // Los tres concluyeron con standings idénticas EN EL ORDEN Y CONTENIDO
    // que importa (peerId, puesto, status, lap, tiempos). Los s/progress de
    // cada fila pueden diferir en épsilon de wire (el ganador clasifica con
    // SUS floats exactos; quien cierra localmente en el mismo tick ve los
    // rstate redondeados) — el ORDEN determinista es el contrato.
    for (const client of clients) {
      expect(client.concluded).not.toBeNull();
    }
    const key = (standings: RaceFinalStanding[]): Array<{
      peerId: string;
      position: number;
      status: string;
      lap: number;
      totalMs: number | null;
    }> =>
      standings.map((row) => ({
        peerId: row.peerId,
        position: row.position,
        status: row.status,
        lap: row.lap,
        totalMs: row.totalMs,
      }));
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));
    expect(key(carla.concluded!)).toEqual(key(beto.concluded!));

    // El race-over del ganador llegó INTACTO (bit a bit) a los otros dos.
    expect(ana.raceOverReceived).toEqual(beto.concluded);
    expect(carla.raceOverReceived).toEqual(beto.concluded);

    /* ---------- contenido de la clasificación --------------------------- */
    const standings = beto.concluded!;
    expect(standings.map((row) => row.peerId)).toEqual([beto.peerId, ana.peerId, carla.peerId]);
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3]);
    expect(standings.every((row) => row.status === 'finished')).toBe(true);

    // Tiempos ASC: el totalMs de cada rfin, idéntico en las tres copias y
    // consistente con el tick en que cruzó (± un tick de redondeo del wire).
    expect(standings[0].totalMs!).toBeLessThan(standings[1].totalMs!);
    expect(standings[1].totalMs!).toBeLessThan(standings[2].totalMs!);
    expect(standings[0].totalMs).toBe(beto.finishedPeers.get(beto.peerId)!.totalMs);
    expect(standings[1].totalMs).toBe(ana.finishedPeers.get(ana.peerId)!.totalMs);

    // Los buffers recibieron el stream DESENROLLADO: monótono y multi-vuelta.
    // El último broadcast de Ana fue el tick ANTES de cruzar la meta final
    // (en el tick del cruce ya no se difunde): progreso ≈ 3L − un intervalo.
    const anaStream = beto.buffers.get(ana.peerId)!;
    expect(anaStream.size).toBeGreaterThan(2 * 3); // > 2 vueltas de stream
    expect(anaStream.latest!.progress).toBeGreaterThan(3 * lapLength - 600);
  });

  it('caso gracia: Carla nunca termina y la carrera cierra por RACE_FINISH_GRACE_MS', () => {
    const { clock, clients } = setupRace(CARLA_LENTA);
    const [ana, beto, carla] = clients;

    // Ticks hasta el rfin de Beto (ganador) + la mitad de la gracia: la
    // carrera NO puede haber cerrado todavía.
    const betoTicks = Math.ceil((3 * ana.path.totalLength + 140) / ((BETO.speed * TICK_MS) / 1000));
    runTicks(clock, clients, betoTicks + Math.floor(RACE_FINISH_GRACE_MS / TICK_MS / 2));
    expect(beto.winnerPeerId).toBe(beto.peerId);
    for (const client of clients) {
      expect(client.concluded).toBeNull(); // gracia abierta: nadie corta
    }

    // Al vencer la gracia DESDE EL PRIMER rfin, el ganador difunde race-over
    // y los tres cierran EN EL MISMO TICK con el mismo orden/contenido.
    const remaining = Math.ceil(RACE_FINISH_GRACE_MS / TICK_MS);
    runTicks(clock, clients, remaining + 2);
    expect(beto.raceOverSent).toBe(true);
    for (const client of clients) {
      expect(client.concluded).not.toBeNull();
    }
    const key = (standings: RaceFinalStanding[]): Array<{
      peerId: string;
      position: number;
      status: string;
      totalMs: number | null;
    }> =>
      standings.map((row) => ({
        peerId: row.peerId,
        position: row.position,
        status: row.status,
        totalMs: row.totalMs,
      }));
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));
    expect(key(carla.concluded!)).toEqual(key(beto.concluded!));

    // Carla, sin terminar, va ÚLTIMA clasificada por su ÚLTIMO progreso.
    const standings = beto.concluded!;
    expect(standings.map((row) => row.peerId)).toEqual([beto.peerId, ana.peerId, carla.peerId]);
    const carlaRow = standings[2];
    expect(carlaRow.status).toBe('running');
    expect(carlaRow.totalMs).toBeNull();
    expect(carlaRow.progress).toBeGreaterThan(0);

    // Ana terminó: su fila quedó congelada con el totalMs de su rfin.
    const anaRow = standings[1];
    expect(anaRow.status).toBe('finished');
    expect(anaRow.totalMs).toBe(ana.finishedPeers.get(ana.peerId)!.totalMs);
  });
});
