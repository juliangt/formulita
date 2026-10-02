import { describe, expect, it } from 'vitest';
import {
  CIRCUIT,
  PLAYER_STALE_MS,
  RACE_FINISH_GRACE_MS,
  STATE_HZ,
} from '../../config/balance';
import { SnapshotBuffer } from '../../net/interpolation';
import {
  parseRaceInit,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type PlayerInfo,
  type RaceStartInit,
  type RaceStatePayload,
} from '../../net/protocol';
import { hashStringToSeed } from '../../net/roomRng';
import {
  finalClassification,
  type FinalCar,
  type FinalStanding as RaceFinalStanding,
} from '../../race/raceRanking';
import { LapTracker } from '../../race/lapTracker';
import { unrollProgress, type RaceRemoteSample } from '../../race/raceRemote';
import { RacePlausibility } from '../../race/racePlausibility';
import { RaceStaleTracker } from '../../race/raceStale';
import { assignGridOrder } from '../../race/gridOrder';
import { buildTrackPath, getTrackById } from '../../race/tracks';
import { FakeNetClient, FakeNetHub } from '../fakes/FakeNetClient';

/**
 * QA del issue #9 V3 — ROBUSTEZ del flujo de CARRERA con 3 clientes fake
 * (hub en memoria), SIN Phaser. Espeja el cableado EXACTO de RaceScene multi
 * POST-V3 (mismas funciones puras + el filtro de plausibilidad y el barrido
 * de staleness nuevos) al nivel sistemas, igual que raceCircuitFullFlow
 * hace para V2 — pero con velocidades FÍSICAMENTE POSIBLES (≤ maxSpeed),
 * porque ahora el receptor valida el avance contra `CIRCUIT`.
 *
 * Escenarios:
 *  1. El GANADOR se desconecta tras su `rfin` sin mandar `race-over`: al
 *     vencer RACE_FINISH_GRACE_MS los sobrevivientes cierran con SU
 *     clasificación local determinista (idénticas entre sí; el caído conserva
 *     su fila `finished` — su rfin llegó antes de irse).
 *  2. Un peer mudo a mitad de carrera: a los PLAYER_STALE_MS su coche sale
 *     del mundo (buffer fuera) y clasifica `disconnected` por su ÚLTIMO
 *     progreso recibido.
 *  3. Un `rstate` con avance imposible se ignora (el tramposo no avanza) y
 *     el próximo sample legítimo vuelve a pasar.
 */

/** Tick del stream (ms): cada cliente difunde a STATE_HZ. */
const TICK_MS = 1000 / STATE_HZ;

/** Período del barrido de staleness (ms): idem RaceScene (1 vez por segundo). */
const SWEEP_MS = 1000;

/** Semilla de la sala (viaja en el `start` y gobierna la parrilla). */
const ROOM_SEED = hashStringToSeed('race-v3-robustez');

/** Pista elegida por el anfitrión. */
const TRACK_ID = 'monza';

/**
 * Perfil de manejo scripteado: velocidad CONSTANTE (px/s) — todas ≤
 * CIRCUIT.maxSpeed para que NUNCA disparen el filtro de plausibilidad.
 */
interface DriveProfile {
  readonly speed: number;
  readonly lateral: number;
}

/** Beto: a fondo físico — gana. */
const BETO: DriveProfile = { speed: CIRCUIT.maxSpeed, lateral: -20 };
/** Ana: ritmo alto — segunda (issue #18: 250 × 2.5 con el mundo). */
const ANA: DriveProfile = { speed: 625, lateral: 20 };
/** Carla: muy lenta — no termina dentro del horizonte del test (×2.5). */
const CARLA: DriveProfile = { speed: 150, lateral: 0 };

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
 * Un cliente de carrera V3: el wiring EXACTO de RaceScene multi (buffer por
 * rival con filtro de plausibilidad, presencia de staleness, `rfin` propio
 * una vez, condición de ganador con el primer `rfin`, gracia de
 * RACE_FINISH_GRACE_MS y clasificación determinista de
 * `finalClassification`), más el barrido ~1/segundo que saca a los mudos.
 */
class RaceV3Client {
  readonly path = buildTrackPath(getTrackById(TRACK_ID)!);
  readonly init: RaceStartInit;
  readonly lapTracker: LapTracker;
  readonly buffers = new Map<string, SnapshotBuffer<RaceRemoteSample>>();
  readonly remoteProgress = new Map<string, { lap: number; s: number }>();
  readonly finishedPeers = new Map<string, { totalMs: number; bestLapMs: number }>();
  readonly disconnected = new Set<string>();
  readonly plausibility = new RacePlausibility();
  readonly stale = new RaceStaleTracker();

  firstFinish: { peerId: string; at: number } | null = null;
  raceOverSent = false;
  raceOverReceived: RaceFinalStanding[] | null = null;
  /** Clasificación con la que concluyó (null hasta el cierre). */
  concluded: RaceFinalStanding[] | null = null;
  /** Ticks desde el arranque (para muteAfterTick). */
  ticks = 0;
  /** Tras este tick DEJA de difundir `rstate` (simula la caída sin leave). */
  muteAfterTick = Number.POSITIVE_INFINITY;

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
  private sweepAccumulatorMs = 0;

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
      // Alta de presencia inicial (base del stale si NUNCA manda).
      this.stale.record(player.peerId, this.clock.now());
    }

    client.onRaceState((peerId, payload) => {
      if (!this.buffers.has(peerId)) {
        return; // Peer fuera del roster congelado: ignorar.
      }
      const clean = roundRaceStatePayload(payload, this.lapLength, this.halfWidth);
      const progress = unrollProgress(clean.lap, clean.s, this.lapLength);
      if (!this.plausibility.accept(peerId, progress, this.clock.now())) {
        return; // V3: avance imposible — se ignora, se espera el próximo.
      }
      this.stale.record(peerId, this.clock.now());
      this.buffers.get(peerId)?.push({
        t: this.clock.now(),
        progress,
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
      this.raceOverReceived = JSON.parse(JSON.stringify(payload)).standings ?? null;
    });
    client.onPeerLeave((peerId) => this.handlePeerLeft(peerId));
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

  /** El peer se cae sin aviso previo (cierra pestaña): leave del transporte. */
  disconnect(): void {
    this.client.leave();
  }

  /** Difunde un payload crudo arbitrario (para simular un peer corrupto). */
  sendRawRaceState(payload: RaceStatePayload): void {
    this.client.sendRaceState(payload);
  }

  /** Un tick: conducción scripteada → rstate a STATE_HZ → sweep → cierre. */
  tick(): void {
    this.ticks += 1;
    if (!this.selfFinished) {
      this.distance += (this.profile.speed * TICK_MS) / 1000;
      const raw = this.ownGridS + this.distance;
      const s = raw % this.lapLength;
      this.lastS = s;
      this.lastLap = this.lapTracker.lapsCompleted;
      this.lapTracker.update(s, TICK_MS); // dispara onRaceFinished al cierre
      if (this.ticks <= this.muteAfterTick) {
        this.client.sendRaceState(
          roundRaceStatePayload(
            { s, o: this.profile.lateral, v: this.profile.speed, lap: this.lastLap },
            this.lapLength,
            this.halfWidth,
          ),
        );
      }
    }
    this.sweepStaleTick(TICK_MS);
    this.checkRaceEnd();
  }

  /** V3: peer que avisó leave — coche fuera y `disconnected` ya. */
  private handlePeerLeft(peerId: string): void {
    this.disconnected.add(peerId);
    this.stale.markStale(peerId);
    this.buffers.delete(peerId); // removeRemoteCar espejo (queda remoteProgress)
  }

  /** Barrido ~1/segundo (idem RaceScene): los mudos salen del mundo. */
  private sweepStaleTick(deltaMs: number): void {
    this.sweepAccumulatorMs += deltaMs;
    if (this.sweepAccumulatorMs < SWEEP_MS) {
      return;
    }
    this.sweepAccumulatorMs = 0;
    for (const peerId of this.stale.sweep(this.clock.now())) {
      this.disconnected.add(peerId);
      this.buffers.delete(peerId); // removeRemoteCar espejo
    }
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
function setupRace(): {
  clock: ReturnType<typeof sharedClock>;
  clients: [RaceV3Client, RaceV3Client, RaceV3Client];
} {
  const clock = sharedClock();
  const hub = new FakeNetHub();
  const ana = new FakeNetClient(hub, { peerId: 'v3-ana' });
  ana.create({ appId: 'formulita-dev', name: 'Ana' });
  const beto = new FakeNetClient(hub, { peerId: 'v3-beto' });
  beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });
  const carla = new FakeNetClient(hub, { peerId: 'v3-carla' });
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

  const clients: RaceV3Client[] = [];
  const guest = (client: FakeNetClient, profile: DriveProfile): void => {
    client.onStart((payload) => {
      const init = parseRaceInit(payload);
      expect(init?.gameMode).toBe('race');
      clients.push(new RaceV3Client(client, init!, profile, clock));
    });
  };
  guest(beto, BETO);
  guest(carla, CARLA);
  ana.start(startPayload);
  const anaInit = parseRaceInit(startPayload)!;
  clients.unshift(new RaceV3Client(ana, anaInit, ANA, clock));

  const [anaRace, betoRace, carlaRace] = clients;
  expect(betoRace).toBeDefined();
  expect(carlaRace).toBeDefined();

  return { clock, clients: [anaRace, betoRace, carlaRace] };
}

/** Corre ticks para todos (avanza el reloj compartido entre ticks). */
function runTicks(
  clock: ReturnType<typeof sharedClock>,
  clients: RaceV3Client[],
  ticks: number,
): void {
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

/** Corre ticks hasta que el predicado sea true (con techo de seguridad). */
function runUntil(
  clock: ReturnType<typeof sharedClock>,
  clients: RaceV3Client[],
  predicate: () => boolean,
): void {
  // Techo de seguridad: 4 vueltas del más lento posible + la gracia entera.
  const safetyTicks =
    Math.ceil((4 * clients[0].path.totalLength) / ((CIRCUIT.maxSpeed * TICK_MS) / 1000)) +
    Math.ceil(RACE_FINISH_GRACE_MS / TICK_MS);
  for (let i = 0; i < safetyTicks && !predicate(); i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

/** Clave determinista de una clasificación (peerId/puesto/status/tiempo). */
function key(standings: RaceFinalStanding[]): Array<{
  peerId: string;
  position: number;
  status: string;
  totalMs: number | null;
}> {
  return standings.map((row) => ({
    peerId: row.peerId,
    position: row.position,
    status: row.status,
    totalMs: row.totalMs,
  }));
}

describe('QA issue #9 V3 — robustez de la carrera con 3 clientes', () => {
  it('ganador desconectado sin race-over: la gracia cierra con clasificaciones locales IDÉNTICAS', () => {
    const { clock, clients } = setupRace();
    const [ana, beto, carla] = clients;

    // Beto (a fondo) termina primero y difunde su rfin.
    runUntil(clock, clients, () => beto.winnerPeerId !== null);
    expect(beto.winnerPeerId).toBe(beto.peerId);
    expect(ana.winnerPeerId).toBe(beto.peerId);
    expect(carla.winnerPeerId).toBe(beto.peerId);
    expect(beto.finishedPeers.has(beto.peerId)).toBe(true);

    // El ganador se cae ANTES de poder difundir race-over.
    beto.disconnect();
    expect(ana.disconnected.has(beto.peerId)).toBe(true); // los demás lo vieron
    expect(ana.buffers.has(beto.peerId)).toBe(false); // su coche salió del mundo

    // Sin race-over, los sobrevivientes corren hasta vencer la gracia.
    const graceTicks = Math.ceil(RACE_FINISH_GRACE_MS / TICK_MS) + 2;
    runTicks(clock, [ana, carla], graceTicks);

    // Nadie difundió race-over (el ganador ya no está): nadie lo recibió.
    expect(ana.raceOverSent).toBe(false);
    expect(carla.raceOverSent).toBe(false);
    expect(ana.raceOverReceived).toBeNull();
    expect(carla.raceOverReceived).toBeNull();

    // Ambos concluyeron con SU clasificación local determinista: idénticas.
    expect(ana.concluded).not.toBeNull();
    expect(carla.concluded).not.toBeNull();
    expect(key(ana.concluded!)).toEqual(key(carla.concluded!));

    // El caído conserva su fila como finished: su rfin llegó ANTES de irse
    // (precedencia de `finished` sobre `disconnected` en la clasificación).
    const standings = ana.concluded!;
    const betoRow = standings.find((row) => row.peerId === beto.peerId)!;
    expect(betoRow.position).toBe(1);
    expect(betoRow.status).toBe('finished');
    expect(betoRow.totalMs).toBe(beto.finishedPeers.get(beto.peerId)!.totalMs);

    // Ana terminó durante la gracia; Carla sigue conectada (nunca terminó).
    const anaRow = standings.find((row) => row.peerId === ana.peerId)!;
    expect(anaRow.status).toBe('finished');
    const carlaRow = standings.find((row) => row.peerId === carla.peerId)!;
    expect(carlaRow.status).toBe('running');
    expect(carlaRow.totalMs).toBeNull();
    expect(carlaRow.progress).toBeGreaterThan(0);
  });

  it('peer mudo a mitad de carrera: a los PLAYER_STALE_MS sale del mundo y clasifica disconnected', () => {
    const { clock, clients } = setupRace();
    const [ana, beto, carla] = clients;
    carla.muteAfterTick = 200; // Carla deja de mandar rstate en el tick 200.

    // Carla transmite normal hasta su mute: los demás la siguen bien.
    runTicks(clock, clients, 210);
    expect(ana.disconnected.has(carla.peerId)).toBe(false);
    const frozen = { ...ana.remoteProgress.get(carla.peerId)! };
    expect(frozen.lap).toBe(0);
    expect(frozen.s).toBeGreaterThan(0);

    // El umbral vence PLAYER_STALE_MS después del ÚLTIMO rstate (tick 200);
    // el barrido (1/segundo) lo detecta apenas pasa.
    const staleTicks = Math.ceil((PLAYER_STALE_MS + 2000) / TICK_MS);
    runTicks(clock, clients, staleTicks);
    expect(ana.stale.isStale(carla.peerId)).toBe(true);
    expect(ana.disconnected.has(carla.peerId)).toBe(true);
    expect(ana.buffers.has(carla.peerId)).toBe(false); // su coche salió
    expect(beto.disconnected.has(carla.peerId)).toBe(true);
    expect(beto.buffers.has(carla.peerId)).toBe(false);

    // Su ÚLTIMO progreso queda congelado (no se borra): alimenta la fila.
    expect(ana.remoteProgress.get(carla.peerId)).toEqual(frozen);
    const lapLength = ana.path.totalLength;
    const frozenProgress = frozen.lap * lapLength + frozen.s;
    expect(frozenProgress).toBeGreaterThan(0);

    // La carrera sigue: Beto termina primero y abre la gracia; al vencer,
    // Carla cierra `disconnected` clasificada por ese último progreso.
    runUntil(clock, clients, () => beto.winnerPeerId !== null);
    expect(beto.winnerPeerId).toBe(beto.peerId);
    const graceTicks = Math.ceil(RACE_FINISH_GRACE_MS / TICK_MS) + 2;
    runTicks(clock, clients, graceTicks);
    expect(ana.concluded).not.toBeNull();
    expect(beto.concluded).not.toBeNull();
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));

    const standings = ana.concluded!;
    const carlaRow = standings.find((row) => row.peerId === carla.peerId)!;
    expect(carlaRow.status).toBe('disconnected');
    expect(carlaRow.totalMs).toBeNull();
    expect(carlaRow.progress).toBe(frozenProgress);
    // Ana y Beto terminaron antes de la gracia: finished con SU totalMs.
    expect(standings.find((row) => row.peerId === ana.peerId)!.status).toBe('finished');
    expect(standings.find((row) => row.peerId === beto.peerId)!.status).toBe('finished');
    expect(beto.raceOverSent).toBe(true); // Beto es el ganador: difunde él.
  });

  it('rstate con avance IMPOSIBLE se ignora; el próximo legítimo vuelve a pasar', () => {
    const { clock, clients } = setupRace();
    const [ana, , carla] = clients;

    // Un tramo legítimo de Carla (15 px/tick a 150 px/s, escala #18).
    runTicks(clock, clients, 10);
    const before = { ...ana.remoteProgress.get(carla.peerId)! };
    const bufferSize = ana.buffers.get(carla.peerId)!.size;
    expect(bufferSize).toBeGreaterThan(0);

    // Carla "salta" de golpe a la última vuelta: avance de ~3 vueltas en un
    // intervalo — físicamente imposible, el filtro lo ignora por completo.
    carla.sendRawRaceState({ s: 0, o: 0, v: CIRCUIT.maxSpeed, lap: CIRCUIT.totalLaps });
    expect(ana.remoteProgress.get(carla.peerId)).toEqual(before);
    expect(ana.buffers.get(carla.peerId)!.size).toBe(bufferSize);

    // Y el próximo sample legítimo pasa: el peer no quedó congelado.
    runTicks(clock, clients, 1);
    const after = ana.remoteProgress.get(carla.peerId)!;
    expect(after.lap * ana.path.totalLength + after.s).toBeGreaterThan(
      before.lap * ana.path.totalLength + before.s,
    );
    expect(ana.buffers.get(carla.peerId)!.size).toBe(bufferSize + 1);
  });
});
