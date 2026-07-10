# 09 — Deudas: cuenta del pago, historial visible y recordatorios de vencimiento

**Esfuerzo:** S/M · **Dependencias:** ninguna

## Contexto

- Los pagos de deuda caen siempre en la cuenta default (`debts.ts:127`).
- Las transacciones con `debtId` existen pero la card solo muestra una barra de progreso — no hay historial visible (`DebtsPage.tsx:242-246`).
- `Debt.dueDate` existe pero solo pinta un badge: el job de recordatorios únicamente lee `RecurringExpense` (`reminders.ts`). Una deuda vence y nadie avisa.

## Alcance

### 1. Cuenta en pagos

`POST /api/debts/:id/payments` acepta `accountId?` (+ `date?` opcional, hoy tampoco se puede backdatear). Selector de cuenta en el modal de pago de `DebtsPage`.

### 2. Historial de pagos

- `GET /api/debts/:id` (o extender el GET list con include acotado) devuelve `payments`: transacciones con ese `debtId`, fecha + monto, desc.
- UI: expandir la card (o modal de detalle) con la lista de pagos. Con `remainingBalance` ya calculado, mostrar "pagaste X de Y en N pagos".

### 3. Recordatorios de vencimiento

- Prisma: `Debt.lastRemindedFor DateTime?` (mismo patrón anti-duplicado que `RecurringExpense.lastRemindedFor`). Migración.
- Extender `runRemindersJob` (`reminders.ts`): deudas activas (`settledAt: null`) con `dueDate` a ≤3 días (constante, como las ventanas del dashboard) y `lastRemindedFor ≠ dueDate` → notificación push/email vía `services/notifications.ts` ("Tu deuda con {counterparty} vence el {fecha}, restan {remainingBalance}"), marcar `lastRemindedFor`.
- Direcciones: para `I_OWE` avisa que hay que pagar; para `OWED_TO_ME` avisa que vence lo que te deben (cobrar).

## Cambios concretos

- `apps/api/prisma/schema.prisma` + migración (`lastRemindedFor`).
- `apps/api/src/routes/debts.ts` — `accountId`/`date` en payments, detalle con historial.
- `apps/api/src/jobs/reminders.ts` — bloque de deudas con su propio try/catch (patrón de `runPricesJob`: un fallo no tumba los recordatorios de recurrentes).
- `packages/shared/src/types.ts` + `api.ts` — payload de pago, `DebtDetail`.
- `apps/web/src/pages/DebtsPage.tsx` — selector de cuenta, fecha opcional, historial.

## Testing

Manual:
- Pagar eligiendo cuenta → balance correcto en esa cuenta; pago sin cuenta → default (compatibilidad).
- Historial lista los pagos; borrar la deuda → transacciones quedan (SetNull, comportamiento actual).
- Deuda con vencimiento en 2 días → correr `runRemindersJob` a mano (`POST /api/notifications/run-reminders` ya existe) → llega notificación una sola vez; segunda corrida no duplica.
- Deuda saldada o sin `dueDate` → sin recordatorio.

## Fuera de alcance

- Cuotas/cronograma (spec 17).
- Interés/tasa.
- `reminderDaysBefore` configurable por deuda (se usa constante global; configurable puede venir con cuotas).
