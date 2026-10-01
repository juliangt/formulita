/**
 * FakeTrysteroRoom — doble estructural de una room de Trystero para tests.
 *
 * Extraído de `trysteroNetClient.test.ts` (M1) para reutilizarlo en los tests
 * de `TrysteroChatClient` (C2): misma forma que el subconjunto `TrysteroRoom`
 * que consumen los clientes (makeAction/onPeerJoin/onPeerLeave/getPeers/
 * leave), sin WebRTC ni señalización. Los tests controlan la "red" a mano:
 * `connectPeer`/`disconnectPeer` simulan peers remotos y `receive` entrega
 * mensajes de acción como si llegaran por la malla.
 */

import type {
  ActionSendOptions,
  TrysteroAction,
  TrysteroRoom,
} from '../../net/TrysteroNetClient';

/** Acción fake: registra los envíos y permite disparar onMessage. */
export interface RecordedAction<T> extends TrysteroAction<T> {
  readonly sends: Array<{ data: T; options?: ActionSendOptions }>;
}

/** Doble de la room de Trystero: mismo subconjunto estructural que usa el cliente. */
export class FakeTrysteroRoom implements TrysteroRoom {
  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  /** Peers "conectados" (lo que devolvería getPeers de Trystero). */
  peers: Record<string, unknown> = {};
  left = false;
  readonly calls: Array<{ appId: string; roomId: string }> = [];
  private readonly actions = new Map<string, RecordedAction<never>>();

  makeAction<T>(namespace: string): TrysteroAction<T> {
    const existing = this.actions.get(namespace);
    if (existing) {
      return existing as unknown as TrysteroAction<T>;
    }
    const action: RecordedAction<never> = {
      sends: [],
      send: ((data: never, options?: ActionSendOptions) => {
        action.sends.push({ data, options });
      }) as never,
      onMessage: null,
    };
    this.actions.set(namespace, action);
    return action as unknown as TrysteroAction<T>;
  }

  /** Acción grabada por namespace (para inspeccionar sends/disparar onMessage). */
  recorded<T>(namespace: string): RecordedAction<T> {
    return this.actions.get(namespace) as unknown as RecordedAction<T>;
  }

  getPeers(): Readonly<Record<string, unknown>> {
    return this.peers;
  }

  leave(): void {
    this.left = true;
  }

  /** Simula la conexión de un peer remoto (dispara onPeerJoin local). */
  connectPeer(peerId: string): void {
    this.peers[peerId] = {};
    this.onPeerJoin?.(peerId);
  }

  /** Simula la desconexión de un peer remoto (dispara onPeerLeave local). */
  disconnectPeer(peerId: string): void {
    delete this.peers[peerId];
    this.onPeerLeave?.(peerId);
  }

  /** Entrega un mensaje de acción como si viniera de un peer remoto. */
  receive<T>(namespace: string, data: T, from: string): void {
    const action = this.recorded<T>(namespace);
    action.onMessage?.(data, { peerId: from });
  }
}
