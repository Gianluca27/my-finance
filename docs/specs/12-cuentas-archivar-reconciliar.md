# 12 — Cuentas: archivar, reconciliar saldo y transferencias editables

**Esfuerzo:** M · **Dependencias:** ninguna

## Contexto

- `Account.archivedAt` existe en el modelo (`schema.prisma:282`) pero ni la API ni la UI lo usan — campo muerto. Una cuenta con historial no se puede sacar de la vista: el DELETE está bloqueado con transacciones (`accounts.ts:116-122`), correcto pero sin alternativa.
- No hay reconciliación: si el saldo calculado difiere del real (efectivo, redondeos, movimientos no cargados), el único remedio es editar `initialBalance`, que reescribe la historia.
- Transferencias: sin edición (no hay PUT en `transfers.ts`) y el form no pide fecha aunque la API la acepta (`transfers.ts:17-18, 51`).

## Alcance

### 1. Archivar / desarchivar

- API: `archived: boolean` en el `updateSchema` de `PUT /api/accounts/:id` → setea/limpia `archivedAt`. Reglas: la cuenta default no se archiva (mismo criterio que el DELETE, `accounts.ts:114`); archivada no puede pasarse a default.
- Comportamiento: archivadas se excluyen de los selects de alta (transacción, transferencia, pagos) pero **siguen contando** en balance total e histórico (el dinero existió). Listado de Cuentas: sección colapsada "Archivadas (N)" con acción desarchivar.
- El GET list incluye archivadas con su `archivedAt`; el filtrado es responsabilidad de la UI (evita romper agregados existentes).

### 2. Reconciliación

- API: `POST /api/accounts/:id/reconcile` — body `{ actualBalance, date? }`. Server calcula `diff = actualBalance − balanceCalculado` (reusar `balancesByAccount`); si diff ≠ 0 crea `Transaction` de ajuste (INCOME o EXPENSE según signo, nota `"Ajuste de saldo"`, sin categoría) y devuelve `{ adjustment, newBalance }`. Si diff = 0, no crea nada.
- UI: botón "Ajustar saldo" en la card → modal "¿Cuál es el saldo real?" precargado con el actual → muestra la diferencia que se registrará antes de confirmar.

### 3. Transferencias: fecha + edición

- Form de transferencia: input `date` (default hoy) — la API ya lo acepta.
- API: `PUT /api/transfers/:id` — mismas validaciones que el POST (cuentas propias, origen ≠ destino). Cliente: `updateTransfer`.
- UI: lápiz en "Transferencias recientes" → modal precargado.

## Cambios concretos

- `apps/api/src/routes/accounts.ts` — archived en update, endpoint reconcile.
- `apps/api/src/routes/transfers.ts` — PUT.
- `packages/shared/src/types.ts` + `api.ts` — `archived`, `reconcileAccount`, `updateTransfer`, fecha en create.
- `apps/web/src/pages/AccountsPage.tsx` — sección archivadas, modal reconciliar, fecha y edición en transferencias.
- Revisar selects de cuenta en: `AddTransactionModal`, modal de pago de recurrentes (spec 07), deudas (spec 09), metas (spec 08) → filtrar archivadas.

## Testing

Manual:
- Archivar cuenta con historial → desaparece de selects, balance total no cambia, sus movimientos siguen visibles en el listado.
- Intentar archivar la default → error claro.
- Reconciliar con saldo real $500 sobre calculado $480 → transacción INCOME $20 "Ajuste de saldo", balance queda $500.
- Reconciliar con el mismo saldo → no crea transacción.
- Editar transferencia (monto y fecha) → balances de ambas cuentas recalculan bien.

## Fuera de alcance

- Multi-moneda por cuenta (spec 19).
- Semántica de tarjeta de crédito (spec 20).
- Excluir cuentas archivadas del balance total (decisión consciente de mantenerlas; revisar con multi-moneda si hace falta un toggle).
