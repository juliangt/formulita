import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBUG_STORAGE_KEY, isDebugMode } from '../config/debugFlags';
import { FakeStorage } from './fakeStorage';

/**
 * Tests del flag de modo debug (issue #16).
 *
 * `isDebugMode` es pura e inyectable (search/storage como parámetros): los
 * dos orígenes son SUMATIVOS (OR) — basta uno en ON — y todo valor que no sea
 * `'1'`/`'true'` (trim + case-insensitive) cuenta como OFF. Nunca lanza: el
 * diagnóstico no puede tumbar el arranque del juego.
 */

describe('isDebugMode — query param', () => {
  it('OFF por defecto: search vacío y storage vacío', () => {
    expect(isDebugMode('', new FakeStorage())).toBe(false);
  });

  it('?debug=1 prende el flag', () => {
    expect(isDebugMode('?debug=1', new FakeStorage())).toBe(true);
  });

  it('?debug=true prende el flag (case-insensitive)', () => {
    expect(isDebugMode('?debug=true', new FakeStorage())).toBe(true);
    expect(isDebugMode('?debug=TRUE', new FakeStorage())).toBe(true);
    expect(isDebugMode('?debug=True', new FakeStorage())).toBe(true);
  });

  it('espacios accidentales alrededor del valor no rompen el flag', () => {
    expect(isDebugMode('?debug=%20true%20', new FakeStorage())).toBe(true);
    expect(isDebugMode('?debug=+1+', new FakeStorage())).toBe(true);
  });

  it('convive con otros params de la URL', () => {
    expect(isDebugMode('?escena=race&debug=1&fantasma=off', new FakeStorage())).toBe(true);
  });

  it('?debug=0 NO prende el flag (no hay vía de apagado)', () => {
    expect(isDebugMode('?debug=0', new FakeStorage())).toBe(false);
  });

  it('valores basura (?debug=abc) NO prenden el flag', () => {
    expect(isDebugMode('?debug=abc', new FakeStorage())).toBe(false);
    expect(isDebugMode('?debug=2', new FakeStorage())).toBe(false);
    expect(isDebugMode('?debug=on', new FakeStorage())).toBe(false);
  });

  it('?debug= (vacío) NO prende el flag', () => {
    expect(isDebugMode('?debug=', new FakeStorage())).toBe(false);
  });

  it('otro param (?other=1) no prende el flag', () => {
    expect(isDebugMode('?other=1', new FakeStorage())).toBe(false);
    expect(isDebugMode('?debugging=1', new FakeStorage())).toBe(false);
  });
});

describe('isDebugMode — localStorage', () => {
  it(`'1' en ${DEBUG_STORAGE_KEY} prende el flag`, () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, '1');
    expect(isDebugMode('', storage)).toBe(true);
  });

  it(`'true' / 'TRUE' / ' true ' en ${DEBUG_STORAGE_KEY} prenden el flag`, () => {
    for (const value of ['true', 'TRUE', 'True', ' true ', '\ttrue\n']) {
      const storage = new FakeStorage();
      storage.setItem(DEBUG_STORAGE_KEY, value);
      expect(isDebugMode('', storage), `valor: ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it(`'0', '' y basura NO prenden el flag`, () => {
    for (const value of ['0', '', 'yes', '2', 'debug', '1x']) {
      const storage = new FakeStorage();
      storage.setItem(DEBUG_STORAGE_KEY, value);
      expect(isDebugMode('', storage), `valor: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('sin la clave (getItem → null) el flag queda OFF', () => {
    expect(isDebugMode('', new FakeStorage())).toBe(false);
  });

  it('otra clave versionada no cuenta: la clave es exacta', () => {
    const storage = new FakeStorage();
    storage.setItem('formulita.debug.v0', '1');
    storage.setItem('debug', '1');
    expect(isDebugMode('', storage)).toBe(false);
  });
});

describe('isDebugMode — combinación de orígenes (OR)', () => {
  it('query ON + storage OFF → ON (la query pide debug)', () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, '0');
    expect(isDebugMode('?debug=1', storage)).toBe(true);
  });

  it('query OFF + storage ON → ON (el storage sobrevive recargas)', () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, 'true');
    expect(isDebugMode('?otra=pagina', storage)).toBe(true);
    expect(isDebugMode('', storage)).toBe(true);
  });

  it('query explícita en 0 + storage ON → ON igual (el storage decide solo)', () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, '1');
    expect(isDebugMode('?debug=0', storage)).toBe(true);
  });

  it('ambos OFF → OFF', () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, '0');
    expect(isDebugMode('?debug=abc', storage)).toBe(false);
  });
});

describe('isDebugMode — robustez (nunca lanza)', () => {
  it('storage que lanza al getItem degrada a OFF sin lanzar', () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    expect(() => isDebugMode('', storage)).not.toThrow();
    expect(isDebugMode('', storage)).toBe(false);
  });

  it('con storage roto, la query sigue pudiendo prender el flag', () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    expect(isDebugMode('?debug=1', storage)).toBe(true);
  });

  it('storage undefined (SSR/tests) no lanza y respeta la query', () => {
    expect(isDebugMode('', undefined)).toBe(false);
    expect(isDebugMode('?debug=true', undefined)).toBe(true);
  });

  it('search malformado no tumba el flag (degrada a lo que diga el storage)', () => {
    const storage = new FakeStorage();
    storage.setItem(DEBUG_STORAGE_KEY, '1');
    expect(() => isDebugMode('%%%', storage)).not.toThrow();
    expect(isDebugMode('%%%', storage)).toBe(true);

    expect(() => isDebugMode('%E0%A4%A', new FakeStorage())).not.toThrow();
    expect(isDebugMode('%E0%A4%A', new FakeStorage())).toBe(false);
  });
});

describe('isDebugMode — defaults del entorno (happy-dom)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(DEBUG_STORAGE_KEY);
  });

  it('sin argumentos no lanza y queda OFF con el localStorage limpio', () => {
    expect(() => isDebugMode()).not.toThrow();
    expect(isDebugMode()).toBe(false);
  });

  it('sin argumentos lee el localStorage real del entorno', () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    expect(isDebugMode()).toBe(true);

    localStorage.setItem(DEBUG_STORAGE_KEY, 'TRUE');
    expect(isDebugMode()).toBe(true);

    localStorage.removeItem(DEBUG_STORAGE_KEY);
    expect(isDebugMode()).toBe(false);
  });

  it('un localStorage global que lanza degrada a OFF sin lanzar', () => {
    vi.stubGlobal(
      'localStorage',
      { getItem: () => { throw new Error('localStorage bloqueado (fake)'); } },
    );
    expect(() => isDebugMode()).not.toThrow();
    expect(isDebugMode()).toBe(false);
  });
});
