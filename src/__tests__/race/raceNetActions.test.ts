import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../net/roomRng';
import {
  TrysteroNetClient,
  type TrysteroRoom,
} from '../../net/TrysteroNetClient';
import {
  parseRaceOverPayload,
  roundRaceStatePayload,
  type RaceFinishPayload,
  type RaceOverPayload,
  type RaceStatePayload,
} from '../../net/protocol';
import type { FinalStanding as RaceFinalStanding } from '../../race/raceRanking';
import { FakeNetClient, FakeNetHub } from '../fakes/FakeNetClient';
import { FakeTrysteroRoom } from '../fakes/FakeTrysteroRoom';

/**
 * Tests de las acciones de red de la CARRERA (issue #9, V2): `rstate`,
 * `rfin` y `race-over` en AMBOS transportes — `FakeNetClient` (hub en
 * memoria, entrega síncrona, sin ec ho al emisor) y `TrysteroNetClient`
 * (room doble estructural, mismos namespaces que usaría la malla real).
 * Patrón aditivo: espeja exactamente los tests de `state`/`eliminated`/
 * `match-over` y del chat.
 */

describe('FakeNetClient — acciones de carrera sobre el hub en memoria', () => {
  function makePair(): { ana: FakeNetClient; beto: FakeNetClient } {
    const hub = new FakeNetHub();
    const ana = new FakeNetClient(hub, { peerId: 'race-1-ana' });
    ana.create({ appId: 'app', name: 'Ana' });
    const beto = new FakeNetClient(hub, { peerId: 'race-2-beto' });
    beto.join({ appId: 'app', roomWord: ana.roomWord ?? '', name: 'Beto' });
    return { ana, beto };
  }

  it('sendRaceState difunde rstate a los demás, sin eco al emisor', () => {
    const { ana, beto } = makePair();
    const onAna = vi.fn();
    const onBeto = vi.fn();
    ana.onRaceState(onAna);
    beto.onRaceState(onBeto);

    ana.sendRaceState(roundRaceStatePayload({ s: 500.4, o: -20, v: 260, lap: 0 }, 7000, 58));

    expect(onBeto).toHaveBeenCalledTimes(1);
    expect(onBeto).toHaveBeenCalledWith('race-1-ana', { s: 500, o: -20, v: 260, lap: 0 });
    expect(onAna).not.toHaveBeenCalled(); // Trystero no echa las acciones al emisor
  });

  it('sendRaceFinish difunde rfin (una vez por finishing peer)', () => {
    const { ana, beto } = makePair();
    const received: Array<{ from: string; payload: RaceFinishPayload }> = [];
    beto.onRaceFinish((from, payload) => received.push({ from, payload }));

    ana.sendRaceFinish({ totalMs: 120000, bestLapMs: 39000 });

    expect(received).toEqual([{ from: 'race-1-ana', payload: { totalMs: 120000, bestLapMs: 39000 } }]);
  });

  it('sendRaceOver difunde race-over con la clasificación íntegra', () => {
    const { ana, beto } = makePair();
    const standings: RaceFinalStanding[] = [
      { peerId: 'race-1-ana', position: 1, status: 'finished', totalMs: 120000, lap: 3, s: 10, progress: 21010 },
      { peerId: 'race-2-beto', position: 2, status: 'running', totalMs: null, lap: 2, s: 500, progress: 14500 },
    ];
    const received: RaceOverPayload[] = [];
    beto.onRaceOver((_from, payload) => received.push(payload));

    ana.sendRaceOver({ standings });

    expect(received).toHaveLength(1);
    expect(parseRaceOverPayload(received[0])).toEqual({ standings });
  });

  it('onRaceState/onRaceFinish/onRaceOver devuelven desuscripción que funciona', () => {
    const { ana, beto } = makePair();
    const onState = vi.fn();
    const offState = beto.onRaceState(onState);
    const onFinish = vi.fn();
    const offFinish = beto.onRaceFinish(onFinish);

    offState();
    offFinish();
    ana.sendRaceState({ s: 1, o: 0, v: 0, lap: 0 });
    ana.sendRaceFinish({ totalMs: 1, bestLapMs: 1 });

    expect(onState).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('sin sala los envíos son no-op silenciosos (mismo contrato que sendState)', () => {
    const hub = new FakeNetHub();
    const lone = new FakeNetClient(hub, { peerId: 'race-3-carla' });
    // Sin create/join: send no debe lanzar (el fake filtra por `word`).
    expect(() => lone.sendRaceState({ s: 0, o: 0, v: 0, lap: 0 })).not.toThrow();
    expect(() => lone.sendRaceFinish({ totalMs: 0, bestLapMs: 0 })).not.toThrow();
    expect(() => lone.sendRaceOver({ standings: [] })).not.toThrow();
  });
});

/**
 * Fixture mínima del cliente Trystero (misma forma que la de
 * trysteroNetClient.test.ts, recortada a lo que este archivo usa).
 */
function createClientFixture(selfPeerId: string): {
  client: TrysteroNetClient;
  room(): FakeTrysteroRoom;
} {
  let latest: FakeTrysteroRoom | null = null;
  const client = new TrysteroNetClient({
    roomFactory: (_appId: string, _roomId: string) => {
      latest = new FakeTrysteroRoom();
      return latest;
    },
    selfIdProvider: () => selfPeerId,
    wordRng: mulberry32(7),
  });
  return {
    client,
    room(): FakeTrysteroRoom {
      if (!latest) {
        throw new Error('la room no fue creada todavía');
      }
      return latest as FakeTrysteroRoom;
    },
  };
}

describe('TrysteroNetClient — acciones de carrera (namespaces rstate/rfin/race-over)', () => {
  function joinedPair(): ReturnType<typeof createClientFixture> {
    const fixture = createClientFixture('race-self');
    fixture.client.create({ appId: 'app', name: 'Ana' });
    return fixture;
  }

  it('sendRaceState envía por la acción rstate el payload tal cual', () => {
    const net = joinedPair();
    net.client.sendRaceState({ s: 3200, o: 15, v: 280, lap: 1 });
    const sends = net.room().recorded<RaceStatePayload>('rstate').sends;
    expect(sends).toHaveLength(1);
    expect(sends[0].data).toEqual({ s: 3200, o: 15, v: 280, lap: 1 });
  });

  it('onRaceState dispara con (peerId, payload) al recibir por rstate', () => {
    const net = joinedPair();
    const handler = vi.fn();
    net.client.onRaceState(handler);

    net.room().receive<RaceStatePayload>('rstate', { s: 100, o: 0, v: 10, lap: 0 }, 'peer-x');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('peer-x', { s: 100, o: 0, v: 10, lap: 0 });
  });

  it('rfin y race-over viajan por SUS namespaces con el payload íntegro', () => {
    const net = joinedPair();
    const onFinish = vi.fn();
    const onOver = vi.fn();
    net.client.onRaceFinish(onFinish);
    net.client.onRaceOver(onOver);

    const standings: RaceFinalStanding[] = [
      { peerId: 'peer-x', position: 1, status: 'finished', totalMs: 90000, lap: 3, s: 0, progress: 21000 },
    ];
    net.room().receive<RaceFinishPayload>('rfin', { totalMs: 90000, bestLapMs: 29500 }, 'peer-x');
    net.room().receive<RaceOverPayload>('race-over', { standings }, 'peer-x');

    expect(onFinish).toHaveBeenCalledWith('peer-x', { totalMs: 90000, bestLapMs: 29500 });
    expect(onOver).toHaveBeenCalledWith('peer-x', { standings });
    expect(net.room().recorded('rfin').sends).toHaveLength(0); // sólo recibió
  });

  it('los envíos de carrera sin sala activa emiten error (con withRoom)', () => {
    const net = createClientFixture('race-self-2');
    const onError = vi.fn();
    net.client.onError(onError);

    net.client.sendRaceState({ s: 0, o: 0, v: 0, lap: 0 });

    expect(onError).toHaveBeenCalledWith('No hay sala activa');
  });

  it('leave() apaga los listeners de la room para las acciones nuevas también', () => {
    const net = joinedPair();
    const room: TrysteroRoom = net.room();
    net.client.leave();
    expect(room.onPeerJoin).toBeNull();
    expect(room.onPeerLeave).toBeNull();
  });
});
