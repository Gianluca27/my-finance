# 07 — Pago flexible de recurrentes e historial

**Esfuerzo:** M · **Dependencias:** ninguna · **Nota:** cuanto antes se implemente, menos datos "sucios" acumulados

## Contexto

`POST /api/recurring/:id/pay` (`recurring.ts:119-159`) es rígido:

- Usa siempre `existing.amount` (`:133`) — servicios variables (luz, gas) quedan mal registrados todos los meses.
- Carga el pago en la cuenta default (`getDefaultAccountId`, `:128`), sin elección.
- No hay "saltar este período": el job de reminders avanza fechas vencidas silenciosamente (`reminders.ts:19-28`) — no se distingue "no pagué" de "no aplicaba".
- Los pagos son transacciones sueltas identificables solo por la nota; no hay vínculo ni historial (a diferencia de deudas/metas, que ya tienen `debtId`/`goalId` en `Transaction`).

## Alcance

### 1. Vínculo `Transaction.recurringId`

Prisma: `recurringId String?` + relación a `RecurringExpense` con `onDelete: SetNull` (mismo patrón que `debtId`, `schema.prisma:145-146`). Migración.

### 2. `POST /:id/pay` con body opcional

`{ amount?, accountId?, date? }` (zod, todos opcionales; defaults = comportamiento actual). Validar `accountId` propio (patrón `resolveAccountId`). La transacción creada lleva `recurringId`. Pagar con otro monto **no** modifica `amount` del recurrente. La alerta de presupuesto (`recurring.ts:152-156`) usa el monto real pagado.

### 3. `POST /:id/skip`

Avanza `nextDueDate` con `advanceDueDate` sin crear transacción. Devuelve el recurrente actualizado.

### 4. Historial por recurrente

`GET /api/recurring/:id/payments` — transacciones con ese `recurringId`, orden desc, límite 24. (Los pagos previos a esta migración no tienen vínculo; el historial arranca desde ahora — documentarlo en la UI si hace falta.)

### 5. Web

- Botón "Pagar" abre mini-modal: monto precargado (editable), selector de cuenta (default preseleccionada), fecha (hoy). Confirmar ejecuta el pay.
- Botón secundario "Saltar" con confirm ("Avanza el vencimiento al {fecha} sin registrar pago").
- En la card (o modal de detalle): últimos pagos con fecha y monto + promedio de los últimos 6 — útil para ver la evolución de una tarifa.

## Cambios concretos

- `apps/api/prisma/schema.prisma` + migración.
- `apps/api/src/routes/recurring.ts` — body en pay, endpoint skip, endpoint payments.
- `packages/shared/src/types.ts` + `api.ts` — `payRecurring(id, body?)`, `skipRecurring(id)`, `listRecurringPayments(id)`.
- `apps/web/src/pages/RecurringPage.tsx` — modal de pago, skip, historial.

## Testing

Manual:
- Pagar con monto distinto → transacción con ese monto, `amount` del recurrente intacto, `nextDueDate` avanzado.
- Pagar eligiendo otra cuenta → balance de esa cuenta baja (verificar en Cuentas).
- Skip → sin transacción nueva, fecha avanzada, sin recordatorio duplicado (`lastRemindedFor` coherente).
- Recurrente INCOME ("Cobrar") → mismo flujo con signo correcto.
- Borrar el recurrente → sus pagos históricos quedan (`SetNull`), sin error.

## Fuera de alcance

- Frecuencias nuevas (quincenal, cuotas con fin) — anotado como mejora futura.
- Auto-pago (pagar automáticamente al vencer).
- Registro de skips como auditoría persistente.
