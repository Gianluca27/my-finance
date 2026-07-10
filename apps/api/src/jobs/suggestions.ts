import cron from 'node-cron';
import { config } from '../config';
import { runSuggestionsForAllUsers } from '../services/suggestions';

/**
 * Job diario de sugerencias: analiza el historial de cada usuario y sincroniza
 * las sugerencias de recurrentes y reglas (ver services/suggestions.ts).
 */
export function scheduleSuggestionsJob(): void {
  cron.schedule(config.suggestionsCron, async () => {
    try {
      const result = await runSuggestionsForAllUsers();
      console.log(`[suggestions] users=${result.users} created=${result.created}`);
    } catch (err) {
      console.error('[suggestions] Error en job de sugerencias:', err);
    }
  });
  console.log(`[suggestions] Job programado: ${config.suggestionsCron}`);
}
