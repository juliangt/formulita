import { describe, expect, it } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import {
  assignColors,
  canStart,
  colorForPeer,
  isRoomFull,
  resolveHostPeerId,
} from '../net/lobbyState';
import type { RosterEntry } from '../net/protocol';

/**
 * Tests de las reglas PURAS del lobby (M1): anfitrión (creador presente /
 * peerId menor al migrar), colores deterministas por roster, capacidad y
 * mínimo para iniciar. Estas funciones corren IGUAL en todos los clientes —
 * los tests fijan su semántica exacta.
 */

function entry(peerId: string, isCreator = false): RosterEntry {
  return { peerId, name: peerId.toUpperCase(), isCreator };
}

describe('lobbyState — resolveHostPeerId (anfitrión)', () => {
  it('roster vacío → null', () => {
    expect(resolveHostPeerId([])).toBeNull();
  });

  it('el creador presente es el anfitrión, sin importar el peerId', () => {
    const roster = [entry('zz9'), entry('a01'), entry('m50', true), entry('b02')];
    expect(resolveHostPeerId(roster)).toBe('m50');
  });

  it('sin creador (se fue) → el peerId MENOR entre los presentes', () => {
    const roster = [entry('zeta'), entry('bravo'), entry('alfa'), entry('charlie')];
    expect(resolveHostPeerId(roster)).toBe('alfa');
  });

  it('la migración es la misma regla en cualquier orden de entrada', () => {
    // Mismo conjunto, distinto orden → mismo anfitrión (es función del SET).
    expect(resolveHostPeerId([entry('b'), entry('a'), entry('c')])).toBe(
      resolveHostPeerId([entry('c'), entry('b'), entry('a')]),
    );
  });

  it('con un solo sobreviviente, él es el anfitrión', () => {
    expect(resolveHostPeerId([entry('solo')])).toBe('solo');
  });
});

describe('lobbyState — colores por roster', () => {
  it('assignColors ordena por peerId y asigna la paleta en orden', () => {
    const roster = [entry('c3'), entry('a1', true), entry('b2')];
    const colored = assignColors(roster);

    expect(colored.map((p) => p.peerId)).toEqual(['a1', 'b2', 'c3']);
    expect(colored[0].color).toBe(MULTIPLAYER.palette[0]);
    expect(colored[1].color).toBe(MULTIPLAYER.palette[1]);
    expect(colored[2].color).toBe(MULTIPLAYER.palette[2]);
  });

  it('los colores son únicos mientras el roster no supere 10', () => {
    const roster = Array.from({ length: MULTIPLAYER.maxPlayers }, (_, i) =>
      entry(`peer-${String(i).padStart(2, '0')}`),
    );
    const colors = assignColors(roster).map((p) => p.color);
    expect(new Set(colors).size).toBe(MULTIPLAYER.maxPlayers);
    // Y todos vienen de la paleta.
    for (const color of colors) {
      expect(MULTIPLAYER.palette).toContain(color);
    }
  });

  it('es determinista e idéntica para el mismo roster en cualquier orden', () => {
    const roster = [entry('x9'), entry('x1', true), entry('x5'), entry('x3')];
    const direct = assignColors(roster);
    const shuffled = assignColors([...roster].reverse());
    expect(direct).toEqual(shuffled);
  });

  it('dos clientes con el mismo roster computan exactamente lo mismo', () => {
    const roster = [entry('p-b'), entry('p-a'), entry('p-c')];
    const clientA = assignColors(roster);
    const clientB = assignColors([...roster]);
    expect(clientA).toEqual(clientB);
    expect(clientA.map((p) => p.name)).toEqual(['P-A', 'P-B', 'P-C']);
  });

  it('colorForPeer: dentro del roster → color; fuera → null', () => {
    const roster = [entry('bb'), entry('aa')];
    expect(colorForPeer('aa', roster)).toBe(MULTIPLAYER.palette[0]);
    expect(colorForPeer('bb', roster)).toBe(MULTIPLAYER.palette[1]);
    expect(colorForPeer('zz', roster)).toBeNull();
  });

  it('cuando un peer se va, los posteriores se recorren un lugar', () => {
    // Documentado: el color es función del ROSTER (no del jugador), así que
    // es idéntico en todos los clientes aunque se re-asigne al irse alguien.
    const complete = assignColors([entry('a'), entry('b'), entry('c')]);
    const withoutB = assignColors([entry('a'), entry('c')]);
    expect(complete.find((p) => p.peerId === 'c')?.color).toBe(MULTIPLAYER.palette[2]);
    expect(withoutB.find((p) => p.peerId === 'c')?.color).toBe(MULTIPLAYER.palette[1]);
  });
});

describe('lobbyState — capacidad y arranque', () => {
  it('la sala admite hasta 10 jugadores: el 11º es rechazado', () => {
    expect(isRoomFull(1)).toBe(false);
    expect(isRoomFull(10)).toBe(false);
    expect(isRoomFull(11)).toBe(true);
    expect(isRoomFull(50)).toBe(true);
  });

  it('canStart: solo el anfitrión resuelto, y con 2+ jugadores', () => {
    const two = [entry('a', true), entry('b')];
    expect(canStart(two, 'a')).toBe(true); // 'a' es el creador → anfitrión
    expect(canStart(two, 'b')).toBe(false); // 'b' no es el anfitrión
    // Con un jugador solo tampoco (mínimo 2, aunque sea el anfitrión).
    expect(canStart([entry('a', true)], 'a')).toBe(false);
    // Sin creador en el roster, el anfitrión es el peerId menor.
    const migrated = [entry('c'), entry('b')];
    expect(canStart(migrated, 'b')).toBe(true);
    expect(canStart(migrated, 'c')).toBe(false);
  });
});
