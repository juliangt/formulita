import Phaser from 'phaser';

/**
 * BootScene — escena placeholder de la Fase 0.
 *
 * Muestra el título sobre fondo negro para verificar que el canvas se monta
 * y escala correctamente (criterio de aceptación de la Fase 0). En la Fase 1
 * acá arranca el flujo Boot → Preload → Game: esta escena pasará el control a
 * PreloadScene, que generará las texturas procedurales con barra de progreso.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;

    this.cameras.main.setBackgroundColor('#000000');

    this.add
      .text(centerX, height / 2 - 70, 'FORMULITA', {
        fontFamily: 'monospace',
        fontSize: '72px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Franja estilo kerb rojo/blanco a modo de decoración placeholder.
    this.add.rectangle(centerX - 90, height / 2, 60, 14, 0xd32f2f).setOrigin(0.5);
    this.add.rectangle(centerX + 0, height / 2, 60, 14, 0xf5f5f5).setOrigin(0.5);
    this.add.rectangle(centerX + 90, height / 2, 60, 14, 0xd32f2f).setOrigin(0.5);

    this.add
      .text(centerX, height / 2 + 70, 'Fase 0 · Scaffolding listo', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#9e9e9e',
      })
      .setOrigin(0.5);
  }
}
