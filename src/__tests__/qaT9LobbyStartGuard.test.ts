import { describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, StartPayload } from '../net/protocol';
import type { NetClient } from '../net/NetClient';
import { LobbyScene } from '../scenes/LobbyScene';

/**
 * qaT9 (issue #35) — `tryStart` sin guard de re-entrada: el botón INICIAR es
 * un `MenuButton` que dispara en `pointerdown` (decisión documentada del
 * widget), y Phaser encola los eventos DOM: un doble tap rápido entra DOS
 * veces a `tryStart` antes de que la escena cambie → `client.start` difunde
 * DOS payloads con seeds DISTINTAS (`randomRoomSeed()` por llamada) y el
 * anfitrión lanza su carrera dos veces (dos `startRace`, dos
 * `partida_iniciada`).
 *
 * El guard es idempotente POR SESIÓN del lobby: `init` (re-entrada a la
 * escena) lo resetea, así que un nuevo lobby vuelve a poder iniciar.
 */

const ROSTER: PlayerInfo[] = [
  { peerId: 'host-1', name: 'Ana', color: 0 },
  { peerId: 'guest-1', name: 'Beto', color: 1 },
];

function createLobbyHarness(roster: PlayerInfo[] = ROSTER): {
  tryStart: () => void;
  clientStart: ReturnType<typeof vi.fn>;
  startRace: ReturnType<typeof vi.fn>;
  resetSession: () => void;
  setRoster: (next: PlayerInfo[]) => void;
} {
  const scene = new LobbyScene();

  const clientStart = vi.fn();
  const client = {
    selfPeerId: 'host-1',
    roomWord: 'SALA',
    isHost: () => true,
    getRoster: () => roster,
    start: clientStart,
  } as unknown as NetClient;

  const startRace = vi.fn();

  // El shell del lobby no corre en Phaser: se inyectan los puntos que
  // `tryStart` toca (misma técnica que lobbyTelemetry.test.ts).
  Object.assign(scene, {
    client,
    gameMode: 'battle',
    statusText: { setText: vi.fn().mockReturnThis(), setColor: vi.fn().mockReturnThis() },
  });
  (scene as unknown as { startRace: (payload: StartPayload) => void }).startRace = startRace;

  const internals = scene as unknown as { tryStart: () => void };

  return {
    tryStart: () => internals.tryStart(),
    clientStart,
    startRace,
    // Re-entrada a la escena: el guard debe volver a arrancar en false.
    resetSession: () => scene.init({ mode: 'create', name: 'Ana' }),
    setRoster: (next) => {
      (client as unknown as { getRoster: () => PlayerInfo[] }).getRoster = () => next;
    },
  };
}

describe('qaT9 — LobbyScene.tryStart: idempotente ante doble activación', () => {
  it('doble invocación difunde UN solo start y lanza UNA carrera', () => {
    const lobby = createLobbyHarness();

    lobby.tryStart();
    lobby.tryStart();

    expect(lobby.clientStart).toHaveBeenCalledTimes(1);
    expect(lobby.startRace).toHaveBeenCalledTimes(1);
    const [payload] = lobby.clientStart.mock.calls[0] as [StartPayload];
    expect(payload.players).toEqual(ROSTER);
  });

  it('el guard es por sesión: init de una sala nueva vuelve a habilitar el start', () => {
    const lobby = createLobbyHarness();

    lobby.tryStart();
    lobby.resetSession();
    lobby.tryStart();

    expect(lobby.clientStart).toHaveBeenCalledTimes(2);
    expect(lobby.startRace).toHaveBeenCalledTimes(2);
  });

  it('una activación fallida (sin roster suficiente) NO consume el guard', () => {
    const lobby = createLobbyHarness([ROSTER[0]]);

    // Sala de una sola persona: el tryStart legítimo cae en el status de
    // "SE NECESITAN 2+ JUGADORES" y NO marca el guard.
    lobby.tryStart();
    expect(lobby.clientStart).not.toHaveBeenCalled();

    // Ahora se suma el segundo jugador y el start sí sale.
    lobby.setRoster(ROSTER);
    lobby.tryStart();
    expect(lobby.clientStart).toHaveBeenCalledTimes(1);
    expect(lobby.startRace).toHaveBeenCalledTimes(1);
  });
});
