/**
 * Fake de `Storage` en memoria para testear los repositorios sin
 * localStorage real. Configurable para simular modos rotos:
 * - `failWrites`: setItem lanza (modo privado que bloquea la escritura).
 * - `failReads`: getItem lanza (storage corrompido / bloqueado).
 */

export class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();

  /** Cuando true, setItem lanza (como el modo privado que bloquea escribir). */
  failWrites = false;

  /** Cuando true, getItem lanza (como un storage bloqueado a mitad de sesión). */
  failReads = false;

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    if (this.failReads) {
      throw new Error('getItem bloqueado (fake)');
    }
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error('setItem bloqueado (fake)');
    }
    this.map.set(key, String(value));
  }

  /** Vuelca el contenido crudo (para asertar el JSON persistido). */
  raw(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}
