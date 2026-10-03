import { describe, expect, it } from 'vitest';
import { CIRCUIT, RACE_FINISH_GRACE_MS, STATE_HZ } from '../../config/balance';
import { SnapshotBuffer } from '../../net/interpolation';
import {
  parseRaceFinishPayload,
  parseRaceInit,
  parseRaceOverPayload,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type RaceFinishPayload,
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
import { RacePlausibility } from '../../race/racePlausibility';
import { RaceStaleTracker } from '../../race/raceStale';
import { assignGridOrder } from '../../race/gridOrder';
import { buildTrackPath, getTrackById } from '../../race/tracks';
import { FakeNetClient, FakeNetHub } from '../fakes/FakeNetClient';

/**
 * QA issue #35 T5 — CIERRE de la carrera multi con 3 clientes fake (hub en
 * memoria, sin Phaser), espejando el cableado de RaceScene al nivel sistemas
 * (mismo estilo que raceCircuitFullFlow / raceV3Flow). Dos teorías:
 *
 *  1. DESCONECTADOS BLOQUEAN LA GRACIA: `allFinished` sólo mira
 *     `finishedPeers`; un peer caído (leave o stale) jamás manda `rfin`, así
 *     que el cierre espera la ventana completa de RACE_FINISH_GRACE_MS (30 s)
 *     aunque el resto haya terminado. Debe concluir al quedar todos los NO
 *     desconectados resueltos.
 *  2. GANADOR AMBIGUO: con `rfin` casi simultáneos, `firstFinish` es "el
 *     primer rfin VISTO LOCALMENTE" — dos máquinas se creen ganadoras, las
 *     dos difunden `race-over` y cada receptor se queda con el que procese
 *     (última escritura, sin gate). Debe difundir UNO solo (finisher de
 *     peerId menor, el tiebreak del ranking) y aceptarse UNO solo.
 *
 * Para el caso 2 los clientes sostienen los `rfin`/`race-over` en una cola
 * (hold/release): reproduce el CRUCE de mensajes que en la red real da
 * primeras-vistas divergentes, imposible en el hub síncrono.
 */

/** Tick del stream (ms): cada cliente difunde a STATE_HZ. */
const TICK_MS = 1000 / STATE_HZ;

/** Período del barrido de staleness (ms): idem RaceScene (~1 vez/segundo). */
const SWEEP_MS = 1000;

/** Semilla de la sala (viaja en el `start` y gobierna la parrilla). */
const ROOM_SEED = hashStringToSeed('qa-t5-race-close');

/** Pista elegida por el anfitrión. */
const TRACK_ID = 'monza';

/** Perfil scripteado: velocidad CONSTANTE ≤ CIRCUIT.maxSpeed (plausibilidad). */
interface DriveProfile {
  readonly speed: number;
  readonly lateral: number;
}

/** Beto: el más rápido — gana por tiempo. */
const BETO: DriveProfile = { speed: 740, lateral: -30 };
/** Ana: media — segunda. */
const ANA: DriveProfile = { speed: 620, lateral: 30 };
/** Carla: muy lenta — no termina dentro del horizonte del test. */
const CARLA: DriveProfile = { speed: 140, lateral: 0 };

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

/** Un `race-over` que viajó por la sala (remitente + standings difundidas). */
interface RaceOverBroadcast {
  readonly from: string;
  readonly standings: RaceFinalStanding[];
}

/**
 * Un cliente de cierre: el wiring de RaceScene multi (plausibilidad,
 * staleness, rfin propio una vez, condición de ganador con el primer rfin
 * LOCAL, gracia de RACE_FINISH_GRACE_MS y clasificación determinista) más
 * holds de `rfin`/`race-over` para reproducir cruces de red.
 */
class QaT5CloseClient {
  readonly path = buildTrackPath(getTrackById(TRACK_ID)!);
  readonly init: RaceStartInit;
  readonly lapTracker: LapTracker;
  readonly buffers = new Map<string, SnapshotBuffer<RaceRemoteSample>>();
  readonly remoteProgress = new Map<string, { lap: number; s: number }>();
  readonly finishedPeers = new Map<string, { totalMs: number; bestLapMs: number }>();
  readonly disconnectedPeers = new Set<string>();
  readonly plausibility = new RacePlausibility();
  readonly stale = new RaceStaleTracker();

  firstFinish: { peerId: string; at: number } | null = null;
  raceOverSent = false;
  raceOverStandings: RaceFinalStanding[] | null = null;
  /** Clasificación con la que concluyó (null hasta el cierre) y cuándo. */
  concluded: RaceFinalStanding[] | null = null;
  concludedAt: number | null = null;
  /** Ticks desde el arranque (para muteAfterTick). */
  ticks = 0;
  /** Tras este tick NO difunde nada (rstate/rfin/race-over): caída seca. */
  muteAfterTick = Number.POSITIVE_INFINITY;
  /** true mientras los `rfin` entrantes se retengan en la cola de holds. */
  holdRaceFinish = false;
  /** true mientras los `race-over` entrantes se retengan en la cola. */
  holdRaceOver = false;

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
  /** `rfin` retenidos (en orden de llegada) mientras holdRaceFinish. */
  private readonly heldRfins: Array<{ peerId: string; payload: unknown }> = [];
  /** `race-over` retenidos (en orden de llegada) mientras holdRaceOver. */
  private readonly heldRaceOvers: Array<{ peerId: string; standings: RaceFinalStanding[] }> = [];

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
        return;
      }
      this.stale.record(peerId, this.clock.now());
      this.buffers.get(peerId)?.push({ t: this.clock.now(), progress, o: clean.o });
      this.remoteProgress.set(peerId, { lap: clean.lap, s: clean.s });
    });
    client.onRaceFinish((peerId, payload) => {
      if (!this.init.players.some((player) => player.peerId === peerId)) {
        return; // Gate de roster (idem handleRaceFinish).
      }
      if (this.holdRaceFinish) {
        this.heldRfins.push({ peerId, payload });
        return;
      }
      this.processRaceFinish(peerId, payload);
    });
    client.onRaceOver((peerId, payload) => {
      if (!this.init.players.some((player) => player.peerId === peerId)) {
        return; // Gate de roster (idem handleRaceOver).
      }
      const parsed = parseRaceOverPayload(payload);
      if (!parsed) {
        return;
      }
      if (this.holdRaceOver) {
        this.heldRaceOvers.push({ peerId, standings: parsed.standings });
        return;
      }
      this.acceptRaceOver(peerId, parsed.standings);
    });
    client.onPeerLeave((peerId) => this.handlePeerLeftRace(peerId));
  }

  get peerId(): string {
    return this.client.selfPeerId;
  }

  get players(): RaceStartInit['players'] {
    return this.init.players;
  }

  get selfFinishedAt(): number | null {
    return this.selfFinished ? this.firstFinish?.at ?? null : null;
  }

  /** Suelta los `rfin` retenidos, en orden de llegada (el "cruce" ocurre). */
  releaseHeldRaceFinishes(): void {
    this.holdRaceFinish = false;
    const pending = this.heldRfins.splice(0, this.heldRfins.length);
    for (const held of pending) {
      this.processRaceFinish(held.peerId, held.payload);
    }
  }

  /** Suelta los `race-over` retenidos, en orden de llegada. */
  releaseHeldRaceOvers(): void {
    this.holdRaceOver = false;
    const pending = this.heldRaceOvers.splice(0, this.heldRaceOvers.length);
    for (const held of pending) {
      this.acceptRaceOver(held.peerId, held.standings);
    }
  }

  /** Un tick: conducción scripteada → rstate → sweep de stale → cierre. */
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

  /** handlePeerLeftRace de RaceScene: desconectado + coche fuera del mundo. */
  private handlePeerLeftRace(peerId: string): void {
    this.disconnectedPeers.add(peerId);
    this.stale.markStale(peerId);
    this.buffers.delete(peerId); // removeRemoteCar espejo (queda remoteProgress)
  }

  /** Barrido ~1/segundo (idem RaceScene): los mudos salen, salvo finishers. */
  private sweepStaleTick(deltaMs: number): void {
    this.sweepAccumulatorMs += deltaMs;
    if (this.sweepAccumulatorMs < SWEEP_MS) {
      return;
    }
    this.sweepAccumulatorMs = 0;
    for (const peerId of this.stale.sweep(this.clock.now())) {
      if (this.finishedPeers.has(peerId)) {
        continue; // Terminó y dejó de transmitir: no es staleness.
      }
      this.disconnectedPeers.add(peerId);
      this.buffers.delete(peerId); // removeRemoteCar espejo
    }
  }

  /** Espejo de handleRaceFinish: rfin parseado → finishedPeers + firstFinish. */
  private processRaceFinish(peerId: string, payload: unknown): void {
    const clean = parseRaceFinishPayload(payload);
    if (!clean) {
      return;
    }
    this.finishedPeers.set(peerId, clean);
    if (!this.firstFinish) {
      this.firstFinish = { peerId, at: this.clock.now() };
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
    if (this.ticks > this.muteAfterTick) {
      return; // Caída seca: ni rfin sale (así muere un peer de verdad).
    }
    this.client.sendRaceFinish(
      roundRaceFinishPayload({ totalMs: event.totalMs, bestLapMs: event.bestLapMs }),
    );
  }

  /** Espejo de handleRaceOver: la clasificación recibida manda sobre la local. */
  private acceptRaceOver(peerId: string, standings: RaceFinalStanding[]): void {
    this.raceOverStandings = standings;
    void peerId;
  }

  /** Réplica del checkRaceEnd + broadcastRaceOverIfWinner de RaceScene. */
  private checkRaceEnd(): void {
    if (this.concluded) {
      return;
    }
    if (this.raceOverStandings) {
      this.conclude(this.raceOverStandings);
      return;
    }
    const allFinished = this.players.every((player) =>
      this.finishedPeers.has(player.peerId),
    );
    if (allFinished) {
      this.broadcastRaceOverIfWinner();
      this.conclude(this.classifyLocally());
      return;
    }
    if (
      this.firstFinish &&
      this.clock.now() - this.firstFinish.at >= RACE_FINISH_GRACE_MS
    ) {
      this.broadcastRaceOverIfWinner();
      this.conclude(this.classifyLocally());
    }
  }

  /** Espejo de broadcastRaceOverIfWinner: el "ganador" difunde UNA vez. */
  private broadcastRaceOverIfWinner(): void {
    if (this.raceOverSent || this.firstFinish?.peerId !== this.peerId) {
      return;
    }
    this.raceOverSent = true;
    this.client.sendRaceOver({ standings: this.classifyLocally() });
  }

  private conclude(standings: RaceFinalStanding[]): void {
    this.concluded = standings;
    this.concludedAt = this.clock.now();
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
      if (this.disconnectedPeers.has(peerId)) {
        return { peerId, ...progress, status: 'disconnected' as const };
      }
      return { peerId, ...progress, status: 'running' as const };
    });
    return finalClassification(cars, this.lapLength);
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

/** Arma el lobby + start extendido y devuelve los clientes de carrera. */
function setupRace(withCarla: boolean): {
  clock: ReturnType<typeof sharedClock>;
  clients: QaT5CloseClient[];
  /** Todos los `race-over` que viajaron por la sala, en orden de envío. */
  broadcasts: RaceOverBroadcast[];
} {
  const clock = sharedClock();
  const hub = new FakeNetHub();
  const broadcasts: RaceOverBroadcast[] = [];
  const ana = new FakeNetClient(hub, { peerId: 'qa5-ana' });
  ana.create({ appId: 'formulita-dev', name: 'Ana' });
  const beto = new FakeNetClient(hub, { peerId: 'qa5-beto' });
  beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });
  const raws = [ana, beto];
  if (withCarla) {
    const carla = new FakeNetClient(hub, { peerId: 'qa5-carla' });
    carla.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Carla' });
    raws.push(carla);
  }

  const startPayload = {
    seed: ROOM_SEED,
    players: ana.getRoster(),
    startAt: 1700000000000,
    gameMode: 'race' as const,
    trackId: TRACK_ID,
  };

  const profiles: DriveProfile[] = withCarla ? [ANA, BETO, CARLA] : [ANA, BETO];
  const clients: QaT5CloseClient[] = [];
  const guest = (client: FakeNetClient, profile: DriveProfile): void => {
    // Espía del wire: cada race-over EMITIDO queda registrado (quién y qué).
    const original = client.sendRaceOver.bind(client);
    client.sendRaceOver = (payload) => {
      broadcasts.push({ from: client.selfPeerId, standings: payload.standings });
      original(payload);
    };
    client.onStart((payload) => {
      const init = parseRaceInit(payload);
      clients.push(new QaT5CloseClient(client, init!, profile, clock));
    });
  };
  raws.forEach((client, index) => {
    if (index === 0) {
      const original = client.sendRaceOver.bind(client);
      client.sendRaceOver = (payload) => {
        broadcasts.push({ from: client.selfPeerId, standings: payload.standings });
        original(payload);
      };
      // El anfitrión construye su carrera fuera de onStart (mismo patrón V3).
      clients.push(new QaT5CloseClient(client, parseRaceInit(startPayload)!, profiles[0], clock));
      return;
    }
    guest(client, profiles[index]);
  });
  ana.start(startPayload);

  const [anaRace, betoRace] = clients;
  expect(anaRace).toBeDefined();
  expect(betoRace).toBeDefined();
  expect(betoRace.init.players).toEqual(anaRace.init.players);

  return { clock, clients, broadcasts };
}

/** Corre ticks para los dados (avanza el reloj compartido entre ticks). */
function runTicks(
  clock: ReturnType<typeof sharedClock>,
  clients: QaT5CloseClient[],
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
  clients: QaT5CloseClient[],
  predicate: () => boolean,
): void {
  const safetyTicks =
    Math.ceil((4 * clients[0]!.path.totalLength) / ((CIRCUIT.maxSpeed * TICK_MS) / 1000)) +
    Math.ceil(RACE_FINISH_GRACE_MS / TICK_MS);
  for (let i = 0; i < safetyTicks && !predicate(); i += 1) {
    clock.advance(TICK_MS);
    for (const client of clients) {
      client.tick();
    }
  }
}

describe('QA #35 T5 (1) — los desconectados no bloquean el cierre', () => {
  it('leave del rival a mitad de carrera: al terminar los vivos, cierra SIN la gracia', () => {
    const { clock, clients } = setupRace(true);
    const [ana, beto, carla] = clients;

    // Beto termina primero (rfin en circulación normal) y Carla se va.
    runUntil(clock, clients, () => beto.finishedPeers.has(beto.peerId));
    expect(ana.finishedPeers.has(beto.peerId)).toBe(true);
    carla.client.leave();
    expect(ana.disconnectedPeers.has(carla.peerId)).toBe(true);
    expect(beto.disconnectedPeers.has(carla.peerId)).toBe(true);

    // Ana sigue en carrera y termina: con ella resueltos TODOS los vivos
    // (beto terminó, carla se fue), la carrera debe cerrar EN ESE MOMENTO.
    runUntil(clock, [ana, beto], () => ana.selfFinished);
    runTicks(clock, [ana, beto], 30); // ventana corta: 3 s << gracia de 30 s

    // EL FIX: sin esperar RACE_FINISH_GRACE_MS.
    expect(ana.concluded).not.toBeNull();
    expect(beto.concluded).not.toBeNull();
    expect(ana.concludedAt! - ana.firstFinish!.at).toBeLessThan(RACE_FINISH_GRACE_MS);

    // Misma clasificación en ambos; el caído conserva su fila.
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));
    const rows = ana.concluded!;
    expect(rows.find((row) => row.peerId === ana.peerId)!.status).toBe('finished');
    expect(rows.find((row) => row.peerId === ana.peerId)!.position).toBe(1);
    expect(rows.find((row) => row.peerId === beto.peerId)!.status).toBe('finished');
    const carlaRow = rows.find((row) => row.peerId === carla.peerId)!;
    expect(carlaRow.status).toBe('disconnected');
    expect(carlaRow.totalMs).toBeNull();
    expect(carlaRow.lap * ana.path.totalLength + carlaRow.s).toBeGreaterThan(0);
  });

  it('stale del rival (caída seca sin leave): el sweep lo marca y el cierre tampoco espera', () => {
    const { clock, clients } = setupRace(true);
    const [ana, beto, carla] = clients;
    carla.muteAfterTick = 100; // Carla muere en el tick 100 (10 s): sin rstate NI rfin.

    runTicks(clock, clients, 110);
    // Nadie la marcó todavía y su último progreso quedó congelado.
    expect(ana.disconnectedPeers.has(carla.peerId)).toBe(false);
    const frozen = { ...ana.remoteProgress.get(carla.peerId)! };
    expect(frozen.s).toBeGreaterThan(0);

    // El sweep (~1/seg) la marca a los PLAYER_STALE_MS del último rstate.
    runUntil(clock, [ana, beto], () => ana.disconnectedPeers.has(carla.peerId));
    expect(beto.disconnectedPeers.has(carla.peerId)).toBe(true);
    expect(ana.remoteProgress.get(carla.peerId)).toEqual(frozen);

    // Ana termina: vivos todos resueltos → cierre inmediato, sin la gracia.
    runUntil(clock, [ana, beto], () => ana.selfFinished);
    runTicks(clock, [ana, beto], 30);

    expect(ana.concluded).not.toBeNull();
    expect(beto.concluded).not.toBeNull();
    expect(ana.concludedAt! - ana.firstFinish!.at).toBeLessThan(RACE_FINISH_GRACE_MS);
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));

    const rows = ana.concluded!;
    const carlaRow = rows.find((row) => row.peerId === carla.peerId)!;
    expect(carlaRow.status).toBe('disconnected');
    expect(carlaRow.lap * ana.path.totalLength + carlaRow.s).toBe(
      frozen.lap * ana.path.totalLength + frozen.s,
    );
  });
});

describe('QA #35 T5 (2) — autoridad determinista del race-over', () => {
  it('fin casi simultáneo: UNA sola difusión (finisher de peerId menor) y una sola aceptación', () => {
    const { clock, clients, broadcasts } = setupRace(false);
    const [ana, beto] = clients;

    // Cruce de rfin: nadie procesa el del otro hasta que AMBOS terminaron
    // (en la red real esto pasa siempre que los cruces son casi simultáneos;
    // el hub síncrono lo simulamos con holds).
    ana.holdRaceFinish = true;
    beto.holdRaceFinish = true;
    ana.holdRaceOver = true;
    beto.holdRaceOver = true;
    runUntil(clock, [ana, beto], () => ana.selfFinished && beto.selfFinished);
    expect(ana.firstFinish!.peerId).toBe(ana.peerId); // cada máquina se cree
    expect(beto.firstFinish!.peerId).toBe(beto.peerId); // ganadora EN LOCAL

    // Suelta los rfin: ambos ven "terminaron todos" en el próximo tick.
    ana.releaseHeldRaceFinishes();
    beto.releaseHeldRaceFinishes();
    runTicks(clock, [ana, beto], 2);

    // EL FIX: difunde UNO solo y es la autoridad (peerId menor entre
    // finishers), no "el primero que cada máquina vio".
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0]!.from).toBe(ana.peerId);

    // Suelta los race-over cruzados + un duplicado forzado de beto: el
    // receptor ya concluyó/aceptó — nada pisa la clasificación aceptada.
    ana.releaseHeldRaceOvers();
    beto.releaseHeldRaceOvers();
    const authority = broadcasts[0]!.standings;
    const forged = [...authority].reverse(); // standings "de beto": P1 él
    beto.client.sendRaceOver({ standings: forged });
    ana.releaseHeldRaceOvers();

    expect(ana.raceOverStandings).toBeNull(); // el duplicado NO entró
    expect(key(beto.raceOverStandings ?? [])).toEqual(key(authority)); // aceptó la autoridad

    // Ambos concluyeron (sin gracia: todos terminaron) y IGUAL.
    expect(ana.concluded).not.toBeNull();
    expect(beto.concluded).not.toBeNull();
    expect(ana.concludedAt! - ana.firstFinish!.at).toBeLessThan(RACE_FINISH_GRACE_MS);
    expect(key(ana.concluded!)).toEqual(key(beto.concluded!));
    expect(key(ana.concluded!)).toEqual(key(authority));
  });
});
