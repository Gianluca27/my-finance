# 18 — Mobile: registro de cuenta e Inversiones

**Esfuerzo:** L · **Dependencias:** mejor después de 14/15 para no portar dos veces la pantalla de Inversiones

## Contexto

`apps/mobile` tiene 11 pantallas que cubren 10 módulos web; faltan exactamente dos cosas:

- **Registro**: solo existe `LoginScreen` — no se puede crear cuenta desde el celular (la API `POST /api/auth/register` obviamente existe; la web la usa).
- **Inversiones**: único módulo funcional sin pantalla mobile (`navItems.ts` no lo lista). Todo el flujo de la sección de inversiones es web-only.

## Alcance

### 1. RegisterScreen

- Form nombre/email/contraseña (mismas validaciones que la web: password ≥8) → `api.register` (ya existe en el `ApiClient` compartido) → guarda token en AsyncStorage (mismo flujo que login).
- Link cruzado login ↔ registro. Esfuerzo chico, valor alto: hoy un usuario nuevo mobile-first no puede ni entrar.
- Si spec 02 está: link "¿Olvidaste tu contraseña?" (abre el flujo web con `Linking` — no duplicar la pantalla de reset en mobile).

### 2. InvestmentsScreen — fase 1: solo lectura

- Resumen (valor total, invertido, PnL, TIR si spec 14 está) + lista de activos con precio/tenencia/PnL + detalle con historial de operaciones y gráfico simple de precio.
- Reusa `ApiClient` compartido — cero API nueva. Agregar a la navegación (`navItems.ts`).
- Decisión consciente: **el alta de activos y operaciones queda en web** en esta fase (el flujo de búsqueda de símbolos + validaciones es el más complejo de la app; portarlo tiene poco valor si la carga se hace sentado).

### 3. SuggestionsScreen

- Paridad de la página `/sugerencias` web (gap residual 2 de la spec 01): lista de pendientes con aceptar/descartar, refresh al montar. El chip de sugerencia en el `AddTransactionModal` mobile ya existe; falta solo la pantalla. Pantalla simple — reusa `listSuggestions`/`acceptSuggestion`/`dismissSuggestion` del `ApiClient`.

### 4. InvestmentsScreen — fase 2 (posterior, separable)

- Registrar operación compra/venta y renta (spec 15) desde el detalle.
- Refresh de precios on-demand (spec 14) — pull-to-refresh.

## Cambios concretos

- `apps/mobile/src/screens/RegisterScreen.tsx` — nueva.
- `apps/mobile/src/screens/InvestmentsScreen.tsx` — nueva (fase 1).
- Navegación: `navItems.ts` + stack de auth.
- Sin cambios de API ni shared (todo ya existe en `@myfinance/shared`).

## Testing

Manual (Expo):
- Registro end-to-end desde el celular → categorías default creadas, entra logueado.
- Inversiones: resumen y lista consistentes con la web para el mismo usuario; `missingRates` renderiza el aviso.
- Sin conexión → estados de error razonables (patrón de las demás screens).

## Fuera de alcance

- Fase 2 completa de Inversiones (alta de activos con búsqueda de símbolos).
- Paridad de features nuevas de otras specs (drill-down, selección múltiple, etc.) — cada spec futura debería incluir mobile o anotar la deuda explícitamente.
- Notificaciones push de precios.
