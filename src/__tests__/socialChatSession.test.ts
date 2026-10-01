import { describe, expect, it, vi } from 'vitest';
import {
  destroySocialChatSession,
  getSocialChatSession,
  setSocialChatSession,
  SOCIAL_CHAT_REGISTRY_KEY,
  SocialChatSession,
} from '../chat/socialChatSession';
import { getSessionChatStore } from '../chat/chatSession';
import { setSessionChatClient } from '../chat/chatClientSession';
import { toggleAvailability } from '../chat/presenceView';
import {
  CHAT_SETTINGS_REGISTRY_KEY,
  LocalStorageChatSettingsRepository,
  type IChatSettingsRepository,
} from '../data/ChatSettingsRepository';
import { PLAYER_PROFILE_REGISTRY_KEY } from '../data/PlayerProfileRepository';
import type { AvailablePeer, ChatClient } from '../net/ChatClient';
import type { DmPayload, InvitePayload } from '../net/protocol';
import { FakeStorage } from './fakeStorage';

/**
 * Tests de la sesión SOCIAL de chat (C3): el cableado ChatClient ↔ ChatStore
 * que vive toda la pestaña (los DM llegan con el overlay cerrado — el badge
 * del menú los cuenta), más la invitación PENDIENTE que el próximo ChatScene
 * muestra como banner. Mismo patrón que chatSession/chatClientSession: el
 * registry de Phaser como buzón y un doble de ChatClient con los handlers
 * capturados para disparar la "red" a mano.
 */

/** Handler capturado por el doble (lo dispara el test como si fuera red). */
type Captured<TArgs extends unknown[]> = {
  publish(...args: TArgs): void;
};

/** Doble de ChatClient: handlers capturables + spies de lo que la sesión hace. */
function fakeChatClient(selfPeerId = 'me'): ChatClient & {
  dm: Captured<[string, DmPayload]>;
  peers: Captured<[AvailablePeer[]]>;
  invite: Captured<[string, InvitePayload]>;
  setAvailableCalls: boolean[];
} {
  const dmHandlers = new Set<(from: string, payload: DmPayload) => void>();
  const peersHandlers = new Set<(peers: AvailablePeer[]) => void>();
  const inviteHandlers = new Set<(from: string, payload: InvitePayload) => void>();
  const setAvailableCalls: boolean[] = [];
  const capture = <TArgs extends unknown[]>(set: Set<(...args: TArgs) => void>): Captured<TArgs> => ({
    publish: (...args: TArgs) => {
      for (const handler of set) {
        handler(...args);
      }
    },
  });
  return {
    selfPeerId,
    setAvailable: (available: boolean) => {
      setAvailableCalls.push(available);
    },
    isAvailable: () => false,
    getAvailablePeers: () => [],
    updateSelf: vi.fn(),
    sendDm: vi.fn(),
    onDm: (handler: (from: string, payload: DmPayload) => void) => {
      dmHandlers.add(handler);
      return () => dmHandlers.delete(handler);
    },
    sendInvite: vi.fn(),
    onInvite: (handler: (from: string, payload: InvitePayload) => void) => {
      inviteHandlers.add(handler);
      return () => inviteHandlers.delete(handler);
    },
    onAvailablePeers: (handler: (peers: AvailablePeer[]) => void) => {
      peersHandlers.add(handler);
      return () => peersHandlers.delete(handler);
    },
    onError: () => () => undefined,
    destroy: vi.fn(),
    dm: capture(dmHandlers),
    peers: capture(peersHandlers),
    invite: capture(inviteHandlers),
    setAvailableCalls,
  } as unknown as ReturnType<typeof fakeChatClient>;
}

/** Registry falso con la porción que las sesiones consumen (get/set/remove). */
function fakeRegistry(): {
  registry: { get(k: string): unknown; set(k: string, v: unknown): unknown; remove(k: string): unknown };
  dump(): Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  return {
    registry: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => store.set(key, value),
      remove: (key: string) => store.delete(key),
    },
    dump: () => store,
  };
}

/** Fixture: registry + doble de ChatClient + perfil persistido inyectados. */
function createSessionFixture(profileName = 'Tester') {
  const { registry, dump } = fakeRegistry();
  const client = fakeChatClient();
  setSessionChatClient(registry, client);
  registry.set(PLAYER_PROFILE_REGISTRY_KEY, {
    load: () => ({ name: profileName }),
    save: vi.fn(),
  });
  return { registry, dump, client };
}

/** Repo de ajustes fake en memoria (se inyecta por el registry del fixture). */
function memoryChatSettings(showAvailable: boolean): IChatSettingsRepository {
  let current = showAvailable;
  return {
    load: () => ({ showAvailable: current }),
    save: (settings) => {
      current = settings.showAvailable;
    },
  };
}

const BETO_PEER: AvailablePeer = { peerId: 'bb-beto', name: 'Beto', color: 0x3c6cd6 };
const ANA_PEER: AvailablePeer = { peerId: 'aa-ana', name: 'Ana', color: 0xd63c3c };

describe('socialChatSession — servicio compartido por registry', () => {
  it('get cachea la sesión: lecturas repetidas ven LA MISMA (y queda publicada)', () => {
    const { registry, dump } = createSessionFixture();

    const first = getSocialChatSession(registry);
    expect(getSocialChatSession(registry)).toBe(first); // no entrega única
    expect(dump().get(SOCIAL_CHAT_REGISTRY_KEY)).toBe(first);
  });

  it('responder la sesión NO conecta a nada (privacidad by default)', () => {
    const { registry, client } = createSessionFixture();

    getSocialChatSession(registry);

    expect(client.setAvailableCalls).toEqual([]); // jamás setAvailable(true)
  });

  it('get descarta basura en la clave: solo acepta forma de sesión social', () => {
    const { registry } = createSessionFixture();
    registry.set(SOCIAL_CHAT_REGISTRY_KEY, { getLatestInvite: () => null }); // incompleto
    expect(getSocialChatSession(registry)).toBeInstanceOf(SocialChatSession);

    registry.set(SOCIAL_CHAT_REGISTRY_KEY, 42);
    expect(getSocialChatSession(registry)).toBeInstanceOf(SocialChatSession);
  });

  it('setSocialChatSession respeta la inyección (tests pueden falsificarla)', () => {
    const { registry } = createSessionFixture();
    const session = getSocialChatSession(registry);
    const injected = new SocialChatSession(registry);
    setSocialChatSession(registry, injected);

    expect(getSocialChatSession(registry)).toBe(injected);
    expect(getSocialChatSession(registry)).not.toBe(session);
    injected.destroy();
  });

  it('el store de la sesión se crea con el NOMBRE DEL PERFIL persistido', () => {
    const { registry } = createSessionFixture('Ralph');
    const session = getSocialChatSession(registry);

    expect(session.store.getSelf()).toMatchObject({ name: 'Ralph', peerId: 'me' });
    // Perfil sin nombre usable → PILOTO (identidad provisoria).
    const { registry: blankRegistry } = createSessionFixture('   ');
    expect(getSocialChatSession(blankRegistry).store.getSelf().name).toBe('PILOTO');
  });

  it('el store queda PUBLICADO como store de sesión (el lobby lo reusa)', () => {
    const { registry } = createSessionFixture();
    const session = getSocialChatSession(registry);

    expect(getSessionChatStore(registry)).toBe(session.store);
  });

  it('destroy suelta el cableado y retira la sesión (sin tocar cliente ni store)', () => {
    const { registry, dump, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    const store = session.store;

    destroySocialChatSession(registry);

    expect(dump().has(SOCIAL_CHAT_REGISTRY_KEY)).toBe(false);
    expect(client.destroy).not.toHaveBeenCalled(); // el cliente es otro servicio
    expect(getSessionChatStore(registry)).toBe(store); // el store sigue publicado

    // Y tras el destroy, los eventos del cliente ya NO tocan el store.
    client.dm.publish('bb-beto', { text: '¿sigues ahí?', targetPeerId: 'me' });
    expect(store.getMessages('bb-beto')).toHaveLength(0);
  });

  it('destroy sin sesión (o con basura) es no-op sin lanzar', () => {
    const { registry } = createSessionFixture();
    expect(() => destroySocialChatSession(registry)).not.toThrow();
    registry.set(SOCIAL_CHAT_REGISTRY_KEY, 'basura');
    expect(() => destroySocialChatSession(registry)).not.toThrow();
  });
});

describe('socialChatSession — DM con el overlay CERRADO (badge del menú)', () => {
  it('un dm que llega entra al hilo del remitente y suma no leídos', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);

    // La red entrega un dm de Beto (visible en MI lista viva).
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);
    client.dm.publish('bb-beto', { text: 'hola!', targetPeerId: 'me' });

    const thread = session.store.getMessages('bb-beto');
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      fromPeerId: 'bb-beto',
      fromName: 'Beto',
      color: 0x3c6cd6,
      text: 'hola!',
      mine: false,
    });
    expect(session.store.getUnreadCount('bb-beto')).toBe(1);
    expect(session.store.totalUnread).toBe(1); // lo que pinta el badge del menú
  });

  it('un dm de un peer que ya no está en la lista viva degrada a PILOTO', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([]); // se fue

    client.dm.publish('zz-fantasma', { text: '¿hay alguien?', targetPeerId: 'me' });

    expect(session.store.getMessages('zz-fantasma')[0]).toMatchObject({
      fromName: 'PILOTO',
      color: 0x9aa5b4,
    });
  });

  it('un dm de un peer BLOQUEADO se descarta antes de entrar', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);
    session.store.blockPeer('bb-beto');

    client.dm.publish('bb-beto', { text: 'insiste', targetPeerId: 'me' });

    expect(session.store.hasThread('bb-beto')).toBe(false);
    expect(session.store.totalUnread).toBe(0);
  });
});

describe('socialChatSession — disponibilidad de hilos con la lista viva', () => {
  it('onAvailablePeers sincroniza los hilos de DM (ACTIVO ↔ DESCONECTADO)', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);
    client.dm.publish('bb-beto', { text: 'hola', targetPeerId: 'me' });
    expect(session.store.isThreadDisconnected('bb-beto')).toBe(false);

    // Beto se va de la sala pública: la lista viva ya no lo trae.
    client.peers.publish([]);

    expect(session.store.isThreadDisconnected('bb-beto')).toBe(true);
    expect(session.store.getMessages('bb-beto')).toHaveLength(1); // historial intacto
  });
});

describe('socialChatSession — invitaciones pendientes (banner de ChatScene)', () => {
  it('una invitación válida queda pendiente y avisa a los handlers en vivo', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    const onInvite = vi.fn();
    session.onInviteReceived(onInvite);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);

    client.invite.publish('bb-beto', { keyword: 'PARRILLA' });

    expect(session.getLatestInvite()).toEqual({ from: BETO_PEER, keyword: 'PARRILLA' });
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onInvite).toHaveBeenCalledWith({ from: BETO_PEER, keyword: 'PARRILLA' });
  });

  it('una invitación con keyword INVÁLIDA se ignora (defensa extra del wire)', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    const onInvite = vi.fn();
    session.onInviteReceived(onInvite);

    client.invite.publish('bb-beto', { keyword: 'ABC' }); // muy corta
    client.invite.publish('bb-beto', { keyword: '' }); // vacía

    expect(session.getLatestInvite()).toBeNull();
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('un invitador desconocido degrada a PILOTO con color neutro', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([ANA_PEER]); // Beto no está

    client.invite.publish('bb-beto', { keyword: 'PARRILLA' });

    expect(session.getLatestInvite()).toEqual({
      from: { peerId: 'bb-beto', name: 'PILOTO', color: 0x9aa5b4 },
      keyword: 'PARRILLA',
    });
  });

  it('clearLatestInvite descarta la pendiente (IGNORAR/UNIRSE del banner)', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);
    client.invite.publish('bb-beto', { keyword: 'PARRILLA' });

    session.clearLatestInvite();

    expect(session.getLatestInvite()).toBeNull();
  });

  it('una nueva invitación PISA la pendiente anterior (solo la última importa)', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER, ANA_PEER]);

    client.invite.publish('bb-beto', { keyword: 'PARRILLA' });
    client.invite.publish('aa-ana', { keyword: 'CHICANE' });

    expect(session.getLatestInvite()).toEqual({ from: ANA_PEER, keyword: 'CHICANE' });
  });

  it('el unsubscribe de onInviteReceived corta el aviso en vivo', () => {
    const { registry, client } = createSessionFixture();
    const session = getSocialChatSession(registry);
    const onInvite = vi.fn();
    const unsubscribe = session.onInviteReceived(onInvite);
    vi.spyOn(client, 'getAvailablePeers').mockReturnValue([BETO_PEER]);

    unsubscribe();
    client.invite.publish('bb-beto', { keyword: 'PARRILLA' });

    expect(onInvite).not.toHaveBeenCalled();
    // La pendiente igual queda para quien abra el chat después.
    expect(session.getLatestInvite()?.keyword).toBe('PARRILLA');
  });
});

describe('socialChatSession — disponibilidad persistida al CREARSE (auditoría #2, MENOR 2)', () => {
  it('ajuste SÍ: la sesión recién creada reconecta sola (join + heartbeat)', () => {
    const { registry, client } = createSessionFixture();
    registry.set(CHAT_SETTINGS_REGISTRY_KEY, memoryChatSettings(true));

    getSocialChatSession(registry);

    expect(client.setAvailableCalls).toEqual([true]); // disponible SIN abrir el chat
  });

  it('PRIVACIDAD: con el default NO, crear la sesión NI toca setAvailable (cero conexiones)', () => {
    const { registry, client } = createSessionFixture();
    registry.set(CHAT_SETTINGS_REGISTRY_KEY, memoryChatSettings(false));

    getSocialChatSession(registry);

    expect(client.setAvailableCalls).toEqual([]); // ni siquiera un setAvailable(false)
  });

  it('toggle OFF persiste: una sesión NUEVA (recarga) sobre el mismo storage ya no conecta', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageChatSettingsRepository(storage);
    repo.save({ showAvailable: true }); // quien dejó SÍ

    // Primera sesión (antes de la recarga): conecta por el ajuste persistido.
    const first = createSessionFixture();
    first.registry.set(CHAT_SETTINGS_REGISTRY_KEY, repo);
    getSocialChatSession(first.registry);
    expect(first.client.setAvailableCalls).toEqual([true]);

    // El usuario apaga el toggle (lo que hace el botón de PÚBLICO).
    expect(toggleAvailability(repo, first.client)).toBe(false);
    expect(first.client.setAvailableCalls).toEqual([true, false]); // leave real

    // "Recarga": registry nuevo (pestaña nueva), MISMO storage, cliente nuevo.
    const reloaded = createSessionFixture();
    reloaded.registry.set(CHAT_SETTINGS_REGISTRY_KEY, repo);
    getSocialChatSession(reloaded.registry);

    expect(reloaded.client.setAvailableCalls).toEqual([]); // ya no conecta
  });
});
