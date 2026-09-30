import { describe, expect, it } from 'vitest';
import { OIL_SLIP_SECONDS } from '../config/balance';
import { slipSteer } from '../entities/PlayerCar';
import {
  EMPTY_INPUT_STATE,
  InputSystem,
  steerDirection,
  type IInputSource,
  type IInputState,
} from '../systems/InputSystem';

/**
 * Integración Fase 2 → 4 — del input al steering del auto, SIN Phaser real.
 *
 * Es la composición que GameScene arma y PlayerCar consume por frame
 * (`PlayerCar.preUpdate`): fuentes fusionadas por `InputSystem` → `steerDirection`
 * → (si pisa aceite) `slipSteer`. El sprite, el body arcade y el clamp a pista
 * son render/física de Phaser y se verifican manualmente (QA del README); la
 * CADENA DE DECISIONES que gobierna el volante es pura y se ejercita acá
 * completa, con dos fuentes simultáneas (teclado + táctil) como en el juego.
 */

const DT = 1 / 60;

/** Fuente fake con estado programable: hace de KeyboardSource/TouchSource. */
class FakeSource implements IInputSource {
  readonly name: string;
  private readonly state: IInputState = { ...EMPTY_INPUT_STATE };
  private stateReads = 0;

  constructor(name: string) {
    this.name = name;
  }

  attach(): void {}

  detach(): void {
    Object.assign(this.state, EMPTY_INPUT_STATE);
  }

  /** Programa flags (como un listener de teclas o de botones táctiles). */
  press(partial: Partial<IInputState>): void {
    Object.assign(this.state, partial);
  }

  getState(): IInputState {
    this.stateReads += 1;
    return { ...this.state };
  }

  get reads(): number {
    return this.stateReads;
  }
}

/** Libro de derrape: réplica del estado que PlayerCar maneja en preUpdate. */
interface SlipState {
  slipSeconds: number;
  slipElapsed: number;
}

/**
 * Un frame del auto: ÚNICA lectura del estado fusionado, dirección pedida y
 * overrides del derrape. Espejo literal de `PlayerCar.preUpdate` (misma
 * contabilidad de slipSeconds/slipElapsed y la misma regla de refresh del
 * `slip()` de PlayerCar: pisar aceite de nuevo refresca con `Math.max`).
 */
function driveCarFrame(input: IInputSource, slip: SlipState): number {
  const state = input.getState();

  let steer = steerDirection(state);
  if (slip.slipSeconds > 0) {
    slip.slipSeconds = Math.max(0, slip.slipSeconds - DT);
    slip.slipElapsed += DT;
    steer = slipSteer(steer, slip.slipElapsed);
  } else {
    slip.slipElapsed = 0;
  }
  return steer;
}

/** Pisa aceite (lo que GameScene hace en el overlap: `playerCar.slip(...)`). */
function slipOnOil(slip: SlipState, duration: number = OIL_SLIP_SECONDS): void {
  slip.slipSeconds = Math.max(slip.slipSeconds, duration);
}

describe('integración input → steering — fusión consumida por el auto', () => {
  it('solo teclado: la dirección pedida llega al volante', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);

    keyboard.press({ left: true });
    expect(steerDirection(input.getState())).toBe(-1);

    keyboard.press({ left: false, right: true });
    expect(steerDirection(input.getState())).toBe(1);
  });

  it('solo táctil: el botón en pantalla dobla el auto', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);

    touch.press({ left: true });
    expect(steerDirection(input.getState())).toBe(-1);
  });

  it('teclado Y táctil a la vez: la fusión por flags decide el volante', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);

    // Ambos piden lo mismo: el OR lo mantiene.
    keyboard.press({ right: true });
    touch.press({ right: true });
    expect(steerDirection(input.getState())).toBe(1);

    // Lados opuestos simultáneos (pulgares y teclado desacordados): se cancelan.
    touch.press({ right: false, left: true });
    expect(steerDirection(input.getState())).toBe(0);
  });

  it('el mismo estado fusionado viaja con throttle/turbo/drs listos para Fase 3', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);

    keyboard.press({ throttle: true, right: true });
    touch.press({ turbo: true, drs: true });

    const merged = input.getState();
    expect(merged.throttle).toBe(true);
    expect(merged.turbo).toBe(true);
    expect(merged.drs).toBe(true);
    expect(steerDirection(merged)).toBe(1);
  });

  it('el auto lee el estado UNA vez por frame (un solo consumo por fuente)', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);
    const slip: SlipState = { slipSeconds: 0, slipElapsed: 0 };

    const readsBefore = keyboard.reads + touch.reads;
    driveCarFrame(input, slip);
    driveCarFrame(input, slip);
    driveCarFrame(input, slip);

    expect(keyboard.reads + touch.reads - readsBefore).toBe(6); // 2 fuentes × 3 frames
  });

  it('detach de la fuente no deja botones "pegados": el volante vuelve a neutro', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);

    touch.press({ right: true });
    touch.detach(); // lo que hace GameScene al pausar (y re-arma en el RESUME)

    expect(steerDirection(input.getState())).toBe(0);
  });
});

describe('integración input → steering — derrape de aceite (Fase 4)', () => {
  it('doblando durante el derrape, el volante responde INVERTIDO', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);
    const slip: SlipState = { slipSeconds: 0, slipElapsed: 0 };

    slipOnOil(slip);
    keyboard.press({ right: true });

    const steer = driveCarFrame(input, slip);
    expect(steer).toBe(-1); // pidió derecha, el auto va a izquierda
  });

  it('sin doblar, el auto zigzaguea solo frame a frame', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);
    const slip: SlipState = { slipSeconds: 0, slipElapsed: 0 };

    slipOnOil(slip);
    const steers: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      steers.push(driveCarFrame(input, slip));
    }

    // Oscila entre los dos lados y nunca se queda quieto en uno solo.
    expect(new Set(steers)).toEqual(new Set([-1, 1]));
  });

  it('el derrape expira solo: a OIL_SLIP_SECONDS el auto vuelve a obedecer', () => {
    const keyboard = new FakeSource('keyboard');
    const touch = new FakeSource('touch');
    const input = new InputSystem([keyboard, touch]);
    const slip: SlipState = { slipSeconds: 0, slipElapsed: 0 };

    slipOnOil(slip);
    keyboard.press({ left: true });

    // Mientras quede derrape vigente, la izquierda pedida sale como derecha.
    let frames = 0;
    while (slip.slipSeconds > 0 && frames < 200) {
      expect(driveCarFrame(input, slip)).toBe(1); // invertido
      frames += 1;
    }
    expect(frames).toBeGreaterThanOrEqual(Math.floor(OIL_SLIP_SECONDS / DT) - 1);
    expect(frames).toBeLessThanOrEqual(Math.ceil(OIL_SLIP_SECONDS / DT) + 1);

    // Control recuperado: la izquierda pedida vuelve a ser izquierda.
    expect(driveCarFrame(input, slip)).toBe(-1);
  });

  it('pisar aceite de nuevo REFRECHA el derrape (no se acumula ni acorta)', () => {
    const slip: SlipState = { slipSeconds: 0, slipElapsed: 0 };

    slipOnOil(slip);
    // Avanza casi todo el derrape...
    for (let i = 0; i < Math.floor(OIL_SLIP_SECONDS / DT) - 5; i += 1) {
      slip.slipSeconds = Math.max(0, slip.slipSeconds - DT);
      slip.slipElapsed += DT;
    }
    expect(slip.slipSeconds).toBeLessThan(OIL_SLIP_SECONDS);

    // ...y vuelve a pisar la mancha: la duración vigente sigue siendo la mayor.
    slipOnOil(slip);
    expect(slip.slipSeconds).toBe(OIL_SLIP_SECONDS);
  });
});
