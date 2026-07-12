# 20 — Tarjetas de crédito (exploratorio) ✅ fase 1 implementada

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

## Diseño resuelto al implementar (fase 1)

Respuestas a las preguntas abiertas, con las inclinaciones de la spec confirmadas:

1. **Cuotas de tarjeta → fase 2 propia.** No se integra con spec 17 en esta fase; un consumo
   en cuotas hoy se registra como N gastos (o uno por el total) a criterio del usuario.
2. **Pago mínimo/parcial = transferencia libre, sin modelar interés.** Cualquier monto
   transferido a la tarjeta cancela deuda; el saldo remanente queda como deuda sin recargo.
3. **Multi-tarjeta: alcanza con `closingDay`/`paymentDay`/`creditLimit` por cuenta.** Cada
   plástico es una cuenta CARD con su propio ciclo; no hizo falta entidad nueva.
4. **Resumen bimonetario = dos cuentas CARD hermanas, una por moneda** (ej: "Visa ARS" y
   "Visa USD"). Spec 19 lo hace natural: la moneda vive en la cuenta y cada pata del resumen
   se paga con su propia transferencia (cross-currency vía `amount`/`amountTo` si el pago
   sale de una cuenta en otra moneda). No hay vínculo persistido entre las hermanas.

Decisiones de modelado:

- **Columnas nuevas en `Account`, todas opcionales** (`creditLimit Decimal?`, `closingDay Int?`,
  `paymentDay Int?` + gates `cardLastRemindedFor`/`cardLastAlertCycle`): una cuenta CARD con
  todo en null conserva exactamente el comportamiento previo. La API rechaza estos campos en
  cuentas no-CARD (y los limpia si una CARD cambia de tipo); `paymentDay` exige `closingDay`.
- **Ciclo derivado, nunca persistido** (`apps/api/src/lib/cards.ts`, con tests Vitest): el
  resumen que cierra el día C incluye las transacciones en (cierre anterior, C] — el día del
  cierre entra al ciclo que cierra; el clamp de fin de mes replica `advanceDueDate` (día 31 →
  30/28, sin huecos ni superposiciones alrededor de febrero). El vencimiento cae en el mes del
  cierre si `paymentDay > closingDay`, si no en el mes siguiente (comparando contra el
  `closingDay` configurado, no el día clampeado); si el clamp de un mes corto hiciera coincidir
  vencimiento y cierre (ej: cierre 30 / vencimiento 31 en abril), el pago se corre al día
  siguiente del cierre — el pago es siempre posterior al cierre.
- **La deuda es el saldo negativo de la cuenta** — no hay campo "deuda". Los consumos siguen
  siendo `Transaction` EXPENSE comunes (presupuestos/categorías intactos), así que el balance
  calculado se vuelve negativo solo. El dashboard y el patrimonio neto ya restaban ese saldo
  por moneda (spec 19 fase A): no hizo falta tocar signos. Deuda preexistente al crear la
  cuenta = `initialBalance` negativo. Disponible = `creditLimit + saldo` (saldo a favor suma).
- **`GET /api/accounts` expone `card: CardSummary | null` por item** (consumo del ciclo,
  disponible, próximos cierre/vencimiento y último ciclo cerrado con su total), vía
  `serialize()`. Sin endpoint nuevo: el listado ya era la fuente de las cards de la UI.
- **"Pagar resumen" = prellenado client-side de la transferencia existente** (cuenta banco →
  tarjeta, monto = total del último ciclo cerrado, nota "Pago resumen {tarjeta}"); no hay
  endpoint de atajo. Cross-currency: se precarga `amountTo` (moneda de la tarjeta) y el
  usuario completa cuánto sale de la cuenta origen.
- **Recordatorio de vencimiento en el job diario de reminders** (bloque aislado, patrón spec
  09/17): ventana fija de 3 días, dedupe por `cardLastRemindedFor` (fecha de vencimiento ya
  avisada). Solo avisa si el resumen cerrado tiene total > 0; si venció sin pago no insiste
  (el próximo cierre rearma el aviso).
- **Alerta de límite** (patrón `budgetAlerts`, inline al registrar gastos — también pagos de
  recurrentes/deudas hechos con la tarjeta): consumo del ciclo ≥ 80% de `creditLimit` (umbral
  fijo, mismo default que `Budget.alertThreshold`), máximo una vez por ciclo
  (`cardLastAlertCycle` = cierre YYYY-MM-DD, análogo a `lastAlertMonth`). Sin conversión de
  moneda: consumo y límite están ambos en la moneda de la cuenta.
- **Drill-down del ciclo** reusa los filtros por URL del listado (spec 05/11):
  `/transacciones?accountId=…&from=…&to=…` con los límites del ciclo. El filtro `to` es
  inclusivo a nivel día (cubre las horas intra-día que generan los movimientos creados por el
  server), así el listado muestra exactamente las filas que suma el total del resumen.

### Deuda registrada al implementar (fase 1)

- **Mobile sin paridad de tarjetas (spec 18):** compila y opera sin cambios — los campos
  nuevos de `Account` (`creditLimit`/`closingDay`/`paymentDay`/`card`) son aditivos y los
  ignora. No muestra ciclo/disponible/cierre/vencimiento en las cards de cuenta, su
  formulario de cuenta no ofrece los campos de tarjeta (las CARD creadas desde mobile quedan
  sin semántica de ciclo hasta editarlas en web) y no tiene atajo "Pagar resumen". Los
  recordatorios de vencimiento y la alerta de límite sí llegan (push/email, server-side).
