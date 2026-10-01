/**
 * socialChatSession.ts — la sesión SOCIAL de chat (issue #2, C3).
 *
 * El chat directo es un servicio de PESTAÑA, igual que la sala pública de
 * presencia (`chatClientSession`): los DM llegan aunque el overlay esté
 * cerrado (el badge del menú los cuenta), así que el cableado
 * ChatClient ↔ ChatStore NO puede vivir en ChatScene (moriría al cerrarla).
 * Este módulo es el ÚNICO dueño de ese cableado, resuelto UNA vez por
 * sesión y compartido por registry (mismo patrón que `getChatClient`):
 *
 * 1. Asegura el ChatClient de sesión (`getChatClient`) y el ChatStore de
 *    sesión (`ensureSessionChatStore`, creado on-demand con el NOMBRE DEL
 *    PERFIL persistido — C3: el store vive toda la pestaña, el lobby lo
 *    reusa y solo refresca su identidad con el roster de la partida).
 * 2. Suscribe los eventos del cliente AL STORE (una sola vez):
 *    - `onDm` → `receiveDirectMessage` (bloqueo descarta ANTES de entrar).
 *    - `onAvailablePeers` → `syncDmThreadAvailability` (hilos ACTIVO/
 *      DESCONECTADO según la lista viva de la sala pública).
 *    - `onInvite` → guarda la última invitación y avisa a los handlers.
 * 3. La invitación PENDIENTE queda acá (no en la escena): si llega con el
 *    chat cerrado, el próximo ChatScene la muestra como banner.
 *
 * PRIVACIDAD: resolver la sesión NO conecta a nada POR DEFAULT — quien nunca
 * activó el toggle (ajuste persistido NO) no genera NI UNA llamada a
 * `setAvailable`, no hay join, no hay DM, no hay invitaciones. La excepción
 * deliberada (auditoría #2, MENOR 2): si el ajuste persistido es SÍ, el
 * CONSTRUCTOR lo aplica (`applyAvailabilitySetting` → join + heartbeat) para
 * que la preferencia sobreviva la recarga sin abrir el chat; BootScene crea
 * la sesión EAGER al arrancar. Las escenas NUNCA llaman `destroy` sobre la
 * sesión social: vive lo mismo que la pestaña (ver nota en
 * `chatClientSession`).
 */

import type { ChatStore } from './ChatStore';
import { ensureSessionChatStore } from './chatSession';
import { receiveDirectMessage, syncDmThreadAvailability } from './dmChat';
import { getChatClient } from './chatClientSession';
import { applyAvailabilitySetting } from './presenceView';
import { getChatSettingsRepository } from '../data/ChatSettingsRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import type { AvailablePeer, ChatClient } from '../net/ChatClient';
import { isValidRoomWord, sanitizePlayerName, sanitizeRoomWord } from '../net/protocol';

/** Clave del registry de Phaser donde vive la sesión social de chat. */
export const SOCIAL_CHAT_REGISTRY_KEY = 'socialChat';

/** Porción del registry de Phaser que la sesión social consume. */
interface RegistrySlice {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/** Una invitación recibida, lista para el banner (peer resuelto + palabra). */
export interface SocialInvite {
  /** Quién invitó (resuelto contra la lista viva de disponibles). */
  readonly from: AvailablePeer;
  /** Palabra de sala ya sanitizada y validada (A–Z 5–9). */
  readonly keyword: string;
}

/** Nombre de un invitador que ya no está en la lista de disponibles. */
const UNKNOWN_INVITER_NAME = 'PILOTO';
/** Color neutro para el mismo caso (gris claro de la paleta). */
const UNKNOWN_INVITER_COLOR = 0x9aa5b4;
/** Nombre de la identidad social si el perfil aún no tiene nombre usable. */
const PROFILE_FALLBACK_NAME = 'PILOTO';

/**
 * Cableado vivo ChatClient ↔ ChatStore de la sesión. Los mensajes/flujos
 * viven en el store y en el cliente; esta clase SOLO los conecta y conserva
 * la invitación pendiente.
 */
export class SocialChatSession {
  readonly client: ChatClient;
  readonly store: ChatStore;

  private latestInvite: SocialInvite | null = null;
  private readonly inviteHandlers = new Set<(invite: SocialInvite) => void>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor(registry: RegistrySlice) {
    this.client = getChatClient(registry);
    // Identidad inicial de la sesión social: el NOMBRE DEL PERFIL persistido
    // con el peerId de la sala pública (el lobby después la refresca con su
    // roster vía ensureSessionChatStore/updateSelf — mismo peerId de pestaña).
    const profileName = sanitizePlayerName(getPlayerProfileRepository(registry).load().name);
    this.store = ensureSessionChatStore(registry, {
      peerId: this.client.selfPeerId,
      name: profileName.length > 0 ? profileName : PROFILE_FALLBACK_NAME,
      color: 0,
    });
    // Auditoría #2 (MENOR 2) — disponibilidad persistida aplicada AL CREAR la
    // sesión (que BootScene resuelve eager al arrancar): quien dejó el toggle
    // en SÍ vuelve a figurar disponible desde la recarga, sin abrir el chat
    // (criterio C2: SÍ = estoy en la sala pública). PRIVACIDAD: con NO
    // (default) NI se toca el cliente — cero setAvailable, cero conexión;
    // quien nunca activó no conecta jamás. La decisión vive en
    // `applyAvailabilitySetting` (pura, testeada).
    const chatSettings = getChatSettingsRepository(registry);
    if (chatSettings.load().showAvailable) {
      applyAvailabilitySetting(chatSettings, this.client);
    }
    this.unsubscribes.push(
      this.client.onDm((fromPeerId, payload) => {
        receiveDirectMessage(
          this.store,
          this.client.getAvailablePeers(),
          fromPeerId,
          payload,
          Date.now(),
        );
      }),
      this.client.onAvailablePeers((peers) => {
        syncDmThreadAvailability(this.store, peers);
      }),
      this.client.onInvite((fromPeerId, payload) => {
        this.handleInvite(fromPeerId, payload.keyword);
      }),
    );
  }

  /** Última invitación recibida y aún no descartada (null si no hay). */
  getLatestInvite(): SocialInvite | null {
    return this.latestInvite;
  }

  /** Descarta la invitación pendiente (el usuario la ignoró o aceptó). */
  clearLatestInvite(): void {
    this.latestInvite = null;
  }

  /**
   * Suscripción a invitaciones EN VIVO (para el banner si el chat está
   * abierto). La invitación también queda en `getLatestInvite` para quien
   * abra el chat después.
   */
  onInviteReceived(handler: (invite: SocialInvite) => void): () => void {
    this.inviteHandlers.add(handler);
    return () => this.inviteHandlers.delete(handler);
  }

  /**
   * Una invitación llegó: keyword inválida se ignora (defensa extra sobre el
   * cliente — nunca se confía del wire), el invitador se resuelve contra la
   * lista viva de disponibles y queda como pendiente + aviso a los handlers.
   */
  private handleInvite(fromPeerId: string, rawKeyword: string): void {
    const keyword = sanitizeRoomWord(rawKeyword);
    if (!isValidRoomWord(keyword)) {
      return;
    }
    const known = this.client.getAvailablePeers().find((peer) => peer.peerId === fromPeerId);
    const from: AvailablePeer =
      known ?? { peerId: fromPeerId, name: UNKNOWN_INVITER_NAME, color: UNKNOWN_INVITER_COLOR };
    this.latestInvite = { from, keyword };
    for (const handler of this.inviteHandlers) {
      handler(this.latestInvite);
    }
  }

  /** Suelta el cableado (solo para apagados EXPLÍCITOS de tests/logout). */
  destroy(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
    this.inviteHandlers.clear();
    this.latestInvite = null;
  }
}

/** Shape check mínimo del valor del registry (defensivo contra basura). */
function looksLikeSocialSession(value: unknown): value is SocialChatSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.client === 'object' &&
    candidate.client !== null &&
    typeof candidate.store === 'object' &&
    candidate.store !== null &&
    typeof candidate.getLatestInvite === 'function' &&
    typeof candidate.onInviteReceived === 'function'
  );
}

/**
 * Devuelve la sesión social de chat (la crea la primera vez y la cachea en
 * el registry). Respeta una inyectada antes con `setSocialChatSession`
 * (tests) — inversión de dependencias igual que `getChatClient`. Responderla
 * NO conecta nada por default (privacidad): solo el ajuste persistido SÍ
 * aplicado en el CONSTRUCTOR enciende la sala pública (ver header).
 */
export function getSocialChatSession(registry: RegistrySlice): SocialChatSession {
  const existing = registry.get(SOCIAL_CHAT_REGISTRY_KEY);
  if (looksLikeSocialSession(existing)) {
    return existing;
  }
  const created = new SocialChatSession(registry);
  registry.set(SOCIAL_CHAT_REGISTRY_KEY, created);
  return created;
}

/** Publica/reemplaza la sesión social (inyección para tests). */
export function setSocialChatSession(registry: RegistrySlice, session: SocialChatSession): void {
  registry.set(SOCIAL_CHAT_REGISTRY_KEY, session);
}

/**
 * Destruye la sesión social (si hay): suelta el cableado y la retira del
 * registry. NO destruye el ChatClient ni borra el ChatStore (siguen siendo
 * servicios de sesión con sus propios dueños). Solo para tests.
 */
export function destroySocialChatSession(registry: RegistrySlice): void {
  const existing = registry.get(SOCIAL_CHAT_REGISTRY_KEY);
  registry.remove(SOCIAL_CHAT_REGISTRY_KEY);
  if (looksLikeSocialSession(existing)) {
    existing.destroy();
  }
}
