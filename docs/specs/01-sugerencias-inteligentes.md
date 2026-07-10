# 01 — Sugerencias inteligentes ✅ IMPLEMENTADO

**Estado:** completado (commit `ffbc542`, julio 2026). Suite de tests en verde (58 tests, 3 archivos). Esta spec queda como registro de lo construido + gaps residuales.

## Qué se construyó

La implementación siguió la idea general de la spec original con decisiones propias (todas razonables, documentadas abajo):

### Servidor

- **`services/suggestions.ts` — `refreshSuggestionsForUser(userId)`**: capa de servicio (la spec la ponía inline en la ruta). Semántica de **sincronización**, más fuerte que el upsert planteado: crea sugerencias nuevas por fingerprint, actualiza el payload de las PENDING (los montos evolucionan), **borra** las PENDING cuyo patrón ya no se detecta (ej: el usuario creó el recurrente a mano), y nunca toca ACCEPTED/DISMISSED (memoria de qué no volver a sugerir). Ventana de 6 meses; **excluye transacciones con `debtId`/`goalId`** (ya tienen entidad propia — se anticipa al criterio de la spec 08).
- **`routes/suggestions.ts`** montado en `/api/suggestions` (`app.ts:35`): `GET /` (PENDING), `POST /refresh` (devuelve `{created, items}`), `POST /:id/accept` con `edits` opcionales validados (crea `RecurringExpense` con `nextDueDate` calculado, o `CategoryRule`; transacción Prisma atómica junto al cambio de status), `POST /:id/dismiss`.
- **`GET /api/transactions/suggest-category`** (`transactions.ts:53`): reglas primero (`matchRule`, confianza 1), historial después (`suggestCategoryFromHistory` sobre últimos 6 meses / 500 transacciones). Devuelve `{categoryId, source: 'rule'|'history', confidence}` o `null`.

### Web

- **Página dedicada `/sugerencias`** (`SuggestionsPage.tsx`) en lugar de paneles en Recurrentes/Categorías (decisión distinta a la spec — mejor: un solo lugar, con badge de conteo en el sidebar, `Layout.tsx:32,87-90`). Al montar corre `refreshSuggestions()` y revalida la lista cacheada; el error de análisis no bloquea la vista. Aceptar abre modal con los valores detectados editables (`edits`).
- **Chip en `AddTransactionModal`**: debounce sobre la nota → `suggestCategory` → chip "✨ Sugerida: {categoría}" clickeable, con tooltip que distingue regla vs historial. No pisa selección manual (solo aplica al click).

### Mobile

- Chip de sugerencia también en el `AddTransactionModal` de mobile (más de lo que pedía la spec).

## Gaps residuales (menores, no bloquean)

1. **Sin refresh tras import CSV**: la detección solo corre al entrar a `/sugerencias`. Tras importar movimientos, el badge del sidebar puede quedar desactualizado hasta la próxima visita. Fix chico si molesta: disparar `refreshSuggestions()` en el success del import (`ReportsPage`).
2. **Mobile sin pantalla de sugerencias**: solo tiene el chip en el modal. La paridad de la página va con la spec 18.
3. **Recurrentes anuales fuera de alcance** (decisión documentada en `services/suggestions.ts`: la ventana de 6 meses no alcanza; detectarlas necesitaría >2 años de historial).

## Verificación realizada

- `npm test`: 58/58 en verde (incluye `lib/suggestions.test.ts`).
- Ruta montada tras `requireAuth`, respuestas por `serialize()`, working tree limpio.
