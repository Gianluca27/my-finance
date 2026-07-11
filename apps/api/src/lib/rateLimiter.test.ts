import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimiter';

const HOUR = 60 * 60 * 1000;

describe('RateLimiter', () => {
  it('permite hasta el máximo de intentos dentro de la ventana', () => {
    const limiter = new RateLimiter(3, HOUR);
    expect(limiter.attempt('a@b.com', 0)).toBe(true);
    expect(limiter.attempt('a@b.com', 1)).toBe(true);
    expect(limiter.attempt('a@b.com', 2)).toBe(true);
  });

  it('bloquea el intento que supera el máximo dentro de la ventana', () => {
    const limiter = new RateLimiter(3, HOUR);
    limiter.attempt('a@b.com', 0);
    limiter.attempt('a@b.com', 1);
    limiter.attempt('a@b.com', 2);
    expect(limiter.attempt('a@b.com', 3)).toBe(false);
  });

  it('un intento bloqueado no cuenta contra intentos futuros', () => {
    const limiter = new RateLimiter(3, HOUR);
    limiter.attempt('a@b.com', 0);
    limiter.attempt('a@b.com', 1);
    limiter.attempt('a@b.com', 2);
    limiter.attempt('a@b.com', 3); // bloqueado, no se registra
    // pasa 1 hora desde el primer hit: los 3 hits originales expiran, el bloqueado no cuenta
    expect(limiter.attempt('a@b.com', HOUR)).toBe(true);
  });

  it('libera espacio a medida que los intentos viejos salen de la ventana', () => {
    const limiter = new RateLimiter(3, HOUR);
    limiter.attempt('a@b.com', 0);
    limiter.attempt('a@b.com', 1000);
    limiter.attempt('a@b.com', 2000);
    expect(limiter.attempt('a@b.com', 3000)).toBe(false);
    // el hit de t=0 ya salió de la ventana (>= 1 hora después)
    expect(limiter.attempt('a@b.com', HOUR + 1)).toBe(true);
  });

  it('cuenta cada clave (email) por separado', () => {
    const limiter = new RateLimiter(1, HOUR);
    expect(limiter.attempt('a@b.com', 0)).toBe(true);
    expect(limiter.attempt('a@b.com', 1)).toBe(false);
    expect(limiter.attempt('c@d.com', 1)).toBe(true);
  });
});
