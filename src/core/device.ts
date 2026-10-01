/**
 * device — decisión de esquema de controles según el dispositivo (Fase 5/7).
 *
 * Función 100% pura y estructural (sin Phaser): la consumen las escenas para
 * decidir si muestran la ayuda de controles táctiles o la de teclado, y si
 * agregan el botón de fullscreen (solo desktop). Extraída de las escenas para
 * que la regla tenga UNA sola fuente de verdad y sea testeable directamente.
 *
 * Regla (documentada en MenuScene): hay controles táctiles si el dispositivo
 * reporta capacidad touch REAL fuera de un OS desktop. Los laptops con
 * pantalla táctil reportan ambas cosas y en desktop mandan las teclas.
 */

/** Forma mínima de la detección de dispositivo de Phaser (estructural). */
export interface DeviceCapabilities {
  readonly input: { readonly touch: boolean };
  readonly os: { readonly desktop: boolean };
}

/**
 * `true` si corresponde la UI de controles táctiles: capacidad touch y NO
 * desktop (un móvil o tablet; un laptop táctil queda en teclado).
 */
export function prefersTouchControls(device: DeviceCapabilities): boolean {
  return device.input.touch && !device.os.desktop;
}

/* ------------------------------------------------------------------ */
/* Detección de móvil sin Phaser (issue #4, H4)                        */
/* ------------------------------------------------------------------ */

/** Forma mínima de `navigator` para la detección estructural (sin DOM). */
export interface NavigatorCapabilities {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

/** User agents de OS móviles (navegadores principales, en orden de frecuencia). */
const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i;

/**
 * `true` si el `navigator` sugiere un móvil/tablet. A diferencia de
 * `prefersTouchControls` (que necesita el `device` de Phaser, solo disponible
 * dentro de una escena), esta función es consumible por módulos sin Phaser
 * como el AudioManager: el perfil del dron del motor se elige una vez al
 * construirlo, antes de que exista escena alguna.
 *
 * Regla: UA de OS móvil, o iPadOS (desde iPadOS 13 Safari reporta UA de
 * "Macintosh" de escritorio, pero sigue declarando touch múltiple — es la
 * única señal confiable para distinguirlo de un Mac real). Sin navigator o
 * sin señal → desktop.
 */
export function isMobileLikeDevice(nav: NavigatorCapabilities | null): boolean {
  if (!nav) {
    return false;
  }
  const iPadOs = /Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1;
  return MOBILE_UA_PATTERN.test(nav.userAgent) || iPadOs;
}
