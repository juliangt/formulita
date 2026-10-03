import { describe, expect, it } from 'vitest';
import { STATE_HZ } from '../config/balance';
import { SnapshotBuffer } from '../net/interpolation';
import {
  parseRaceFinishPayload,
  parseRaceInit,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type PlayerInfo,
  type RaceStartInit,
  type RaceStatePayload,
  type StartPayload,
} from '../net/protocol';
import { hashStringToSeed } from '../net/roomRng';
import { assignGridOrder, ownGridSlot } from '../race/gridOrder';
import { decideLateAdmission } from '../race/raceLateAdmission';
import { finalClassification, type FinalCar } from '../race/raceRanking';
import { unrollProgress, type RaceRemoteSample } from '../race/raceRemote';
import { RacePlausibility } from '../race/racePlausibility';
import { RaceStaleTracker } from '../race/raceStale';
import { buildTrackPath, getTrackById } from '../race/tracks';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * QA issue #35 — Teoría T6: JOINER INVISIBLE por roster congelado.
 *
 * El roster del payload `start` es la foto del Map de metas del anfitrión al
 * presionar INICIAR (LobbyScene.tryStart toma `client.getRoster()` tal cual).
 * Un peer presente en la malla cuya meta aún no había llegado al anfitrión NO
 * viaja en `players`: recibe el start igual (está conectado), corre sus 3
 * vueltas… y con el código actual:
 *
 *  - el resto lo ignora: RaceScene sólo crea buffer/RemoteCar por el roster
 *    congelado (setupMultiRace), el gate `remoteBuffers.has(peerId)` tira los
 *    `rstate` ajenos y el gate de roster tira los `rfin`;
 *  - él mismo se dibuja en la POLE local: al no estar su peerId en la
 *    parrilla (construida del roster congelado), cae al fallback
 *    `gridSlots[0]` — la casilla de un miembro real.
 *
 * Acá se prueba (1) la decisión PURA de admisión tardía, (2) la casilla
 * propia sin pisar la pole, y (3) el flujo de carrera a nivel sistemas con 3
 * clientes fake (hub en memoria, patrón raceV3Flow: réplica del cableado de
 * RaceScene multi, sin Phaser).
 */

/** Tick del stream (ms): cada cliente difunde `rstate` a STATE_HZ. */
const TICK_MS = 1000 / STATE_HZ;

/** Semilla de la sala (viaja en el `start` y gobierna la parrilla). */
const SEED = hashStringToSeed('qa-t6-invisible-joiner');

/** Pista elegida por el anfitrión (determinista en todos los clientes). */
const TRACK_ID = 'monza';

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

/* ------------------------------------------------------------------ */
/* 1) Decisión pura de admisión tardía                                  */
/* ------------------------------------------------------------------ */

describe('qaT6 — decisión pura de admisión del joiner invisible', () => {
  const FROZEN: PlayerInfo[] = [
    { peerId: 'p1-ana', name: 'Ana', color: 1 },
    { peerId: 'p2-beto', name: 'Beto', color: 2 },
  ];
  const LIVE: PlayerInfo[] = [
    ...FROZEN,
    { peerId: 'p3-joiner', name: 'Joiner', color: 3 },
  ];

  it('qaT6: un miembro del roster congelado NO es una admisión tardía', () => {
    expect(decideLateAdmission('p1-ana', FROZEN, LIVE, new Set())).toBeNull();
  });

  it('qaT6: peer fuera del roster pero conocido por la sala se admite con SU identidad del roster vivo', () => {
    expect(decideLateAdmission('p3-joiner', FROZEN, LIVE, new Set())).toEqual({
      peerId: 'p3-joiner',
      name: 'Joiner',
      color: 3,
    });
  });

  it('qaT6: un peerId que nadie conoce se rechaza (ni roster ni sala)', () => {
    expect(decideLateAdmission('p9-fantasma', FROZEN, LIVE, new Set())).toBeNull();
    expect(decideLateAdmission('p9-fantasma', FROZEN, [], new Set())).toBeNull();
  });

  it('qaT6: quien entró a la sala DESPUÉS del start se rechaza aunque su meta ya viaje', () => {
    // El joiner post-start nunca recibió el start: no corre, no se admite.
    expect(
      decideLateAdmission('p3-joiner', FROZEN, LIVE, new Set(['p3-joiner'])),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2) Casilla propia sin pisar la pole                                  */
/* ------------------------------------------------------------------ */

describe('qaT6 — casilla propia del joiner invisible en la parrilla', () => {
  const path = buildTrackPath(getTrackById(TRACK_ID)!);

  it('qaT6: un miembro del roster conserva SU casilla', () => {
    const slots = [
      { index: 0, peerId: 'p1-ana', s: 900, lateral: -88, x: 1, y: 2, angle: 0 },
      { index: 1, peerId: 'p2-beto', s: 725, lateral: 88, x: 3, y: 4, angle: 0 },
    ];
    expect(ownGridSlot(slots, 'p2-beto', path)).toBe(slots[1]);
  });

  it('qaT6: el joiner invisible NO toma la pole: casilla sintética DETRÁS de la última fila', () => {
    const seed = hashStringToSeed('qa-t6-grid');
    const grid = assignGridOrder(
      [
        { peerId: 'p1-ana' },
        { peerId: 'p2-beto' },
        { peerId: 'p3-carla' },
        { peerId: 'p4-dani' },
      ],
      seed,
      path,
    );
    expect(grid).toHaveLength(4);
    const appended = ownGridSlot(grid, 'p5-joiner', path);

    // Es una casilla NUEVA al final de la parrilla, con SU peerId.
    expect(appended.index).toBe(grid.length);
    expect(appended.peerId).toBe('p5-joiner');
    // `s` menor = más lejos de la meta: detrás de TODA la parrilla existente
    // (la pole es la casilla de `s` MÁXIMO) y sin pisar ninguna posición.
    const minSlotS = Math.min(...grid.map((slot) => slot.s));
    expect(appended.s).toBeLessThan(minSlotS);
    for (const slot of grid) {
      expect(appended.x).not.toBe(slot.x);
      expect(appended.y).not.toBe(slot.y);
    }

    // Sin pista: misma decisión en coordenadas de arco (offset negativo).
    const flat = ownGridSlot(grid, 'p5-joiner');
    expect(flat.index).toBe(grid.length);
    expect(flat.s).toBeLessThan(0);
    expect(flat.s).toBeLessThan(Math.min(...grid.map((slot) => slot.s)));
  });
});

/* ------------------------------------------------------------------ */
/* 3) Flujo de carrera con joiner invisible (nivel sistemas)            */
/* ------------------------------------------------------------------ */

/** Perfil de manejo scripteado: velocidad CONSTANTE físicamente posible. */
const SPEED_PXS = 300;

/** Pista local compartida (igual en todos los clientes: determinista). */
const TRACK = getTrackById(TRACK_ID)!;
const PATH = buildTrackPath(TRACK);
const LAP_LENGTH = PATH.totalLength;
const HALF_WIDTH = TRACK.widthPx / 2;

/**
 * Un cliente de carrera: réplica del cableado EXACTO de RaceScene multi
 * (buffer por rival con filtro de plausibilidad, presencia de staleness,
 * gates de `rstate`/`rfin`, clasificación determinista) al nivel sistemas,
 * igual que raceV3Flow — sin Phaser ni sprites.
 */
class QaT6Client {
  readonly buffers = new Map<string, SnapshotBuffer<RaceRemoteSample>>();
  readonly remoteProgress = new Map<string, { lap: number; s: number }>();
  readonly finishedPeers = new Map<string, { totalMs: number; bestLapMs: number }>();
  readonly disconnected = new Set<string>();
  readonly plausibility = new RacePlausibility();
  readonly stale = new RaceStaleTracker();
  /** #35 — peers admitidos dinámicamente (joiner invisible). */
  readonly admittedPeers = new Map<string, PlayerInfo>();
  /** #35 — peers que aparecieron en la sala DESPUÉS del create (excluidos). */
  readonly postStartJoins = new Set<string>();
  /** Primer `rfin` visto (condición de ganador, igual criterio que la escena). */
  firstFinish: { peerId: string; at: number } | null = null;

  private readonly client: FakeNetClient;
  private readonly frozen: RaceStartInit;
  private readonly clock: { now: () => number };
  /** Arco propio del tick (determinista, físicamente posible). */
  private ownS = 0;

  constructor(client: FakeNetClient, frozen: RaceStartInit, clock: { now: () => number }) {
    this.client = client;
    this.frozen = frozen;
    this.clock = clock;
    // La escena subscribe onPeerJoin EN EL CREATE de la carrera: todo join
    // desde ahí es posterior al start (en el escenario, J ya entró antes).
    client.onPeerJoin((peerId) => this.postStartJoins.add(peerId));
    client.onRaceState((peerId, payload) => this.handleRaceState(peerId, payload));
    client.onRaceFinish((peerId, payload) => this.handleRaceFinish(peerId, payload));
    client.onPeerLeave((peerId) => {
      this.disconnected.add(peerId);
      this.stale.markStale(peerId);
      this.buffers.delete(peerId);
    });
  }

  get peerId(): string {
    return this.client.selfPeerId;
  }

  /** Un tick: avanza el reloj y difunde `rstate` (10 Hz) — el runner avanza. */
  tick(): void {
    this.ownS += SPEED_PXS * (TICK_MS / 1000);
    this.client.sendRaceState(
      roundRaceStatePayload({ s: this.ownS, o: 0, v: SPEED_PXS, lap: 0 }, LAP_LENGTH, HALF_WIDTH),
    );
  }

  /** Cruzó la meta final: difunde `rfin` una vez (igual que la escena). */
  finish(totalMs: number, bestLapMs: number): void {
    this.client.sendRaceFinish(roundRaceFinishPayload({ totalMs, bestLapMs }));
  }

  /** Gate + alta del `rstate` ajeno — ESPEJA RaceScene.handleRaceState (#35). */
  private handleRaceState(peerId: string, payload: RaceStatePayload): void {
    if (!this.buffers.has(peerId) && !this.tryAdmitRemotePeer(peerId)) {
      return; // Peer desconocido (ni roster congelado ni sala): ignorar.
    }
    const clean = roundRaceStatePayload(payload, LAP_LENGTH, HALF_WIDTH);
    const progress = unrollProgress(clean.lap, clean.s, LAP_LENGTH);
    if (!this.plausibility.accept(peerId, progress, this.clock.now())) {
      return;
    }
    this.stale.record(peerId, this.clock.now());
    this.buffers.get(peerId)?.push({ t: this.clock.now(), progress, o: clean.o });
    this.remoteProgress.set(peerId, { lap: clean.lap, s: clean.s });
  }

  /** Gate del `rfin` ajeno — ESPEJA RaceScene.handleRaceFinish (#35). */
  private handleRaceFinish(peerId: string, payload: unknown): void {
    const clean = parseRaceFinishPayload(payload);
    if (!clean) {
      return;
    }
    if (
      !this.frozen.players.some((player) => player.peerId === peerId) &&
      !this.admittedPeers.has(peerId) &&
      !this.tryAdmitRemotePeer(peerId)
    ) {
      return;
    }
    this.finishedPeers.set(peerId, clean);
    if (!this.firstFinish) {
      this.firstFinish = { peerId, at: this.clock.now() };
    }
  }

  /**
   * #35 — admisión acotada: ESPEJA RaceScene.tryAdmitRemotePeer (sin sprites:
   * buffer + presencia + identidad). La decisión es la MISMA función pura que
   * usa la escena (`decideLateAdmission`).
   */
  private tryAdmitRemotePeer(peerId: string): boolean {
    if (this.buffers.has(peerId)) {
      return false;
    }
    const player = decideLateAdmission(
      peerId,
      this.frozen.players,
      this.client.getRoster(),
      this.postStartJoins,
    );
    if (!player) {
      return false;
    }
    this.buffers.set(peerId, new SnapshotBuffer<RaceRemoteSample>());
    this.remoteProgress.set(peerId, { lap: 0, s: 0 });
    this.stale.record(peerId, this.clock.now());
    this.admittedPeers.set(peerId, player);
    return true;
  }

  /**
   * Clasificación final local — ESPEJA RaceScene.buildFinalClassification
   * (#35): un auto por jugador del roster congelado MÁS los admitidos
   * dinámicos; terminados por SU `rfin`, luego running/disconnected por
   * progreso (todo vía finalClassification).
   */
  buildFinalClassification() {
    const cars: FinalCar[] = [
      ...this.frozen.players,
      ...this.admittedPeers.values(),
    ].map((player) => {
      const peerId = player.peerId;
      if (peerId === this.peerId) {
        const finish = this.finishedPeers.get(peerId);
        return finish
          ? { peerId, lap: 3, s: 0, status: 'finished' as const, totalMs: finish.totalMs }
          : { peerId, lap: 0, s: this.ownS, status: 'running' as const };
      }
      const progress = this.remoteProgress.get(peerId) ?? { lap: 0, s: 0 };
      const finish = this.finishedPeers.get(peerId);
      if (finish) {
        return { peerId, ...progress, status: 'finished' as const, totalMs: finish.totalMs };
      }
      if (this.disconnected.has(peerId)) {
        return { peerId, ...progress, status: 'disconnected' as const };
      }
      return { peerId, ...progress, status: 'running' as const };
    });
    return finalClassification(cars, LAP_LENGTH);
  }
}

/**
 * Escenario T6: Ana (anfitriona) y Beto en la sala; el anfitrión congela el
 * roster (foto de metas) ANTES de que la meta de J llegue — la ventana del
 * #35 — y difunde el start; J YA está conectado al hub y recibe el start
 * igual. En la red fake la meta de J llega síncrona al join, así que el
 * roster VIVO de Beto durante la carrera SÍ lo conoce (como en la malla real
 * a los cientos de ms): el contraste frozen vs vivo es exactamente el caso.
 */
function setupInvisibleJoinerRace(): {
  hub: FakeNetHub;
  clock: { advance: (ms: number) => void };
  ana: QaT6Client;
  beto: QaT6Client;
  joiner: QaT6Client;
  clients: QaT6Client[];
  /** Palabra de la sala (para unir peers DESPUÉS del start). */
  word: string;
} {
  const hub = new FakeNetHub();
  const clock = sharedClock();
  const ana = new FakeNetClient(hub, { peerId: 'qa-t6-1-ana' });
  ana.create({ appId: 'formulita-dev', name: 'Ana' });
  const beto = new FakeNetClient(hub, { peerId: 'qa-t6-2-beto' });
  beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });

  // La foto del anfitrión: ANTES de que la meta del joiner llegue.
  const frozenRoster = ana.getRoster();
  const joiner = new FakeNetClient(hub, { peerId: 'qa-t6-3-joiner' });
  joiner.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Joiner' });

  // INICIAR: el payload viaja CON el roster congelado (sin J) y J lo recibe
  // igual — está en la malla.
  const payload: StartPayload = {
    seed: SEED,
    players: frozenRoster,
    startAt: Date.now(),
    gameMode: 'race',
    trackId: TRACK_ID,
  };
  ana.start(payload);

  const init = parseRaceInit(payload)!;
  expect(init.gameMode).toBe('race');
  expect(init.players.some((player) => player.peerId === joiner.selfPeerId)).toBe(false);
  const clients = [ana, beto, joiner].map(
    (client) => new QaT6Client(client, init, clock),
  );
  return {
    hub,
    clock,
    ana: clients[0],
    beto: clients[1],
    joiner: clients[2],
    clients,
    word: ana.roomWord ?? '',
  };
}

/** Corre N ticks: avanza el reloj compartido y hace tick a cada cliente. */
function runTicks(
  clients: QaT6Client[],
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

describe('qaT6 — carrera con joiner invisible (nivel sistemas)', () => {
  it('qaT6: el joiner invisible corre y lo VEN: buffer, progreso y ranking en un rival del roster', () => {
    const { beto, joiner, clients, clock } = setupInvisibleJoinerRace();

    runTicks(clients, clock, 10);

    // Sin corrección el gate `remoteBuffers.has` tira TODO el stream de J:
    // sin buffer, sin progreso, sin ranking — el auto no existe para Beto.
    expect(beto.buffers.has(joiner.peerId)).toBe(true);
    expect(beto.remoteProgress.get(joiner.peerId)?.s).toBeGreaterThan(0);
  });

  it('qaT6: el rfin del joiner invisible CUENTA (finished + clasificación final)', () => {
    const { ana, beto, joiner, clients, clock } = setupInvisibleJoinerRace();

    runTicks(clients, clock, 5);
    // J termina (sin corrección su rfin cae en el gate de roster y nadie se
    // entera).
    joiner.finish(95000, 31000);

    expect(beto.finishedPeers.get(joiner.peerId)).toEqual({ totalMs: 95000, bestLapMs: 31000 });
    expect(ana.finishedPeers.get(joiner.peerId)).toEqual({ totalMs: 95000, bestLapMs: 31000 });

    // La clasificación final local de Beto incluye la fila finished de J.
    const standings = beto.buildFinalClassification();
    const joinerRow = standings.find((row) => row.peerId === joiner.peerId);
    expect(joinerRow).toBeDefined();
    expect(joinerRow?.status).toBe('finished');
    expect(joinerRow?.totalMs).toBe(95000);
  });

  it('qaT6: quien entra a la sala DESPUÉS del start sigue FUERA (su rstate no abre la puerta)', () => {
    const { hub, beto, joiner, clients, clock, word } = setupInvisibleJoinerRace();

    runTicks(clients, clock, 5);

    // Un peer desde cero tras el start: nunca recibió el start, no corre.
    const late = new FakeNetClient(hub, { peerId: 'qa-t6-4-late' });
    late.join({ appId: 'formulita-dev', roomWord: word, name: 'Late' });
    // (defensa: aunque un cliente así mande rstate —bug o corrupto—)
    late.sendRaceState(
      roundRaceStatePayload({ s: 500, o: 0, v: SPEED_PXS, lap: 0 }, LAP_LENGTH, HALF_WIDTH),
    );

    expect(beto.buffers.has(late.peerId)).toBe(false);
    expect(beto.remoteProgress.has(late.peerId)).toBe(false);
    expect(beto.buildFinalClassification().some((row) => row.peerId === late.peerId)).toBe(false);
    // …y la admisión del joiner legítimo no se confunde con el late joiner.
    expect(beto.remoteProgress.has(joiner.peerId)).toBe(true);
  });
});
