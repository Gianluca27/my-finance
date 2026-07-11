/**
 * Rate limiter simple en memoria, por clave (ej: email), con ventana deslizante.
 * Sin dependencias externas ni reloj propio: `now` se recibe como parámetro para
 * que sea determinístico en tests; en producción los callers usan `Date.now()`.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Registra un intento para `key` y devuelve si está permitido (dentro del máximo
   * para la ventana). Si no está permitido, NO se registra (no cuenta contra futuros
   * intentos una vez que la ventana libere espacio).
   */
  attempt(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
