import { describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';
import { MenuButton } from '../ui/MenuButton';
import { MuteButton } from '../ui/MuteButton';
import { EventBus, type GameEvents } from '../core/EventBus';

/**
 * Tests de los botones interactivos de menús (MenuButton y MuteButton).
 *
 * Valida que la superficie tapeable (hit area) coincida exactamente con lo
 * que se ve visualmente y esté perfectamente centrada sobre el botón,
 * evitando el defasaje donde tapear en el centro o hacia abajo/derecha
 * quedaba fuera del hit area en móviles.
 */

function createMockScene() {
  const containerListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const mockContainer = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    depth: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    input: null as unknown,
    setDepth(d: number) {
      this.depth = d;
      return this;
    },
    setAlpha(a: number) {
      this.alpha = a;
      return this;
    },
    setSize(w: number, h: number) {
      this.width = w;
      this.height = h;
      return this;
    },
    setScale(s: number) {
      this.scaleX = s;
      this.scaleY = s;
      return this;
    },
    setInteractive(shape?: unknown, callback?: unknown) {
      this.input = {
        hitArea: shape,
        hitAreaCallback: callback,
        cursor: 'default',
      };
      return this;
    },
    add(_children: unknown) {
      return this;
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      containerListeners[event] = containerListeners[event] ?? [];
      containerListeners[event].push(handler);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      containerListeners[event]?.forEach((h) => h(...args));
      return this;
    },
    destroy: vi.fn(),
  };

  const mockScene = {
    add: {
      container: vi.fn((x: number, y: number) => {
        mockContainer.x = x;
        mockContainer.y = y;
        return mockContainer;
      }),
      rectangle: vi.fn(() => ({})),
      text: vi.fn(() => ({
        setOrigin: vi.fn().mockReturnThis(),
        setColor: vi.fn().mockReturnThis(),
        setText: vi.fn().mockReturnThis(),
      })),
      image: vi.fn(() => ({
        setTint: vi.fn().mockReturnThis(),
        setDisplaySize: vi.fn().mockReturnThis(),
        setTexture: vi.fn().mockReturnThis(),
      })),
    },
  } as unknown as Phaser.Scene;

  return { mockScene, mockContainer, containerListeners };
}

describe('MenuButton — superficie tapeable y centrado', () => {
  it('el hit area coincide exactamente con el tamaño visual (width + BORDER * 2) y se origina en (0, 0)', () => {
    const { mockScene, mockContainer } = createMockScene();
    const onPress = vi.fn();

    new MenuButton(mockScene, {
      x: 360,
      y: 840,
      width: 420,
      height: 96,
      label: 'JUGAR',
      tint: 0x1d8f43,
      onPress,
    });

    // BORDER_PX = 4 → tamaño visual total = 428 × 104
    const expectedWidth = 420 + 8;
    const expectedHeight = 96 + 8;

    expect(mockContainer.width).toBe(expectedWidth);
    expect(mockContainer.height).toBe(expectedHeight);

    const input = mockContainer.input as {
      hitArea: Phaser.Geom.Rectangle;
      hitAreaCallback: (rect: Phaser.Geom.Rectangle, x: number, y: number) => boolean;
    };
    expect(input).toBeDefined();

    // El Rectangle DEBE originarse en (0, 0), NO en (-width/2, -height/2)
    expect(input.hitArea.x).toBe(0);
    expect(input.hitArea.y).toBe(0);
    expect(input.hitArea.width).toBe(expectedWidth);
    expect(input.hitArea.height).toBe(expectedHeight);

    // En Phaser, pointWithinHitArea suma displayOrigin (width * 0.5, height * 0.5)
    // a las coordenadas locales (point.x, point.y).
    const displayOriginX = expectedWidth * 0.5;
    const displayOriginY = expectedHeight * 0.5;

    // 1. Toque en el CENTRO del botón (local 0, 0)
    const centerHitX = 0 + displayOriginX;
    const centerHitY = 0 + displayOriginY;
    expect(input.hitAreaCallback(input.hitArea, centerHitX, centerHitY)).toBe(true);

    // 2. Toque en el borde izquierdo visual (local -expectedWidth / 2)
    const leftHitX = -expectedWidth / 2 + displayOriginX;
    expect(input.hitAreaCallback(input.hitArea, leftHitX, centerHitY)).toBe(true);

    // 3. Toque en el borde derecho visual (local +expectedWidth / 2)
    const rightHitX = expectedWidth / 2 + displayOriginX;
    expect(input.hitAreaCallback(input.hitArea, rightHitX, centerHitY)).toBe(true);

    // 4. Toque en el borde superior visual (local -expectedHeight / 2)
    const topHitY = -expectedHeight / 2 + displayOriginY;
    expect(input.hitAreaCallback(input.hitArea, centerHitX, topHitY)).toBe(true);

    // 5. Toque en el borde inferior visual (local +expectedHeight / 2)
    const bottomHitY = expectedHeight / 2 + displayOriginY;
    expect(input.hitAreaCallback(input.hitArea, centerHitX, bottomHitY)).toBe(true);

    // 6. Toque FUERA del botón (a la derecha)
    const outsideRightX = expectedWidth / 2 + 1 + displayOriginX;
    expect(input.hitAreaCallback(input.hitArea, outsideRightX, centerHitY)).toBe(false);

    // 7. Toque FUERA del botón (abajo)
    const outsideBottomY = expectedHeight / 2 + 1 + displayOriginY;
    expect(input.hitAreaCallback(input.hitArea, centerHitX, outsideBottomY)).toBe(false);

    // 8. Toque FUERA del botón (a la izquierda)
    const outsideLeftX = -expectedWidth / 2 - 1 + displayOriginX;
    expect(input.hitAreaCallback(input.hitArea, outsideLeftX, centerHitY)).toBe(false);

    // 9. Toque FUERA del botón (arriba)
    const outsideTopY = -expectedHeight / 2 - 1 + displayOriginY;
    expect(input.hitAreaCallback(input.hitArea, centerHitX, outsideTopY)).toBe(false);
  });

  it('activa onPress en pointerdown y aplica feedback de escala', () => {
    const { mockScene, mockContainer } = createMockScene();
    const onPress = vi.fn();
    const bus = new EventBus<GameEvents>();
    const uiClickSpy = vi.fn();
    bus.on('ui-click', uiClickSpy);

    new MenuButton(mockScene, {
      x: 360,
      y: 840,
      width: 380,
      height: 104,
      label: 'REINTENTAR',
      tint: 0x1d8f43,
      bus,
      onPress,
    });

    // Simula pointerdown
    mockContainer.emit('pointerdown');

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(uiClickSpy).toHaveBeenCalledTimes(1);
    expect(mockContainer.scaleX).toBe(0.94);

    // Simula pointerup (liberación)
    mockContainer.emit('pointerup');
    expect(mockContainer.scaleX).toBe(1);
  });
});

describe('MuteButton — superficie tapeable y centrado', () => {
  it('el hit area coincide con el tamaño visual (size + BORDER * 2) y se origina en (0, 0)', () => {
    const { mockScene, mockContainer } = createMockScene();
    const bus = new EventBus<GameEvents>();

    new MuteButton(mockScene, {
      x: 600,
      y: 100,
      size: 56,
      bus,
      initiallyMuted: false,
    });

    const expectedSize = 56 + 8; // size + BORDER_PX * 2
    expect(mockContainer.width).toBe(expectedSize);
    expect(mockContainer.height).toBe(expectedSize);

    const input = mockContainer.input as {
      hitArea: Phaser.Geom.Rectangle;
      hitAreaCallback: (rect: Phaser.Geom.Rectangle, x: number, y: number) => boolean;
    };
    expect(input).toBeDefined();
    expect(input.hitArea.x).toBe(0);
    expect(input.hitArea.y).toBe(0);
    expect(input.hitArea.width).toBe(expectedSize);
    expect(input.hitArea.height).toBe(expectedSize);

    const displayOrigin = expectedSize * 0.5;

    // Centro
    expect(input.hitAreaCallback(input.hitArea, 0 + displayOrigin, 0 + displayOrigin)).toBe(true);
    // Extremos
    expect(input.hitAreaCallback(input.hitArea, -expectedSize / 2 + displayOrigin, 0 + displayOrigin)).toBe(true);
    expect(input.hitAreaCallback(input.hitArea, expectedSize / 2 + displayOrigin, 0 + displayOrigin)).toBe(true);
    // Fuera
    expect(input.hitAreaCallback(input.hitArea, expectedSize / 2 + 2 + displayOrigin, 0 + displayOrigin)).toBe(false);
  });
});
