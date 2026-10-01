import { describe, expect, it } from 'vitest';
import {
  isMobileLikeDevice,
  prefersTouchControls,
  type DeviceCapabilities,
  type NavigatorCapabilities,
} from '../core/device';

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

/**
 * Tests de la detección de móvil SIN Phaser (issue #4, H4): el AudioManager
 * elige el perfil del dron del motor al construirse, antes de que exista
 * escena alguna, así que no puede usar `prefersTouchControls(this.game.device)`.
 * La regla es pura sobre la porción de `navigator` que necesita.
 */
describe('isMobileLikeDevice — detección de móvil por navigator', () => {
  function nav(userAgent: string, maxTouchPoints = 0): NavigatorCapabilities {
    return { userAgent, maxTouchPoints };
  }

  it('Android: móvil', () => {
    expect(isMobileLikeDevice(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8)'))).toBe(true);
  });

  it('iPhone: móvil', () => {
    expect(
      isMobileLikeDevice(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)')),
    ).toBe(true);
  });

  it('iPad clásico (UA propio): móvil', () => {
    expect(isMobileLikeDevice(nav('Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X)'))).toBe(true);
  });

  it('iPadOS 13+ (UA de Macintosh + touch múltiple): móvil', () => {
    expect(
      isMobileLikeDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)),
    ).toBe(true);
  });

  it('Mac real (UA de Macintosh, sin touch): desktop', () => {
    expect(
      isMobileLikeDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')),
    ).toBe(false);
  });

  it('Windows y Linux de escritorio: desktop', () => {
    expect(
      isMobileLikeDevice(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')),
    ).toBe(false);
    expect(isMobileLikeDevice(nav('Mozilla/5.0 (X11; Linux x86_64)'))).toBe(false);
  });

  it('defensivo: null o UA desconocido → desktop (default estable)', () => {
    expect(isMobileLikeDevice(null)).toBe(false);
    expect(isMobileLikeDevice(nav('Node.js/22'))).toBe(false);
  });
});
