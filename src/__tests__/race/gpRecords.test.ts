import { describe, expect, it } from 'vitest';
import { FakeStorage } from '../fakeStorage';
import {
  defaultGpStorage,
  GP_RECORDS_STORAGE_KEY,
  loadGpRecords,
  saveGpResult,
  type GpRecords,
} from '../../race/gpRecords';
import { TRACKS } from '../../race/tracks';

/**
 * Tests de los récords del GRAN PREMIO (#14 V4): persistencia por pista ×
 * dificultad bajo la clave versionada `formulita.gp.v1`, con la MISMA
 * robustez que el mute del AudioManager (JSON corrupto → default, storage
 * roto degrada a memoria sin lanzar) y semántica de récord ESTRICTA
 * (posición/vuelta mejor = menor; igualar no es récord).
 */

/** Pista y dificultad de referencia (la primera del registro / FÁCIL). */
const TRACK = TRACKS[0].id;
const OTHER_TRACK = TRACKS[1].id;
const EASY = 'easy' as const;

/** Resultado de carrera de referencia (P3, mejor vuelta 1:30.000). */
function result(overrides: Partial<{ position: number; bestLapMs: number; totalMs: number }> = {}) {
  return { position: 3, bestLapMs: 90_000, totalMs: 300_000, ...overrides };
}

describe('saveGpResult + loadGpRecords — round-trip', () => {
  it('guarda y lee los récords bajo la clave versionada formulita.gp.v1', () => {
    const storage = new FakeStorage();

    const outcome = saveGpResult(storage, TRACK, EASY, result());

    expect(outcome.positionRecord).toBe(true);
    expect(outcome.lapRecord).toBe(true);
    expect(storage.raw(GP_RECORDS_STORAGE_KEY)).toBe(
      JSON.stringify({ [TRACK]: { [EASY]: { bestPosition: 3, bestLapMs: 90_000 } } }),
    );
    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 3, bestLapMs: 90_000 } },
    });
  });

  it('loadGpRecords sobre storage vacío devuelve {} (y sin storage también)', () => {
    expect(loadGpRecords(new FakeStorage())).toEqual({});
    expect(loadGpRecords(null)).toEqual({});
  });

  it('el totalMs NO es récord: dos carreras idénticas salvo el total no lo cambian', () => {
    const storage = new FakeStorage();
    saveGpResult(storage, TRACK, EASY, result({ totalMs: 300_000 }));

    const outcome = saveGpResult(storage, TRACK, EASY, result({ totalMs: 999_999 }));

    expect(outcome.positionRecord).toBe(false);
    expect(outcome.lapRecord).toBe(false);
    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 3, bestLapMs: 90_000 } },
    });
  });
});

describe('saveGpResult — semántica de récord (menor es mejor)', () => {
  it('posición: mejora (P2), iguala (P2 de nuevo) y empeora (P4)', () => {
    const storage = new FakeStorage();
    expect(saveGpResult(storage, TRACK, EASY, result({ position: 3 })).positionRecord).toBe(true);
    expect(saveGpResult(storage, TRACK, EASY, result({ position: 2 })).positionRecord).toBe(true);
    // Igualar el mejor puesto NO es récord nuevo.
    expect(saveGpResult(storage, TRACK, EASY, result({ position: 2 })).positionRecord).toBe(false);
    expect(saveGpResult(storage, TRACK, EASY, result({ position: 4 })).positionRecord).toBe(false);
    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 2, bestLapMs: 90_000 } },
    });
  });

  it('vuelta: mejora, iguala y empeora (y una carrera sin vuelta válida no la pisa)', () => {
    const storage = new FakeStorage();
    expect(saveGpResult(storage, TRACK, EASY, result({ bestLapMs: 90_000 })).lapRecord).toBe(true);
    expect(saveGpResult(storage, TRACK, EASY, result({ bestLapMs: 80_500 })).lapRecord).toBe(true);
    expect(saveGpResult(storage, TRACK, EASY, result({ bestLapMs: 85_000 })).lapRecord).toBe(false);
    // Sin vuelta válida (0): no hay récord de vuelta y la guardada sobrevive.
    const noLap = saveGpResult(storage, TRACK, EASY, result({ bestLapMs: 0, position: 1 }));
    expect(noLap.lapRecord).toBe(false);
    expect(noLap.positionRecord).toBe(true);
    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 1, bestLapMs: 80_500 } },
    });
  });

  it('un resultado peor que el récord no reescribe el storage', () => {
    const storage = new FakeStorage();
    saveGpResult(storage, TRACK, EASY, result({ position: 1, bestLapMs: 80_000 }));
    const raw = storage.raw(GP_RECORDS_STORAGE_KEY);

    const outcome = saveGpResult(storage, TRACK, EASY, result({ position: 5, bestLapMs: 95_000 }));

    expect(outcome).toEqual({
      records: loadGpRecords(storage),
      positionRecord: false,
      lapRecord: false,
    });
    expect(storage.raw(GP_RECORDS_STORAGE_KEY)).toBe(raw);
  });
});

describe('gpRecords — claves por pista × dificultad aisladas', () => {
  it('pistas distintas no se pisan entre sí', () => {
    const storage = new FakeStorage();
    saveGpResult(storage, TRACK, EASY, result({ position: 2, bestLapMs: 80_000 }));
    saveGpResult(storage, OTHER_TRACK, EASY, result({ position: 1, bestLapMs: 70_000 }));

    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 2, bestLapMs: 80_000 } },
      [OTHER_TRACK]: { [EASY]: { bestPosition: 1, bestLapMs: 70_000 } },
    });
  });

  it('dificultades distintas de la MISMA pista tampoco', () => {
    const storage = new FakeStorage();
    saveGpResult(storage, TRACK, EASY, result({ position: 2, bestLapMs: 80_000 }));
    saveGpResult(storage, TRACK, 'hard', result({ position: 1, bestLapMs: 70_000 }));

    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: {
        [EASY]: { bestPosition: 2, bestLapMs: 80_000 },
        hard: { bestPosition: 1, bestLapMs: 70_000 },
      },
    });
  });
});

describe('gpRecords — parseo defensivo (todo lo que cruza el storage)', () => {
  it('JSON corrupto o shape inesperado degrada a {} sin lanzar', () => {
    const storage = new FakeStorage();
    for (const garbage of ['{no es json', '[]', '42', '"texto"', 'null', JSON.stringify(null)]) {
      storage.setItem(GP_RECORDS_STORAGE_KEY, garbage);
      expect(loadGpRecords(storage)).toEqual({});
    }
  });

  it('filas inválidas se descartan y las reconocibles se reconstruyen', () => {
    const storage = new FakeStorage();
    storage.setItem(
      GP_RECORDS_STORAGE_KEY,
      JSON.stringify({
        [TRACK]: {
          [EASY]: { bestPosition: 2, bestLapMs: 80_000 }, // válida
          normal: { bestPosition: 0, bestLapMs: 80_000 }, // posición < 1 → fuera
          hard: { bestPosition: 2.5, bestLapMs: 80_000 }, // no entera → fuera
          easy2: { bestPosition: '2' }, // tipos equivocados → fuera
        },
        pista_inventada: { [EASY]: { bestPosition: 1 } }, // pista desconocida → fuera
        [OTHER_TRACK]: { brutal: { bestPosition: 1 } }, // dificultad inválida → fuera
        basura: 'no soy un objeto', // bucket no-objeto → fuera
      }),
    );

    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 2, bestLapMs: 80_000 } },
    });
  });

  it('bestLapMs inválido degrada a null sin perder la posición', () => {
    const storage = new FakeStorage();
    storage.setItem(
      GP_RECORDS_STORAGE_KEY,
      JSON.stringify({ [TRACK]: { [EASY]: { bestPosition: 3, bestLapMs: -5 } } }),
    );
    expect(loadGpRecords(storage)).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 3, bestLapMs: null } },
    });
  });

  it('una pista desconocida o posición inválida no guardan nada', () => {
    const storage = new FakeStorage();
    expect(saveGpResult(storage, 'nurburgring' as typeof TRACK, EASY, result())).toEqual({
      records: {},
      positionRecord: false,
      lapRecord: false,
    });
    expect(
      saveGpResult(storage, TRACK, EASY, result({ position: Number.NaN, bestLapMs: 80_000 })),
    ).toEqual({ records: {}, positionRecord: false, lapRecord: false });
    expect(storage.raw(GP_RECORDS_STORAGE_KEY)).toBeNull();
  });
});

describe('gpRecords — degradación sin storage (modo privado / roto)', () => {
  it('storage que falla al ESCRIBIR: el veredicto y los récords rigen en memoria', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;

    const outcome = saveGpResult(storage, TRACK, EASY, result({ position: 1 }));

    expect(outcome.positionRecord).toBe(true);
    expect(outcome.lapRecord).toBe(true);
    expect(outcome.records).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 1, bestLapMs: 90_000 } },
    });
    // La escritura falló: al releer del storage no hay nada (degradación).
    expect(loadGpRecords(storage)).toEqual({});
  });

  it('storage que falla al LEER: se comportan como primera carrera (sin lanzar)', () => {
    const storage = new FakeStorage();
    storage.failReads = true;

    const outcome = saveGpResult(storage, TRACK, EASY, result({ position: 2 }));

    expect(outcome.positionRecord).toBe(true);
    expect(outcome.lapRecord).toBe(true);
  });

  it('sin storage (null): veredicto en memoria y sin persistencia', () => {
    const outcome = saveGpResult(null, TRACK, EASY, result({ position: 1 }));

    expect(outcome.records as GpRecords).toEqual({
      [TRACK]: { [EASY]: { bestPosition: 1, bestLapMs: 90_000 } },
    });
  });

  it('defaultGpStorage no lanza fuera del navegador (tests: undefined o el localStorage real)', () => {
    expect(() => defaultGpStorage()).not.toThrow();
  });
});
