# 20 — Tarjetas de crédito (exploratorio)

**Esfuerzo:** L · **Dependencias:** spec 19 (multi-moneda) idealmente antes — los resúmenes de tarjeta argentinos mezclan ARS y USD. Requiere spec 12 (reconciliación) como práctica previa de ajustes.

> Spec a nivel de concepto: antes de implementar conviene una pasada de diseño fina (brainstorming) — es el feature con más decisiones de modelado del roadmap.

## Contexto

`Account.type = CARD` existe pero sin semántica (`schema.prisma:28-33`): una tarjeta hoy es una cuenta más con balance corriente. La realidad de una tarjeta de crédito: consumos que se acumulan en un **ciclo** (cierre), un **resumen** con vencimiento, y un pago que sale de otra cuenta. Sin esto, los usuarios de tarjeta (mayoría) registran mal o no registran.

## Modelo propuesto (a validar en diseño)

- Campos opcionales en `Account`, solo con sentido para CARD: `creditLimit Decimal?`, `closingDay Int?` (día de cierre), `paymentDay Int?` (día de vencimiento).
- **Los consumos siguen siendo `Transaction` EXPENSE normales** sobre la cuenta CARD — cero cambio en el flujo de carga, presupuestos y categorías siguen funcionando.
- El **balance de una CARD es deuda**, no activo: en balance total del dashboard resta (ya resta hoy por ser gastos; verificar signo del `initialBalance`).
- **Ciclo derivado, no persistido** (consistente con el patrón de la app): el resumen del ciclo N = transacciones entre cierre N−1 y cierre N (clamp fin de mes como `advanceDueDate`).
- **Pagar el resumen = transferencia** cuenta bancaria → tarjeta (mecanismo existente), que cancela el saldo del ciclo.

## Funcionalidad visible

- Card de cuenta CARD muestra: consumido del ciclo actual, disponible (`creditLimit − saldo`), fecha de cierre y vencimiento próximos.
- Vista de ciclo: "Resumen al {cierre}: {total}" con sus transacciones (drill-down al listado filtrado por cuenta+rango — reusa spec 05/11).
- Recordatorio de vencimiento del resumen (reusa el job de reminders, patrón de spec 09).
- "Pagar resumen": atajo que precarga la transferencia por el total del ciclo cerrado.
- Alerta opcional de límite: consumo del ciclo ≥ X% de `creditLimit` (mismo patrón `budgetAlerts`).

## Preguntas abiertas para la pasada de diseño

1. Cuotas de tarjeta (consumo en 12 cuotas dentro del resumen) — ¿se integra con spec 17 o es fase 2 propia? (Inclinación: fase 2; es el 80% de la complejidad real.)
2. Pago mínimo / pago parcial del resumen con interés — ¿se modela o se deja como transferencia libre? (Inclinación: transferencia libre, sin interés.)
3. ¿Multi-tarjeta con cierre distinto por tarjeta alcanza con `closingDay` por cuenta? (Sí a priori.)
4. Resumen bimonetario (ARS + USD del mismo plástico) — depende de spec 19; posiblemente dos cuentas CARD hermanadas.

## Testing (esbozo)

- Ciclo con cierre día 28: consumos del 29 en adelante caen al ciclo siguiente.
- Pagar resumen → saldo del ciclo en 0, balance bancario baja, dashboard cuadra.
- Límite $500k, consumido $400k → disponible $100k; alerta al umbral.

## Fuera de alcance (fase 1)

- Cuotas de tarjeta, interés y pago mínimo.
- Importación de resúmenes (PDF/CSV del banco).
- Débitos automáticos contra la tarjeta.
