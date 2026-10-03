import { describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';
import { EventBus, type GameEvents } from '../core/EventBus';
import { RaceHud } from '../ui/RaceHud';
import { ScoreHud } from '../ui/ScoreHud';

/**
 * qaT9 (issue #35) — defensas de no finitos en los HUD, consistentes con el
 * RESTO del codebase (Speedometer y todo `format.ts` usan el patrón
 * `Number.isFinite` con valor neutro):
 *
 * - ScoreHud pintaba `x NaN` ante un `coins` no finito (`Math.max(0, NaN)`
 *   es NaN, no 0).
 * - RaceHud pintaba `PNaN/8` ante una posición/total no finitos
 *   (`Math.max(1, NaN)` es NaN, no 1).
 *
 * El fallback es el valor neutro que los propios widgets ya usan al crear
 * el texto: `0` para monedas, `1` para posición.
 */

interface FakeText {
  text: string;
  width: number;
  setOrigin: () => FakeText;
  setStroke: () => FakeText;
  setVisible: (v: boolean) => FakeText;
  setText: (next: string) => FakeText;
  setX: (x: number) => FakeText;
  setScale: (s: number) => FakeText;
}

/** Crea un texto fake encadenable; el contenido queda espejado en `text`. */
function makeFakeText(texts: FakeText[], initial: string): FakeText {
  const fake: FakeText = {
    text: initial,
    width: 40,
    setOrigin: () => fake,
    setStroke: () => fake,
    setVisible: () => fake,
    setText: (next) => {
      fake.text = next;
      return fake;
    },
    setX: () => fake,
    setScale: () => fake,
  };
  texts.push(fake);
  return fake;
}

function createHudHarness(): {
  scene: Phaser.Scene;
  texts: FakeText[];
} {
  const texts: FakeText[] = [];

  const container = {
    setDepth: () => container,
    add: () => container,
  };

  const scene = {
    add: {
      container: vi.fn(() => container),
      text: vi.fn((_x: number, _y: number, initial: string) => makeFakeText(texts, initial)),
      image: vi.fn(() => makeFakeText(texts, '')),
    },
  } as unknown as Phaser.Scene;

  return { scene, texts };
}

describe('qaT9 — ScoreHud: monedas no finitas no pintan NaN', () => {
  it('coins NaN pinta el valor neutro 0 ("x 0"), no "x NaN"', () => {
    const { scene, texts } = createHudHarness();
    const bus = new EventBus<GameEvents>();
    new ScoreHud(scene, bus, { scoreX: 10, scoreY: 10, coinsX: 100, coinsY: 10 });

    bus.emit('coins', Number.NaN);

    // Orden de creación: scoreText, coinsText, coinIcon.
    expect(texts[1].text).toBe('x 0');
  });

  it('coins Infinity pinta "x 0"', () => {
    const { scene, texts } = createHudHarness();
    const bus = new EventBus<GameEvents>();
    new ScoreHud(scene, bus, { scoreX: 10, scoreY: 10, coinsX: 100, coinsY: 10 });

    bus.emit('coins', Number.POSITIVE_INFINITY);

    expect(texts[1].text).toBe('x 0');
  });
});

describe('qaT9 — RaceHud: posición no finita no pinta PNaN', () => {
  it('posición NaN con total 8 pinta "P1/8", no "PNaN/8"', () => {
    const { scene, texts } = createHudHarness();
    const hud = new RaceHud(scene, {});

    hud.setPosition(Number.NaN, 8);

    // Orden de creación: lapBadge, lapTime, totalTime, position, gap, infoChip.
    expect(texts[3].text).toBe('P1/8');
  });

  it('total NaN cae al neutro 1 y conserva la posición válida ("P3/1")', () => {
    const { scene, texts } = createHudHarness();
    const hud = new RaceHud(scene, {});

    hud.setPosition(3, Number.NaN);

    expect(texts[3].text).toBe('P3/1');
  });
});
