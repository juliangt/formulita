import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, StartPayload } from '../net/protocol';
import { GameScene } from '../scenes/GameScene';
import { LobbyScene } from '../scenes/LobbyScene';
import { RaceScene } from '../scenes/RaceScene';

/**
 * Telemetría #27 — `partida_iniciada` en `LobbyScene.startRace` (el arranque
 * MULTIJUGADOR). El lobby es un shell fino: `startRace` es lo único que
 * decide escena, así que es el ÚNICO punto donde el evento tiene sentido.
 * Cada cliente corre su carrera localmente y emite SU evento (el anfitrión
 * desde tryStart, cada invitado desde onStart) — una emisión por cliente.
 *
 * Contrato de properties, SIN PII:
 * - CARRERA (RaceScene): { modo: 'multijugador', pista: <TrackId> }.
 * - BATALLA (GameScene, o start viejo sin `gameMode` degradado):
 *   { modo: 'multijugador' } — la property `pista` se OMITE (sin circuito
 *   no hay pista; no se manda null/undefined explícito).
 * NUNCA viajan nombres de jugador, peerIds ni presencia, aunque el payload
 * `StartPayload` los tenga a mano: los tests lo verifican por igualdad
 * EXACTA del objeto de properties.
 *
 * Harness: escena REAL + `scene.start` espía (misma técnica que el harness
 * de MenuScene en onlineSection.test.ts). No hay cliente (this.client null
 * ⇒ sin handoff) porque el arranque no lo necesita: igual que en la escena
 * real, el evento se emite antes del `scene.start`.
 */

/** Roster válido para `parseRaceInit` (nombres ficticios, jamás telemetría). */
const ROSTER: PlayerInfo[] = [
  { peerId: 'host-1', name: 'Ana', color: 0 },
  { peerId: 'guest-1', name: 'Beto', color: 1 },
];

function createLobbyHarness(): {
  run(payload: StartPayload): void;
  sceneStart: ReturnType<typeof vi.fn>;
} {
  const sceneStart = vi.fn();
  const scene = new LobbyScene();
  Object.assign(scene, {
    scene: { start: sceneStart },
  });
  const internals = scene as unknown as {
    startRace(payload: StartPayload): void;
  };
  return { run: (payload) => internals.startRace(payload), sceneStart };
}

function installCapture(): ReturnType<typeof vi.fn> {
  const capture = vi.fn();
  window.posthog = { capture };
  return capture;
}

describe('LobbyScene — telemetría partida_iniciada (issue #27)', () => {
  afterEach(() => {
    delete window.posthog;
  });

  it('CARRERA: startRace reporta { modo: "multijugador", pista } y lanza RaceScene', () => {
    const capture = installCapture();
    const lobby = createLobbyHarness();

    lobby.run({
      seed: 987654321,
      players: ROSTER,
      startAt: 1700000000000,
      gameMode: 'race',
      trackId: 'monza',
    });

    expect(capture).toHaveBeenCalledTimes(1);
    // Igualdad EXACTA: nada del payload (nombres, peerIds, seed, roster)
    // se cuela en las properties.
    expect(capture).toHaveBeenCalledWith('partida_iniciada', {
      modo: 'multijugador',
      pista: 'monza',
    });
    expect(lobby.sceneStart).toHaveBeenCalledWith(
      RaceScene.KEY,
      expect.objectContaining({ mode: 'race', trackId: 'monza' }),
    );
  });

  it('BATALLA: reporta { modo: "multijugador" } SIN la property pista y lanza GameScene', () => {
    const capture = installCapture();
    const lobby = createLobbyHarness();

    lobby.run({
      seed: 42,
      players: ROSTER,
      startAt: 1700000000000,
      gameMode: 'battle',
    });

    expect(capture).toHaveBeenCalledTimes(1);
    const [, properties] = capture.mock.calls[0] as [string, Record<string, unknown>];
    // Igualdad exacta Y la key ausente: ni null ni undefined explícito.
    expect(properties).toEqual({ modo: 'multijugador' });
    expect('pista' in properties).toBe(false);
    expect(lobby.sceneStart).toHaveBeenCalledWith(
      GameScene.KEY,
      expect.objectContaining({ mode: 'multi' }),
    );
  });

  it('start viejo sin gameMode degrada a BATALLA y también omite pista', () => {
    const capture = installCapture();
    const lobby = createLobbyHarness();

    lobby.run({ seed: 7, players: ROSTER, startAt: 1700000000000 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('partida_iniciada', { modo: 'multijugador' });
    expect(lobby.sceneStart).toHaveBeenCalledWith(GameScene.KEY, expect.anything());
  });

  it('sin SDK cargado (window.posthog ausente) el arranque corre igual', () => {
    delete window.posthog;
    const lobby = createLobbyHarness();

    expect(() =>
      lobby.run({
        seed: 1,
        players: ROSTER,
        startAt: 1700000000000,
        gameMode: 'race',
        trackId: 'spa',
      }),
    ).not.toThrow();
    // El juego sigue su curso: RaceScene lanzada igual.
    expect(lobby.sceneStart).toHaveBeenCalledWith(RaceScene.KEY, expect.anything());
  });
});
