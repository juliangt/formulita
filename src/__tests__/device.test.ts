import { describe, expect, it } from 'vitest';
import { prefersTouchControls, type DeviceCapabilities } from '../core/device';

/**
 * Tests de la decisión de controles por dispositivo (Fase 5/7): la regla era
 * una expresión duplicada en MenuScene, GameOverScene y PauseScene; extraída
 * a `core/device.ts` queda testeable y con una sola fuente de verdad.
 *
 * Regla: hay controles táctiles si hay capacidad touch REAL fuera de un OS
 * desktop (un laptop con pantalla táctil reporta ambas y en desktop mandan
 * las teclas).
 */

function device(touch: boolean, desktop: boolean): DeviceCapabilities {
  return { input: { touch }, os: { desktop } };
}

describe('prefersTouchControls — controles táctiles vs teclado', () => {
  it('móvil (touch sin desktop): controles táctiles', () => {
    expect(prefersTouchControls(device(true, false))).toBe(true);
  });

  it('desktop sin touch: teclado', () => {
    expect(prefersTouchControls(device(false, true))).toBe(false);
  });

  it('laptop con pantalla táctil (touch Y desktop): gana el teclado', () => {
    expect(prefersTouchControls(device(true, true))).toBe(false);
  });

  it('sin capacidad touch (aunque no sea desktop): teclado', () => {
    expect(prefersTouchControls(device(false, false))).toBe(false);
  });
});
