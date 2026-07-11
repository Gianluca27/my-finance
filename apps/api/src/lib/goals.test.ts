import { describe, expect, it } from 'vitest';
import { netSaved, resolveAchievedAt } from './goals';

describe('netSaved', () => {
  it('resta los retiros de los aportes', () => {
    expect(netSaved(300, 50)).toBe(250);
  });

  it('sin retiros, es simplemente lo aportado', () => {
    expect(netSaved(100, 0)).toBe(100);
  });

  it('un retiro total deja el ahorro en cero', () => {
    expect(netSaved(150, 150)).toBe(0);
  });
});

describe('resolveAchievedAt', () => {
  it('marca lograda con fecha actual la primera vez que se alcanza el objetivo', () => {
    const result = resolveAchievedAt(null, 1000, 1000);
    expect(result).toBeInstanceOf(Date);
  });

  it('conserva la fecha original si ya estaba lograda', () => {
    const original = new Date('2026-01-01T00:00:00.000Z');
    expect(resolveAchievedAt(original, 1200, 1000)).toBe(original);
  });

  it('limpia achievedAt si un retiro deja el ahorro bajo el objetivo', () => {
    const original = new Date('2026-01-01T00:00:00.000Z');
    expect(resolveAchievedAt(original, 800, 1000)).toBeNull();
  });

  it('no marca lograda si el ahorro todavía no llega al objetivo', () => {
    expect(resolveAchievedAt(null, 500, 1000)).toBeNull();
  });
});
