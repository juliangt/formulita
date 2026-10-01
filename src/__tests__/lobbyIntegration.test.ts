import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';
import type { StartPayload } from '../net/protocol';

/**
 * Integración del lobby (M1) con 2+ FakeNetClient conectados al mismo hub:
 * mismo contrato que TrysteroNetClient (misma semántica, otro transporte).
 * Cubre el flujo completo visto por los JUGADORES: crear → unirse → roster
 * idéntico en todos → start con seed y jugadores → migración de anfitrión
 * al irse el creador → capacidad (el 11º rechazado).
 */

/** Crea el host + N joiners ya dentro de la sala. */
function createRoom(
  hostName: string,
  guestNames: string[],
): { hub: FakeNetHub; host: FakeNetClient; guests: FakeNetClient[] } {
  const hub = new FakeNetHub();
  const host = new FakeNetClient(hub, { peerId: 'host-1' });
  host.create({ appId: 'formulita-dev', name: hostName });
  const guests = guestNames.map((name, index) => {
    const guest = new FakeNetClient(hub, { peerId: `guest-${index}-${name.toLowerCase()}` });
    guest.join({ appId: 'formulita-dev', roomWord: host.roomWord ?? '', name });
    return guest;
  });
  return { hub, host, guests };
}

describe('Integración lobby — roster idéntico en todos los clientes', () => {
  it('host + 2 joiners: los tres ven exactamente el mismo roster (con colores)', () => {
    const { host, guests } = createRoom('Ana', ['Beto', 'Carla']);
    const [beto, carla] = guests;

    const hostRoster = host.getRoster();
    expect(hostRoster.length).toBe(3);
    expect(hostRoster.map((p) => p.name).sort()).toEqual(['Ana', 'Beto', 'Carla']);

    // Mismo roster (peerIds, nombres Y colores derivados) en los tres.
    expect(beto.getRoster()).toEqual(hostRoster);
    expect(carla.getRoster()).toEqual(hostRoster);

    // Colores únicos y de la paleta.
    const colors = hostRoster.map((p) => p.color);
    expect(new Set(colors).size).toBe(3);
    for (const color of colors) {
      expect(MULTIPLAYER.palette).toContain(color);
    }
  });

  it('todos acuerdan el anfitrión (el creador)', () => {
    const { host, guests } = createRoom('Ana', ['Beto']);
    expect(host.getHostPeerId()).toBe(host.selfPeerId);
    for (const guest of guests) {
      expect(guest.getHostPeerId()).toBe(host.selfPeerId);
      expect(guest.isHost()).toBe(false);
    }
  });

  it('un cuarto jugador que entra después ve el mismo roster que los demás', () => {
    const { hub, host } = createRoom('Ana', ['Beto', 'Carla']);
    const late = new FakeNetClient(hub, { peerId: 'zz-late' });
    late.join({ appId: 'formulita-dev', roomWord: host.roomWord ?? '', name: 'Dani' });

    expect(late.getRoster().length).toBe(4);
    expect(host.getRoster()).toEqual(late.getRoster());
  });
});

describe('Integración lobby — start', () => {
  it('el anfitrión difunde start y todos reciben seed + jugadores + startAt', () => {
    const { host, guests } = createRoom('Ana', ['Beto', 'Carla']);
    const received: StartPayload[] = [];
    guests.forEach((guest) => guest.onStart((payload) => received.push(payload)));

    const players = host.getRoster();
    const payload: StartPayload = { seed: 987654321, players, startAt: 1700000000000 };
    host.start(payload);

    expect(received.length).toBe(2);
    for (const got of received) {
      expect(got.seed).toBe(987654321);
      expect(got.players).toEqual(players);
      expect(got.startAt).toBe(1700000000000);
    }
  });

  it('el host no recibe su propio start por la red (arranca local)', () => {
    const { host } = createRoom('Ana', ['Beto']);
    const onStart = vi.fn();
    host.onStart(onStart);

    host.start({ seed: 1, players: host.getRoster(), startAt: 0 });

    expect(onStart).not.toHaveBeenCalled();
  });

  it('un joiner no puede difundir start', () => {
    const { host, guests } = createRoom('Ana', ['Beto']);
    const onStart = vi.fn();
    host.onStart(onStart);
    const onError = vi.fn();
    guests[0].onError(onError);

    guests[0].start({ seed: 2, players: guests[0].getRoster(), startAt: 0 });

    expect(onStart).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('Integración lobby — migración de anfitrión', () => {
  it('al irse el creador, los restantes acuerdan el nuevo anfitrión (peerId menor)', () => {
    const { host, guests } = createRoom('Ana', ['Beto', 'Carla']);
    const hostChanges: string[][] = [[], []];
    guests.forEach((guest, index) => guest.onHostChange((next) => hostChanges[index].push(next)));

    host.leave();

    // Sin creador: anfitrión = peerId menor entre los presentes.
    const expected = guests[0].selfPeerId < guests[1].selfPeerId
      ? guests[0].selfPeerId
      : guests[1].selfPeerId;
    expect(guests[0].getHostPeerId()).toBe(expected);
    expect(guests[1].getHostPeerId()).toBe(expected);
    expect(hostChanges[0]).toEqual([expected]);
    expect(hostChanges[1]).toEqual([expected]);
    expect(guests.find((g) => g.selfPeerId === expected)?.isHost()).toBe(true);
  });

  it('el roster del superviviente pierde al que se fue y los colores se re-derivan', () => {
    const { host, guests } = createRoom('Ana', ['Beto', 'Carla']);
    host.leave();

    const after = guests[0].getRoster();
    expect(after.length).toBe(2);
    expect(after.find((p) => p.name === 'Ana')).toBeUndefined();
    // El color es función del roster: los presentes quedan con los índices
    // 0..n-1 del orden por peerId (los posteriores al que se fue se corren).
    const sortedIds = after.map((p) => p.peerId).sort();
    after.forEach((player, index) => {
      expect(player.peerId).toBe(sortedIds[index]);
      expect(player.color).toBe(MULTIPLAYER.palette[index]);
    });
  });

  it('el nuevo anfitrión puede iniciar tras la migración', () => {
    const { host, guests } = createRoom('Ana', ['Beto']);
    const onStart = vi.fn();
    guests[0].onStart(onStart);
    host.leave();

    const newHost = guests[0];
    expect(newHost.isHost()).toBe(true);
    newHost.start({ seed: 7, players: newHost.getRoster(), startAt: 0 });
    expect(onStart).not.toHaveBeenCalled(); // solo está él: nadie más que escuchar
    // (La habilitación de INICIAR con 2+ la gobierna canStart en lobbyState.)
  });
});

describe('Integración lobby — capacidad', () => {
  it('sala de 10: el 11º entra, se asienta y se va solo con roomFull', () => {
    const { hub, host } = createRoom('Ana', ['B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10']);
    expect(host.getRoster().length).toBe(10); // sala llena de verdad
    const word = host.roomWord ?? '';

    const eleventh = new FakeNetClient(hub, { peerId: 'k-11' });
    const onRoomFull = vi.fn();
    eleventh.onRoomFull(onRoomFull);
    eleventh.join({ appId: 'formulita-dev', roomWord: word, name: 'Once' });

    // Semántica del cliente real: el 11º ENTRA, evalúa SU admisión (en el
    // fake el asentamiento es síncrono: la malla se descubrió completa) y se
    // va solo — roomFull + leave.
    expect(onRoomFull).toHaveBeenCalledTimes(1);
    expect(eleventh.roomWord).toBeNull();
    expect(host.getRoster().length).toBe(10); // el roster volvió a 10
    expect(hub.roomSize(word)).toBe(10); // ...y se fue de la sala de verdad
  });

  it('sin implosión: al entrar (y irse) el 11º, los 10 residentes siguen', () => {
    // Regresión del bug de auditoría: los residentes se auto-expulsaban en
    // cadena cuando el 11º conectaba con todos a la vez. Con la semántica de
    // auto-admisión del joiner, ningún residente se va por capacidad.
    const { hub, host, guests } = createRoom('Ana', ['B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10']);
    const word = host.roomWord ?? '';
    const roomFullCalls = guests.map(() => vi.fn());
    guests.forEach((guest, index) => guest.onRoomFull(roomFullCalls[index]));
    const hostFull = vi.fn();
    host.onRoomFull(hostFull);

    const eleventh = new FakeNetClient(hub, { peerId: 'k-11' });
    eleventh.join({ appId: 'formulita-dev', roomWord: word, name: 'Once' });

    for (const call of [hostFull, ...roomFullCalls]) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(guests.every((guest) => guest.roomWord !== null)).toBe(true);
    expect(host.roomWord).toBe(word);
    expect(hub.roomSize(word)).toBe(10);
  });

  it('la sala número 10 sí entra (máximo exacto) y queda admitida', () => {
    const { hub, host } = createRoom('Ana', ['B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9']);
    const tenth = new FakeNetClient(hub, { peerId: 'j-10' });
    const onRoomFull = vi.fn();
    tenth.onRoomFull(onRoomFull);
    tenth.join({ appId: 'formulita-dev', roomWord: host.roomWord ?? '', name: 'Diez' });

    expect(onRoomFull).not.toHaveBeenCalled();
    expect(host.getRoster().length).toBe(10);
    expect(tenth.getRoster().length).toBe(10);
    expect(hub.roomSize(host.roomWord ?? '')).toBe(10);
  });

  it('palabra inválida no entra a ningún lado (error visible)', () => {
    const { hub } = createRoom('Ana', ['Beto']);
    const client = new FakeNetClient(hub, { peerId: 'x-1' });
    const onError = vi.fn();
    client.onError(onError);

    client.join({ appId: 'app', roomWord: 'NO!!', name: 'X' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(client.roomWord).toBeNull();
  });
});
