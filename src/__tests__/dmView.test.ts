import { describe, expect, it } from 'vitest';
import {
  blockedSystemNote,
  chatMenuButtonLabel,
  dmBlockButtonLabel,
  dmBlockedSendState,
  dmHeaderLabel,
  DM_SEND_BLOCKED,
  DM_SEND_DISCONNECTED,
  DM_SEND_OPEN,
  inviteBannerText,
  invitedSystemNote,
  inviteJoinTarget,
  unblockedSystemNote,
} from '../chat/dmView';

/**
 * Tests de la lógica PURA de la vista de DM/invitaciones (C3): labels,
 * avisos de sistema, estado de envío bloqueado, badge del botón CHAT del
 * menú y el destino del UNIRSE de una invitación. Sin Phaser y sin red —
 * lo que ChatScene pinta sale TODO de acá.
 */

describe('dmView — header y labels del hilo de DM', () => {
  it('el header muestra el nombre del peer saneado tal como se pinta', () => {
    expect(dmHeaderLabel('Beto')).toBe('Beto');
    expect(dmHeaderLabel('  Ana   García ')).toBe('Ana García');
  });

  it('un nombre corrupto (vacío tras sanitizar) degrada a PILOTO', () => {
    expect(dmHeaderLabel('')).toBe('PILOTO');
    expect(dmHeaderLabel('   ')).toBe('PILOTO');
  });

  it('el label del botón de bloqueo sigue el estado del peer', () => {
    expect(dmBlockButtonLabel(false)).toBe('BLOQUEAR');
    expect(dmBlockButtonLabel(true)).toBe('DESBLOQUEAR');
  });
});

describe('dmView — estado de envío bloqueado (desconectado manda sobre bloqueado)', () => {
  it('hilo sano: se puede enviar, sin razón y con label normal', () => {
    expect(dmBlockedSendState(false, false)).toBe(DM_SEND_OPEN);
    expect(DM_SEND_OPEN.reason).toBeNull();
    expect(DM_SEND_OPEN.sendLabel).toBe('ENVIAR');
  });

  it('peer DESCONECTADO: aviso y label propios', () => {
    expect(dmBlockedSendState(true, false)).toBe(DM_SEND_DISCONNECTED);
    expect(DM_SEND_DISCONNECTED.reason).toBe('PEER DESCONECTADO — NO SE PUEDE ENVIAR');
    expect(DM_SEND_DISCONNECTED.sendLabel).toBe('DESCONECTADO');
  });

  it('peer BLOQUEADO: aviso de desbloqueo y label propio', () => {
    expect(dmBlockedSendState(false, true)).toBe(DM_SEND_BLOCKED);
    expect(DM_SEND_BLOCKED.reason).toBe('LO BLOQUEASTE — DESBLOQUEÁ PARA ESCRIBIRLE');
    expect(DM_SEND_BLOCKED.sendLabel).toBe('BLOQUEADO');
  });

  it('desconectado Y bloqueado: gana el DESCONECTADO (no hay canal igual)', () => {
    expect(dmBlockedSendState(true, true)).toBe(DM_SEND_DISCONNECTED);
  });
});

describe('dmView — avisos de sistema del hilo', () => {
  it('bloquear/desbloquear dejan su nota con el nombre del peer', () => {
    expect(blockedSystemNote('Beto')).toBe('BLOQUEASTE A Beto');
    expect(unblockedSystemNote('Beto')).toBe('DESBLOQUISTE A Beto');
    // Meta corrupta: el nombre degrada, el aviso sigue entendible.
    expect(blockedSystemNote('   ')).toBe('BLOQUEASTE A PILOTO');
    expect(unblockedSystemNote('   ')).toBe('DESBLOQUISTE A PILOTO');
  });

  it('invitar deja la nota con la palabra ya sanitizada', () => {
    expect(invitedSystemNote('Beto', ' parRilla ')).toBe('INVITASTE A Beto A «PARRILLA»');
    expect(invitedSystemNote('Ana', 'chicane9')).toBe('INVITASTE A Ana A «CHICANE»');
  });
});

describe('dmView — banner y hook de UNIRSE de una invitación', () => {
  it('el texto del banner nombra al invitador y la palabra', () => {
    expect(inviteBannerText('Beto', ' parRilla ')).toBe('Beto TE INVITÓ A «PARRILLA»');
    expect(inviteBannerText('', 'PARRILLA')).toBe('PILOTO TE INVITÓ A «PARRILLA»');
  });

  it('palabra válida → destino UNIRSE con la palabra precargada y el nombre saneado', () => {
    expect(inviteJoinTarget(' parRilla ', ' Beto ')).toEqual({
      mode: 'join',
      name: 'Beto',
      keyword: 'PARRILLA',
    });
    // Charset raro que NORMALIZA a palabra válida sigue siendo un destino.
    expect(inviteJoinTarget('PIRAÑA9!', 'Ana')).toEqual({
      mode: 'join',
      name: 'Ana',
      keyword: 'PIRANA',
    });
  });

  it('palabra inválida → NO hay destino (el botón UNIRSE no navega)', () => {
    expect(inviteJoinTarget('ABC', 'Beto')).toBeNull(); // muy corta
    expect(inviteJoinTarget('ABCDEFGHIJ', 'Beto')).toBeNull(); // muy larga
    expect(inviteJoinTarget('PIÑA', 'Beto')).toBeNull(); // queda PINA (4)
    expect(inviteJoinTarget('', 'Beto')).toBeNull();
    expect(inviteJoinTarget('12345', 'Beto')).toBeNull(); // sin letras no queda nada
  });

  it('nombre de perfil corrupto viaja vacío-castigado: el lobby pedirá nombre', () => {
    const target = inviteJoinTarget('PARRILLA', '   ');
    expect(target).not.toBeNull();
    expect(target?.name).toBe('');
  });
});

describe('dmView — badge del botón CHAT del menú', () => {
  it('sin no leídos el label queda pelado; con N>0 agrega el conteo', () => {
    expect(chatMenuButtonLabel(0)).toBe('CHAT');
    expect(chatMenuButtonLabel(1)).toBe('CHAT · 1');
    expect(chatMenuButtonLabel(7)).toBe('CHAT · 7');
    // Negativo no puede pasar (totalUnread >= 0), pero no rompe el label.
    expect(chatMenuButtonLabel(-1)).toBe('CHAT');
  });
});
