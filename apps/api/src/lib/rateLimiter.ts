/**
 * Rate limiter simple en memoria, por clave (ej: email), con ventana deslizante.
 * Sin dependencias externas ni reloj propio: `now` se recibe como parámetro para
 * que sea determinístico en tests; en producción los callers usan `Date.now()`.
 *
 * La memoria está acotada: una limpieza periódica (a lo sumo una vez por ventana)
 * elimina las claves cuyos intentos ya salieron todos de la ventana — sin esto,
 * un endpoint público podría hacer crecer el mapa sin límite con claves distintas.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

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
    this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Cantidad de claves con intentos registrados (para tests y diagnóstico). */
  get size(): number {
    return this.hits.size;
  }

  /**
   * Elimina las claves sin ningún intento vivo. Corre a lo sumo una vez por ventana:
   * el costo O(claves) se amortiza y el mapa queda acotado a ~2 ventanas de claves activas.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}
