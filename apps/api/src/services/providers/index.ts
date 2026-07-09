import { data912Provider } from './data912';
import { twelveDataProvider } from './twelveData';
import type { PriceProvider, ProviderSource, ProviderSymbol, SymbolSearchKind } from './types';

const REGISTRY: Record<ProviderSource, PriceProvider> = {
  TWELVE_DATA: twelveDataProvider,
  DATA912: data912Provider,
};

export function getProvider(source: ProviderSource): PriceProvider {
  return REGISTRY[source];
}

export function enabledProviders(): PriceProvider[] {
  return Object.values(REGISTRY).filter((provider) => provider.enabled);
}

/** Estado de la integración, tal como lo expone `GET /api/investments`. */
export function providerAvailability(): { twelveData: boolean; data912: boolean } {
  return { twelveData: twelveDataProvider.enabled, data912: data912Provider.enabled };
}

/** Proveedores habilitados con cobertura para un tipo de activo. */
export function providersFor(kind: SymbolSearchKind): PriceProvider[] {
  return enabledProviders().filter((provider) => provider.covers(kind));
}

/**
 * Busca en todos los proveedores que cubren el tipo. Un proveedor caído no
 * vacía los resultados del otro: se loguea y se devuelve lo que haya.
 */
export async function searchSymbols(kind: SymbolSearchKind, query: string): Promise<ProviderSymbol[]> {
  const providers = providersFor(kind);
  const settled = await Promise.allSettled(providers.map((provider) => provider.search(kind, query)));
  return settled.flatMap((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`[providers] Error buscando en ${providers[i].source}:`, result.reason);
    return [];
  });
}

export * from './types';
export { data912Enabled, fetchDolar, DOLAR_CURRENCIES } from './data912';
export { twelveDataEnabled, fetchOfficialUsdRate } from './twelveData';
