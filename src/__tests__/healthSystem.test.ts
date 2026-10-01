import { describe, expect, it } from 'vitest';
import { HEALTH } from '../config/balance';
import { HealthSystem } from '../systems/HealthSystem';

/**
 * Tests del HealthSystem (issue #10, H1): daño puntual acumulativo con
 * i-frames, roce continuo prorrateado por dt (sin i-frames), botiquín con
 * clamp, reset y defensas NaN/negativos. Lógica pura: dt inyectado, sin
 * Phaser; nada del gameplay consume el sistema todavía (fases H2+).
 */

const DT = 1 / 60;

/** Avanza `seconds` de ticks con dt fijo (hace tictac los i-frames). */
function tick(health: HealthSystem, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    health.update(DT);
  }
}

/** Frota la pared `seconds` de tiempo de juego con dt por frame. */
function scrapeFor(health: HealthSystem, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    health.scrape(DT);
  }
}

describe('HealthSystem — estado inicial', () => {
  it('arranca con la vida llena, vivo y fuera de estado crítico', () => {
    const health = new HealthSystem();

    expect(health.hp).toBe(HEALTH.max);
    expect(health.ratio).toBe(1);
    expect(health.isAlive).toBe(true);
    expect(health.isCritical).toBe(false);
    expect(health.isInvulnerable).toBe(false);
  });

  it('acepta HP inicial arbitrario, clampeado a [0, max]', () => {
    expect(new HealthSystem(50).hp).toBe(50);
    expect(new HealthSystem(0).hp).toBe(0);
    expect(new HealthSystem(1000).hp).toBe(HEALTH.max);
    expect(new HealthSystem(-5).hp).toBe(0);
  });

  it('HP inicial no finito vuelve al tope', () => {
    expect(new HealthSystem(Number.NaN).hp).toBe(HEALTH.max);
    expect(new HealthSystem(Number.POSITIVE_INFINITY).hp).toBe(HEALTH.max);
  });
});

describe('HealthSystem — daño puntual acumulativo y muerte', () => {
  it('aplica impactDamage.rival y luego debris (con i-frames vencidos entre golpes)', () => {
    const health = new HealthSystem();

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit');
    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival); // 65

    tick(health, HEALTH.invulnerabilitySeconds);

    expect(health.damage(HEALTH.impactDamage.debris)).toBe('hit');
    expect(health.hp).toBe(45);
    expect(health.isAlive).toBe(true);
  });

  it('el daño acumulado mata al llegar el HP a 0 y reporta dead', () => {
    const health = new HealthSystem();

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit'); // 65
    tick(health, HEALTH.invulnerabilitySeconds);
    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit'); // 30
    tick(health, HEALTH.invulnerabilitySeconds);

    // Golpe letal: 30 de vida no aguanta otro rival de 35.
    expect(health.damage(HEALTH.impactDamage.rival)).toBe('dead');
    expect(health.hp).toBe(0);
    expect(health.isAlive).toBe(false);
    expect(health.ratio).toBe(0);
    expect(health.isCritical).toBe(true);
  });

  it('un golpe más grande que la vida restante deja el HP en 0, nunca negativo', () => {
    const health = new HealthSystem(10);

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('dead');
    expect(health.hp).toBe(0);
  });
});

describe('HealthSystem — i-frames post-impacto', () => {
  it('el segundo golpe inmediato se ignora y no re-arma los i-frames', () => {
    const health = new HealthSystem();

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit');
    expect(health.isInvulnerable).toBe(true);

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('ignored');
    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival); // sin daño extra
  });

  it('los i-frames expiran con update: pasado el tiempo vuelve a golpear', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival);

    // A los 0.3 s (mitad de la ventana) sigue blindado...
    tick(health, HEALTH.invulnerabilitySeconds / 2);
    expect(health.isInvulnerable).toBe(true);
    expect(health.damage(HEALTH.impactDamage.rival)).toBe('ignored');

    // ...y al vencer los 0.6 s el golpe entra.
    tick(health, HEALTH.invulnerabilitySeconds / 2);
    expect(health.isInvulnerable).toBe(false);
    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit');
    expect(health.hp).toBe(HEALTH.max - 2 * HEALTH.impactDamage.rival); // 30
  });

  it('un dt gigante se acota: los i-frames no expiran de un solo update(10)', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival);
    health.update(10); // anti-espiral: como mucho tictac 0.25 s

    expect(health.isInvulnerable).toBe(true);
  });
});

describe('HealthSystem — roce con pared (scrape)', () => {
  it('prorratea scrapePerSecond por dt (sin i-frames, HP entero)', () => {
    const health = new HealthSystem();

    // 1 segundo de roce = 15 HP exactos.
    scrapeFor(health, 1);

    expect(health.hp).toBe(HEALTH.max - HEALTH.scrapePerSecond); // 85
  });

  it('el residuo fraccionario se acumula: a 60 fps baja 1 HP cada 4 frames', () => {
    const health = new HealthSystem();

    health.scrape(DT); // 0.25 pendiente
    health.scrape(DT); // 0.50 pendiente
    health.scrape(DT); // 0.75 pendiente
    expect(health.hp).toBe(HEALTH.max); // todavía nada entero que descontar

    health.scrape(DT); // 1.00 → descuenta 1
    expect(health.hp).toBe(HEALTH.max - 1);
  });

  it('el roce pega aunque haya i-frames de un impacto previo', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival); // 65, i-frames armados
    expect(health.isInvulnerable).toBe(true);

    // El primer tick solo acumula residuo (0.25 HP < 1 entero)...
    expect(health.scrape(DT)).toBe('hit');
    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);

    // ...pero un segundo completo de roce drena 15 HP (65 → 50) igual.
    scrapeFor(health, 1);
    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival - HEALTH.scrapePerSecond);
  });

  it('el roce NO arma i-frames: un golpe inmediato después entra sin problema', () => {
    const health = new HealthSystem();

    scrapeFor(health, 1); // 85, solo frotó la pared

    expect(health.isInvulnerable).toBe(false);
    expect(health.damage(HEALTH.impactDamage.debris)).toBe('hit');
    expect(health.hp).toBe(HEALTH.max - HEALTH.scrapePerSecond - HEALTH.impactDamage.debris); // 65
  });

  it('mata cuando el roce llega el HP a 0', () => {
    const health = new HealthSystem(10);

    // 15 HP/s × 1 s = 15 > 10 de vida.
    scrapeFor(health, 1);

    expect(health.hp).toBe(0);
    expect(health.isAlive).toBe(false);
    expect(health.scrape(DT)).toBe('dead');
  });

  it('el roce mata aunque haya i-frames activos de un impacto previo', () => {
    const health = new HealthSystem();

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit'); // 65, i-frames armados

    // 4 s de roce drenan 60 HP (65 → 5), aún vivo...
    scrapeFor(health, 4);
    expect(health.hp).toBe(5);

    // ...y otro segundo (15 HP) remata sin importar los i-frames.
    scrapeFor(health, 1);
    expect(health.hp).toBe(0);
    expect(health.isAlive).toBe(false);
  });
});

describe('HealthSystem — botiquín (heal)', () => {
  it('cura repairAmount y devuelve lo efectivamente curado', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival); // 65
    tick(health, HEALTH.invulnerabilitySeconds);

    expect(health.heal(HEALTH.repairAmount)).toBe(HEALTH.repairAmount);
    expect(health.hp).toBe(HEALTH.max); // 65 + 35 = 100
  });

  it('clampa al máximo y devuelve solo lo que faltaba', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.debris); // 80
    tick(health, HEALTH.invulnerabilitySeconds);
    health.damage(HEALTH.impactDamage.debris); // 60
    tick(health, HEALTH.invulnerabilitySeconds);

    // Pedir 1000 con 60 de vida cura solo 40.
    expect(health.heal(1000)).toBe(40);
    expect(health.hp).toBe(HEALTH.max);
  });

  it('con la vida llena no cura nada y devuelve 0', () => {
    const health = new HealthSystem();

    expect(health.heal(HEALTH.repairAmount)).toBe(0);
    expect(health.hp).toBe(HEALTH.max);
  });

  it('la mecánica es pura: heal también opera con HP en 0 (usarlo o no lo decide la escena)', () => {
    const health = new HealthSystem(1);

    expect(health.damage(HEALTH.impactDamage.rival)).toBe('dead');
    expect(health.hp).toBe(0);

    expect(health.heal(HEALTH.repairAmount)).toBe(HEALTH.repairAmount);
    expect(health.hp).toBe(HEALTH.repairAmount);
  });
});

describe('HealthSystem — reset', () => {
  it('reset vuelve a la vida llena sin i-frames ni residuo de roce', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival);
    for (let i = 0; i < 30; i += 1) {
      health.scrape(DT); // medio segundo de roce: residuo fraccionario
    }

    health.reset();

    expect(health.hp).toBe(HEALTH.max);
    expect(health.ratio).toBe(1);
    expect(health.isAlive).toBe(true);
    expect(health.isCritical).toBe(false);
    expect(health.isInvulnerable).toBe(false);
    // El residuo se limpió: un roce corto no descuenta de más.
    health.scrape(DT);
    expect(health.hp).toBe(HEALTH.max);
  });
});

describe('HealthSystem — estado crítico', () => {
  it('isCritical dispara al llegar al umbral criticalRatio (ratio ≤ 0.25)', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival); // 65
    expect(health.isCritical).toBe(false);

    tick(health, HEALTH.invulnerabilitySeconds);
    health.damage(HEALTH.impactDamage.rival); // 30
    expect(health.isCritical).toBe(false); // 0.3 > 0.25

    tick(health, HEALTH.invulnerabilitySeconds);
    health.damage(HEALTH.impactDamage.debris); // 10
    expect(health.isCritical).toBe(true); // 0.1 ≤ 0.25
  });
});

describe('HealthSystem — defensas NaN/negativos', () => {
  it('damage con amount NaN, 0 o negativo es un no-op y NO arma i-frames', () => {
    const health = new HealthSystem();

    expect(health.damage(Number.NaN)).toBe('ignored');
    expect(health.damage(0)).toBe('ignored');
    expect(health.damage(-35)).toBe('ignored');
    expect(health.hp).toBe(HEALTH.max);
    expect(health.isInvulnerable).toBe(false);

    // Sin i-frames armados: un golpe real entra de inmediato.
    expect(health.damage(HEALTH.impactDamage.rival)).toBe('hit');
    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);
  });

  it('heal con amount NaN, 0 o negativo devuelve 0 y no cambia el HP', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival); // 65
    const hp = health.hp;

    expect(health.heal(Number.NaN)).toBe(0);
    expect(health.heal(0)).toBe(0);
    expect(health.heal(-10)).toBe(0);
    expect(health.hp).toBe(hp);
  });

  it('scrape y update con dt NaN, 0 o negativo son no-op', () => {
    const health = new HealthSystem();

    health.damage(HEALTH.impactDamage.rival); // arma i-frames

    expect(health.scrape(Number.NaN)).toBe('hit');
    expect(health.scrape(0)).toBe('hit');
    expect(health.scrape(-1)).toBe('hit');
    health.update(Number.NaN);
    health.update(0);
    health.update(-1);

    expect(health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);
    expect(health.isInvulnerable).toBe(true); // el update inválido no consumió i-frames
  });
});
