/**
 * dmView.ts — lógica PURA de la vista de DM/invitaciones de C3.
 *
 * Hermano de `presenceView.ts` (C2) para todo lo decidible del hilo de DM y
 * del banner de invitaciones: labels de botones, textos de los avisos de
 * sistema del hilo, el estado de envío bloqueado (desconectado/bloqueado),
 * el destino del botón UNIRSE de una invitación y el badge de no leídos de
 * los botones de menú (issue #22: hoy sobre EN LÍNEA, el subbotón CHAT de la
 * subpantalla conserva el helper). Todo son funciones puras (sin Phaser, sin
 * red) para testearlas directo; el wiring de botones/textos queda en ChatScene.
 */

import { isValidRoomWord, sanitizePlayerName, sanitizeRoomWord } from '../net/protocol';

/* ------------------------------------------------------------------ */
/* Hilo de DM: header, bloqueo y envío bloqueado                       */
/* ------------------------------------------------------------------ */

/** Nombre fallback si el peer no tiene nombre usable (meta corrupta). */
const FALLBACK_NAME = 'PILOTO';

/** Nombre visible del peer (degrada a PILOTO si la meta llegó vacía). */
function displayName(name: string): string {
  const clean = sanitizePlayerName(name);
  return clean.length > 0 ? clean : FALLBACK_NAME;
}

/** Header del hilo de DM: el nombre del peer, tal como se pinta arriba. */
export function dmHeaderLabel(peerName: string): string {
  return displayName(peerName);
}

/** Label del botón de bloqueo según el estado actual del peer. */
export function dmBlockButtonLabel(blocked: boolean): string {
  return blocked ? 'DESBLOQUEAR' : 'BLOQUEAR';
}

/** Estado de envío del hilo de DM cuando NO se puede escribir. */
export interface DmBlockedSendState {
  /** Aviso para el usuario (placeholder del input); null = se puede enviar. */
  readonly reason: string | null;
  /** Label del botón ENVIAR mientras está bloqueado. */
  readonly sendLabel: string;
}

/** Estado de envío HABILITADO (el input y el ENVIAR funcionan normal). */
export const DM_SEND_OPEN: DmBlockedSendState = { reason: null, sendLabel: 'ENVIAR' };

/** El hilo está DESCONECTADO: el peer dejó la sala pública. */
export const DM_SEND_DISCONNECTED: DmBlockedSendState = {
  reason: 'PEER DESCONECTADO — NO SE PUEDE ENVIAR',
  sendLabel: 'DESCONECTADO',
};

/** El peer está bloqueado por mí: la conversación se cortó en ambos sentidos. */
export const DM_SEND_BLOCKED: DmBlockedSendState = {
  reason: 'LO BLOQUEASTE — DESBLOQUEÁ PARA ESCRIBIRLE',
  sendLabel: 'BLOQUEADO',
};

/**
 * Decide si el input del hilo de DM acepta envíos: el DESCONECTADO manda
 * sobre el bloqueado (si el peer se fue, no hay canal aunque lo desbloquee).
 * Ambos estados cortan el envío (además de la UI, lo cortan el adaptador y
 * el store — defensa en profundidad).
 */
export function dmBlockedSendState(disconnected: boolean, blocked: boolean): DmBlockedSendState {
  if (disconnected) {
    return DM_SEND_DISCONNECTED;
  }
  if (blocked) {
    return DM_SEND_BLOCKED;
  }
  return DM_SEND_OPEN;
}

/* ------------------------------------------------------------------ */
/* Avisos de sistema del hilo (los pinta el ChatPanel como línea gris)  */
/* ------------------------------------------------------------------ */

/** Nota de sistema al bloquear: "BLOQUEASTE A NOMBRE". */
export function blockedSystemNote(peerName: string): string {
  return `BLOQUEASTE A ${displayName(peerName)}`;
}

/** Nota de sistema al desbloquear: "DESBLOQUISTE A NOMBRE". */
export function unblockedSystemNote(peerName: string): string {
  return `DESBLOQUISTE A ${displayName(peerName)}`;
}

/** Nota de sistema al invitar: "INVITASTE A NOMBRE A «PALABRA»". */
export function invitedSystemNote(peerName: string, keyword: string): string {
  return `INVITASTE A ${displayName(peerName)} A «${sanitizeRoomWord(keyword)}»`;
}

/* ------------------------------------------------------------------ */
/* Invitaciones: banner y destino del UNIRSE                           */
/* ------------------------------------------------------------------ */

/** Texto del banner de invitación: "NOMBRE TE INVITÓ A «PALABRA»". */
export function inviteBannerText(peerName: string, keyword: string): string {
  return `${displayName(peerName)} TE INVITÓ A «${sanitizeRoomWord(keyword)}»`;
}

/**
 * Init data que resuelve el botón UNIRSE de una invitación: arranca el flujo
 * UNIRSE de #1 con la palabra PRECARGADA (el jugador confirma con ENTRAR).
 * Es lo único que la escena necesita para navegar — `null` si la keyword no
 * es una palabra de sala válida (la invitación se ignora).
 */
export interface InviteJoinTarget {
  readonly mode: 'join';
  readonly name: string;
  readonly keyword: string;
}

/**
 * Decide el destino del UNIRSE de una invitación (puro, testeado en vez de
 * la escena): keyword inválida → null (no se navega a ningún lado); válida →
 * LobbyScene en modo join con la palabra precargada y el nombre del perfil.
 */
export function inviteJoinTarget(keyword: string, profileName: string): InviteJoinTarget | null {
  const word = sanitizeRoomWord(keyword);
  if (!isValidRoomWord(word)) {
    return null;
  }
  const name = sanitizePlayerName(profileName);
  return { mode: 'join', name, keyword: word };
}

/* ------------------------------------------------------------------ */
/* Badge de no leídos                                                   */
/* ------------------------------------------------------------------ */

/**
 * Label de un botón de menú con badge de no leídos (`ChatStore.totalUnread`:
 * sala + DMs). 0 mantiene el label pelado; N>0 agrega el conteo visible para
 * que el badge se note sin entrar.
 */
export function badgeButtonLabel(base: string, totalUnread: number): string {
  if (totalUnread <= 0) {
    return base;
  }
  return `${base} · ${totalUnread}`;
}

/**
 * Label del botón CHAT del menú (hoy es el subbotón CHAT de la subpantalla
 * EN LÍNEA del issue #22).
 */
export function chatMenuButtonLabel(totalUnread: number): string {
  return badgeButtonLabel('CHAT', totalUnread);
}

/**
 * Label del botón EN LÍNEA del menú (issue #22): hereda el badge de no
 * leídos que antes mostraba el botón CHAT — es la única superficie SIEMPRE
 * visible (el subbotón CHAT de la subpantalla sólo existe con ella abierta),
 * así que el aviso de mensajes pendientes vive ahí.
 */
export function onlineMenuButtonLabel(totalUnread: number): string {
  return badgeButtonLabel('EN LÍNEA', totalUnread);
}
