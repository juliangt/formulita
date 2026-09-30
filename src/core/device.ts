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
