import { describe, expect, it } from 'vitest';
import { PauseSystem } from '../systems/PauseSystem';

/**
 * Tests del PauseSystem (Fase 7): máquina de estados running ↔ paused con
 * memoria de pausa automática (pérdida de foco). La congelación real la hace
 * `scene.pause()` en GameScene; este sistema es la fuente de verdad testeable
 * de las transiciones y su idempotencia (pausar/reanudar dos veces no
 * re-dispara efectos).
 */

describe('PauseSystem — estado inicial', () => {
  it('arranca corriendo, sin pausa automática', () => {
    const pause = new PauseSystem();

    expect(pause.state).toBe('running');
    expect(pause.isPaused).toBe(false);
    expect(pause.isAutoPaused).toBe(false);
  });
});

describe('PauseSystem — transiciones', () => {
  it('pause() transiciona a paused y devuelve true solo la primera vez', () => {
    const pause = new PauseSystem();

    expect(pause.pause(false)).toBe(true);
    expect(pause.isPaused).toBe(true);
    expect(pause.state).toBe('paused');

    expect(pause.pause(false)).toBe(false); // idempotente
    expect(pause.isPaused).toBe(true);
  });

  it('resume() transiciona a running y devuelve true solo la primera vez', () => {
    const pause = new PauseSystem();
    pause.pause(false);

    expect(pause.resume()).toBe(true);
    expect(pause.isPaused).toBe(false);

    expect(pause.resume()).toBe(false); // idempotente
    expect(pause.isPaused).toBe(false);
  });

  it('un nuevo ciclo pausa → reanuda → pausa funciona', () => {
    const pause = new PauseSystem();

    pause.pause(false);
    pause.resume();
    expect(pause.pause(false)).toBe(true);
    expect(pause.isPaused).toBe(true);
  });
});

describe('PauseSystem — pausa automática (pérdida de foco)', () => {
  it('pause(true) marca la pausa como automática', () => {
    const pause = new PauseSystem();

    pause.pause(true);

    expect(pause.isPaused).toBe(true);
    expect(pause.isAutoPaused).toBe(true);
  });

  it('pause(false) NO marca pausa automática (botón / tecla P)', () => {
    const pause = new PauseSystem();
    pause.pause(false);

    expect(pause.isAutoPaused).toBe(false);
  });

  it('re-pausar con otro motivo no sobreescribe el flag vigente (sigue idempotente)', () => {
    const pause = new PauseSystem();
    pause.pause(true); // automática por blur
    pause.pause(false); // el jugador aprieta P con la pestaña aún sin foco

    expect(pause.isPaused).toBe(true);
    expect(pause.isAutoPaused).toBe(true);
  });

  it('resume limpia el flag de pausa automática', () => {
    const pause = new PauseSystem();
    pause.pause(true);
    pause.resume();

    expect(pause.isAutoPaused).toBe(false);
    expect(pause.isPaused).toBe(false);
  });
});

describe('PauseSystem — reset', () => {
  it('reset vuelve a running sin pausa automática (restart de escena)', () => {
    const pause = new PauseSystem();
    pause.pause(true);

    pause.reset();

    expect(pause.state).toBe('running');
    expect(pause.isPaused).toBe(false);
    expect(pause.isAutoPaused).toBe(false);
  });

  it('reset en running es un no-op seguro', () => {
    const pause = new PauseSystem();

    expect(() => pause.reset()).not.toThrow();
    expect(pause.isPaused).toBe(false);
  });
});
