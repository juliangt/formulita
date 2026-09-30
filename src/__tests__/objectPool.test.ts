import { describe, expect, it } from 'vitest';
import { ObjectPool } from '../systems/SpawnSystem';

/**
 * Tests del pool genérico usado por SpawnSystem (Fase 4): reciclaje real
 * (reusar instancias, no crear por frame), tope duro de creación y Releases
 * defensivos. 100% puro, sin Phaser.
 */

interface FakeItem {
  readonly id: number;
}

let nextId = 0;

function makePool(maxSize = 3): ObjectPool<FakeItem> {
  nextId = 0;
  return new ObjectPool<FakeItem>(() => ({ id: nextId++ }), maxSize);
}

/** acquire con aserción: falla el test si el pool está agotado. */
function mustAcquire(pool: ObjectPool<FakeItem>): FakeItem {
  const item = pool.acquire();
  if (item === null) {
    throw new Error('el pool no debería estar agotado en este test');
  }
  return item;
}

describe('ObjectPool — creación', () => {
  it('crea instancias bajo demanda hasta el tope y luego devuelve null', () => {
    const pool = makePool(3);

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();

    expect(a).toEqual({ id: 0 });
    expect(b).toEqual({ id: 1 });
    expect(c).toEqual({ id: 2 });
    expect(pool.createdCount).toBe(3);
    expect(pool.activeCount).toBe(3);
    expect(pool.freeCount).toBe(0);
    expect(pool.acquire()).toBeNull(); // tope duro: no crece
    expect(pool.createdCount).toBe(3);
  });

  it('rechaza tamaños inválidos', () => {
    expect(() => new ObjectPool(() => ({}), 0)).toThrow();
    expect(() => new ObjectPool(() => ({}), 1.5)).toThrow();
  });
});

describe('ObjectPool — reciclaje', () => {
  it('release + acquire devuelve la MISMA instancia (recicla, no crea)', () => {
    const pool = makePool(2);
    const item = mustAcquire(pool);
    mustAcquire(pool);

    pool.release(item);
    expect(pool.activeCount).toBe(1);
    expect(pool.freeCount).toBe(1);

    const recycled = pool.acquire();
    expect(recycled).toBe(item); // misma referencia: sin objetos nuevos
    expect(pool.createdCount).toBe(2);
  });

  it('respeta LIFO entre liberados y reabastece en orden', () => {
    const pool = makePool(3);
    const a = mustAcquire(pool);
    const b = mustAcquire(pool);
    const c = mustAcquire(pool);

    pool.release(a);
    pool.release(b);
    pool.release(c);

    expect(pool.acquire()).toBe(c);
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).toBe(a);
  });

  it('mil ciclos acquire/release reusan sin crear nuevas instancias', () => {
    const pool = makePool(4);
    for (let i = 0; i < 1000; i += 1) {
      const item = mustAcquire(pool);
      pool.release(item);
    }
    expect(pool.createdCount).toBe(1); // siempre recicló la misma
    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(1);
  });

  it('mantener 4 activas y ciclar no supera el tope ni crea de más', () => {
    const pool = makePool(4);
    const held = [mustAcquire(pool), mustAcquire(pool), mustAcquire(pool), mustAcquire(pool)];
    expect(pool.createdCount).toBe(4);

    for (let i = 0; i < 1000; i += 1) {
      const slot = i % 4;
      pool.release(held[slot]);
      expect(mustAcquire(pool)).toBe(held[slot]);
      expect(pool.createdCount).toBe(4);
    }
    expect(pool.activeCount).toBe(4);
    expect(pool.freeCount).toBe(0);
  });
});

describe('ObjectPool — releases defensivos', () => {
  it('release doble es idempotente', () => {
    const pool = makePool(2);
    const item = mustAcquire(pool);
    pool.release(item);
    pool.release(item);

    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(1); // no se duplicó el slot libre
  });

  it('release de un elemento ajeno al pool es un no-op', () => {
    const pool = makePool(2);
    const foreign: FakeItem = { id: 999 };
    pool.release(foreign);

    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(0);
  });
});

describe('ObjectPool — iteración y releaseAll', () => {
  it('forEachActive solo visita las activas; forEachCreated todas', () => {
    const pool = makePool(3);
    const a = mustAcquire(pool);
    const b = mustAcquire(pool);
    const c = mustAcquire(pool);
    pool.release(b);

    const actives: FakeItem[] = [];
    pool.forEachActive((item) => actives.push(item));
    expect(actives).toEqual([a, c]);

    const created: FakeItem[] = [];
    pool.forEachCreated((item) => created.push(item));
    expect(created).toEqual([a, b, c]);
  });

  it('releaseAll libera todo y el pool queda reutilizable', () => {
    const pool = makePool(3);
    const held = [mustAcquire(pool), mustAcquire(pool), mustAcquire(pool)];

    pool.releaseAll();

    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(3);
    expect(held).toContain(pool.acquire()); // recicla (LIFO: devuelve el último)
  });
});
