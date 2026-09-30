import { describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvents } from '../core/EventBus';

/** Mapa de eventos mínimo para probar el bus sin acoplarse a GameEvents. */
interface TestEvents {
  numero: number;
  texto: string;
}

describe('EventBus', () => {
  it('on + emit entrega el payload al handler', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('numero', handler);
    bus.emit('numero', 42);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('varios handlers del mismo evento reciben la emisión', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();

    bus.on('texto', a);
    bus.on('texto', b);
    bus.emit('texto', 'hola');

    expect(a).toHaveBeenCalledWith('hola');
    expect(b).toHaveBeenCalledWith('hola');
  });

  it('off deja de recibir emisiones', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('numero', handler);
    bus.off('numero', handler);
    bus.emit('numero', 1);

    expect(handler).not.toHaveBeenCalled();
  });

  it('la función de desuscripción devuelta por on funciona', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const unsubscribe = bus.on('numero', handler);
    unsubscribe();
    bus.emit('numero', 1);

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('numero')).toBe(0);
  });

  it('once se ejecuta una sola vez', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.once('numero', handler);
    bus.emit('numero', 1);
    bus.emit('numero', 2);
    bus.emit('numero', 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
    expect(bus.listenerCount('numero')).toBe(0);
  });

  it('emit sin listeners no lanza error', () => {
    const bus = new EventBus<TestEvents>();

    expect(() => bus.emit('numero', 10)).not.toThrow();
  });

  it('un handler puede desuscribirse durante el emit sin romper a los demás', () => {
    const bus = new EventBus<TestEvents>();
    const b = vi.fn();

    // `a` se desuscribe a sí misma al recibir el primer evento.
    const a = vi.fn(() => bus.off('numero', a));
    bus.on('numero', a);
    bus.on('numero', b);

    bus.emit('numero', 1);
    bus.emit('numero', 2);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('clear elimina todos los handlers', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('numero', vi.fn());
    bus.on('texto', vi.fn());

    bus.clear();

    expect(bus.listenerCount('numero')).toBe(0);
    expect(bus.listenerCount('texto')).toBe(0);
  });

  it('funciona tipado con el mapa GameEvents', () => {
    const bus = new EventBus<GameEvents>();
    const onCoins = vi.fn();
    const onGameOver = vi.fn();

    bus.on('coins', onCoins);
    bus.on('game-over', onGameOver);

    bus.emit('coins', 7);
    bus.emit('game-over', { score: 1234, distance: 567, coins: 7 });

    expect(onCoins).toHaveBeenCalledWith(7);
    expect(onGameOver).toHaveBeenCalledWith({ score: 1234, distance: 567, coins: 7 });
  });
});
