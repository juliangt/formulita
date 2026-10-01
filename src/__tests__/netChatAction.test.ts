import { describe, expect, it, vi } from 'vitest';
import { CHAT_MAX_LEN } from '../config/balance';
import type { ChatPayload } from '../net/protocol';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * Acción `chat` del NetClient (C1, issue #2) sobre FakeNetClient/hub: mismo
 * contrato que TrysteroNetClient — broadcast a todos los demás, payload YA
 * sanitizado, desuscripción por evento. El cableado fino de la room fake de
 * Trystero está en trysteroNetClient.test.ts.
 */

/** Host + 2 joiners ya dentro de la misma sala del hub. */
function createRoom(): { hub: FakeNetHub; host: FakeNetClient; guests: FakeNetClient[] } {
  const hub = new FakeNetHub();
  const host = new FakeNetClient(hub, { peerId: 'host-1' });
  host.create({ appId: 'formulita-dev', name: 'Ana' });
  const guests = ['Beto', 'Carla'].map((name, index) => {
    const guest = new FakeNetClient(hub, { peerId: `guest-${index}` });
    guest.join({ appId: 'formulita-dev', roomWord: host.roomWord ?? '', name });
    return guest;
  });
  return { hub, host, guests };
}

/** Suscribe a un cliente y devuelve lo que le llegó (from + payload). */
function recordChat(client: FakeNetClient): {
  arrived: Array<{ from: string; payload: ChatPayload }>;
  unsubscribe: () => void;
} {
  const arrived: Array<{ from: string; payload: ChatPayload }> = [];
  const unsubscribe = client.onChat((from, payload) => arrived.push({ from, payload }));
  return { arrived, unsubscribe };
}

describe('NetClient — acción chat (C1)', () => {
  it('A envía sendChat → TODOS los demás reciben onChat con SU peerId y el payload', () => {
    const { host, guests } = createRoom();
    const beto = recordChat(guests[0]);
    const carla = recordChat(guests[1]);

    host.sendChat('hola sala');

    expect(beto.arrived).toEqual([{ from: 'host-1', payload: { text: 'hola sala' } }]);
    expect(carla.arrived).toEqual([{ from: 'host-1', payload: { text: 'hola sala' } }]);
  });

  it('el emisor NO recibe su propio chat (broadcast sin eco)', () => {
    const { host } = createRoom();
    const spy = vi.fn();
    host.onChat(spy);

    host.sendChat('eco?');

    expect(spy).not.toHaveBeenCalled();
  });

  it('el texto viaja YA sanitizado: trim, whitespace colapsado y máx CHAT_MAX_LEN', () => {
    const { host, guests } = createRoom();
    const beto = recordChat(guests[0]);

    host.sendChat('  hola\n  sala   de   juego  ');
    host.sendChat('x'.repeat(CHAT_MAX_LEN + 500));

    expect(beto.arrived[0]?.payload.text).toBe('hola sala de juego');
    expect(beto.arrived[1]?.payload.text.length).toBe(CHAT_MAX_LEN);
    expect(CHAT_MAX_LEN).toBe(200);
  });

  it('la desuscripción corta SOLO a quien se desuscribió', () => {
    const { host, guests } = createRoom();
    const beto = recordChat(guests[0]);
    const carla = recordChat(guests[1]);

    beto.unsubscribe();
    host.sendChat('¿alguien?');

    expect(beto.arrived).toHaveLength(0);
    expect(carla.arrived).toHaveLength(1);
  });

  it('sendChat fuera de una sala es un no-op seguro (nada viaja, nadie escucha)', () => {
    const hub = new FakeNetHub();
    const suelto = new FakeNetClient(hub, { peerId: 'suelto' });
    const otro = new FakeNetClient(hub, { peerId: 'otro' });
    const spy = vi.fn();
    otro.onChat(spy);

    expect(() => suelto.sendChat('sin sala')).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
