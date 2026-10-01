/**
 * FakeSocialHub — la "red social" en memoria para tests de integración.
 *
 * Extraído de `trysteroChatClient.test.ts` (C2) para reutilizarlo en los
 * tests de C3 (DM/invite) y de la sesión social (`socialChatSession`):
 * conecta rooms fake (`FakeTrysteroRoom`) entre sí con la semántica de
 * Trystero:
 *
 * - Entrega de acciones BROADCAST (a todos los miembros) o DIRIGIDA (solo
 *   al `target`, string único — lo único que usan los clientes). Esta es la
 *   semántica del dirigido que C3 verifica: un dm/invite con target NO
 *   llega a los terceros.
 * - `onPeerJoin` dispara en AMBOS extremos de cada conexión nueva.
 * - Dos formas de irse: `disconnect` (educada, dispara onPeerLeave en los
 *   demás) y `drop` (abrupta, nadie se entera — la cubre el stale).
 *
 * ASENTAMIENTO: en Trystero la malla se descubre ASÍNCRONA después de que
 * `joinRoom` vuelve y el cliente cableó sus handlers — nunca adentro de la
 * propia factory. El hub modela eso: la factory solo REGISTRA al miembro
 * (para que el routing de acciones ya funcione) y encola el aviso mutuo de
 * join; `settle()` lo dispara cuando los clientes ya están cableados.
 */

import type {
  ActionSendOptions,
  RoomFactory,
  TrysteroAction,
} from '../../net/TrysteroNetClient';
import { FakeTrysteroRoom } from './FakeTrysteroRoom';

/** Room fake enchufada al hub: sus envíos se enrutan a los demás miembros. */
export class HubRoom extends FakeTrysteroRoom {
  constructor(
    private readonly hub: FakeSocialHub,
    private readonly ownPeerId: string,
  ) {
    super();
  }

  override makeAction<T>(namespace: string): TrysteroAction<T> {
    const action = super.makeAction<T>(namespace);
    const baseSend = action.send.bind(action);
    action.send = (data: T, options?: ActionSendOptions) => {
      baseSend(data, options);
      // El hub modela envío dirigido a UN peer (lo único que usan los
      // clientes): target no-string cuenta como broadcast.
      const target = options?.target ?? null;
      this.hub.route(this.ownPeerId, namespace, data, typeof target === 'string' ? target : null);
    };
    return action;
  }

  override leave(): void {
    super.leave();
    this.hub.disconnect(this.ownPeerId); // leave educado: los demás se enteran
  }
}

export class FakeSocialHub {
  private readonly rooms = new Map<string, Map<string, HubRoom>>();
  private readonly roomOf = new Map<string, { roomId: string; room: HubRoom }>();
  private readonly pendingJoins: Array<{ roomId: string; peerId: string }> = [];

  factoryFor(peerId: string): RoomFactory {
    return (_appId, roomId) => {
      const room = new HubRoom(this, peerId);
      let members = this.rooms.get(roomId);
      if (!members) {
        members = new Map();
        this.rooms.set(roomId, members);
      }
      members.set(peerId, room);
      this.roomOf.set(peerId, { roomId, room });
      this.pendingJoins.push({ roomId, peerId });
      return room;
    };
  }

  /** Dispara los joins pendientes: onPeerJoin en AMBOS extremos, en orden. */
  settle(): void {
    const joins = this.pendingJoins.splice(0);
    for (const { roomId, peerId } of joins) {
      const members = this.rooms.get(roomId);
      if (!members) {
        continue;
      }
      for (const [existingPeerId, existingRoom] of members) {
        if (existingPeerId === peerId) {
          continue;
        }
        existingRoom.connectPeer(peerId); // el residente ve llegar al nuevo
        members.get(peerId)?.connectPeer(existingPeerId); // el nuevo ve al residente
      }
    }
  }

  /** Entrega una acción de `from` a los demás miembros de su sala. */
  route(from: string, namespace: string, data: unknown, target: string | null): void {
    const entry = this.roomOf.get(from);
    if (!entry) {
      return;
    }
    const members = this.rooms.get(entry.roomId);
    if (!members) {
      return;
    }
    for (const [peerId, room] of members) {
      if (peerId === from) {
        continue; // Trystero no echa las acciones al emisor
      }
      if (target !== null && peerId !== target) {
        continue; // DIRIGIDO: los terceros no reciben nada
      }
      room.receive(namespace, data, from);
    }
  }

  /** Salida EDUCADA (leave): los demás reciben onPeerLeave. */
  disconnect(peerId: string): void {
    const entry = this.roomOf.get(peerId);
    if (!entry) {
      return;
    }
    const members = this.rooms.get(entry.roomId);
    members?.delete(peerId);
    this.roomOf.delete(peerId);
    if (members) {
      for (const [, room] of members) {
        room.disconnectPeer(peerId);
      }
    }
  }

  /** Salida ABRUPTA (pestaña muerta): nadie recibe onPeerLeave. */
  drop(peerId: string): void {
    const entry = this.roomOf.get(peerId);
    if (!entry) {
      return;
    }
    this.rooms.get(entry.roomId)?.delete(peerId);
    this.roomOf.delete(peerId);
  }
}
