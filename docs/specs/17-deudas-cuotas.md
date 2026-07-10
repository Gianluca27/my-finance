# 17 — Deudas en cuotas

**Esfuerzo:** M/L · **Dependencias:** spec 09 (recordatorios y historial de deudas) antes

## Contexto

`Debt` modela un total con pagos parciales libres y una única `dueDate` (`schema.prisma:217-237`). El caso argentino típico — "12 cuotas de $X" — no se puede representar: ni cronograma, ni número de cuota, ni vencimiento por cuota.

## Alcance

### 1. Modelo

- Prisma, campos opcionales en `Debt` (una deuda "simple" sigue funcionando igual con todos en null):
  - `installmentCount Int?` — cantidad de cuotas.
  - `installmentAmount Decimal?` — monto por cuota (si null y hay count: `totalAmount / count`).
  - `firstDueDate DateTime?` — vencimiento de la cuota 1; las siguientes son mensuales (+1 mes, mismo día con clamp fin de mes — reusar la lógica de `advanceDueDate` de `lib/dates.ts`).
- **El cronograma se deriva, no se persiste**: cuota k vence en `firstDueDate + (k−1) meses`. Cuotas pagadas = `floor(Σ pagos / installmentAmount)` (los pagos existentes por `debtId` ya dan la suma). Evita tabla nueva y mantiene el patrón todo-derivado de la app.

### 2. API

- `POST/PUT /api/debts` aceptan los 3 campos (zod: si viene uno de count/firstDueDate, exigir coherencia; `installmentAmount × count` no tiene que igualar exacto `totalAmount` — última cuota ajusta).
- El detalle (GET) devuelve `schedule`: lista derivada `[{ n, dueDate, amount, paid: boolean }]` y `nextInstallment`.
- Recordatorios (extiende spec 09): para deudas con cuotas, `dueDate` efectiva = vencimiento de la próxima cuota impaga; `lastRemindedFor` guarda esa fecha.

### 3. Web

- Alta/edición: toggle "En cuotas" que despliega count / monto por cuota (autocalculado, editable) / primer vencimiento.
- Card: "Cuota 5/12 · próxima {fecha} · {monto}", barra de progreso por cuotas pagadas además del monto.
- Botón "Pagar cuota": modal de pago precargado con `installmentAmount` (editable — adelantar capital sigue siendo un pago parcial normal).

## Cambios concretos

- `apps/api/prisma/schema.prisma` + migración.
- `apps/api/src/routes/debts.ts` — schema, schedule derivado, nextInstallment.
- `apps/api/src/jobs/reminders.ts` — dueDate efectiva por cuota.
- `packages/shared/src/types.ts` + `api.ts` — campos y `DebtSchedule`.
- `apps/web/src/pages/DebtsPage.tsx` — toggle, card, pagar cuota.

## Testing

Manual:
- Deuda $1200 en 12 cuotas desde el 10/8 → schedule con 12 vencimientos día 10; pagar 2 cuotas → "2/12", próxima = cuota 3.
- Pago parcial de $50 (menos que la cuota de $100) → cuotas pagadas no avanza hasta completar $100 acumulados.
- Primer vencimiento día 31 → meses cortos clampean (comportamiento de `advanceDueDate`).
- Deuda sin cuotas → todo el comportamiento actual intacto.
- Recordatorio llega por la próxima cuota, no por la última fecha global.

## Fuera de alcance

- Interés/tasa (CFT): las cuotas son del total informado; si hay interés, el usuario carga el total financiado.
- Frecuencias de cuota no mensuales.
- Refinanciación / recálculo de cronograma a mitad de camino (editar los campos regenera el schedule derivado — documentar el efecto).
