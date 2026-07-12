export type TransactionType = 'INCOME' | 'EXPENSE';
export type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type DebtDirection = 'I_OWE' | 'OWED_TO_ME';
export type AccountType = 'CASH' | 'BANK' | 'CARD' | 'OTHER';
/** Frecuencia del email de resumen periódico. Independiente de emailAlerts. */
export type DigestFrequency = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'BOTH';

export interface User {
  id: string;
  email: string;
  name: string;
  emailAlerts: boolean;
  pushAlerts: boolean;
  digestFrequency: DigestFrequency;
  /** Moneda en la que se consolidan los totales (código libre, ej: ARS, USD). */
  baseCurrency: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/** Respuesta genérica de los endpoints de contraseña (siempre 200, mensaje user-facing). */
export interface MessageResponse {
  message: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  type: TransactionType;
  createdAt: string;
  transactionCount: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Monto en la moneda de la cuenta (`accountId`). */
  amount: number;
  date: string;
  note: string | null;
  categoryId: string | null;
  category: Category | null;
  accountId: string;
  debtId: string | null;
  goalId: string | null;
  /** Solo pagos de deuda / aportes-retiros de meta cross-currency: monto que impactó en la
   * entidad vinculada, en la moneda de la deuda/meta, fijado al TC del día de la operación.
   * Null (o ausente en respuestas viejas) = la cuenta y la entidad comparten moneda. */
  entityAmount?: number | null;
  recurringId: string | null;
  /** MIME del recibo adjunto, o null si no tiene. Los bytes se sirven aparte. */
  receiptMime: string | null;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  /** INCOME (sueldo, alquiler cobrado) o EXPENSE (gasto fijo). */
  type: TransactionType;
  amount: number;
  frequency: Frequency;
  /** Día de vencimiento: 1-31 (mensual/anual) o 0-6 (semanal, 0 = domingo) */
  dueDay: number;
  /** Mes de vencimiento 1-12, solo para frecuencia anual */
  dueMonth: number | null;
  reminderDaysBefore: number;
  active: boolean;
  nextDueDate: string;
  categoryId: string | null;
  category: Category | null;
  createdAt: string;
}

export interface Budget {
  id: string;
  amount: number;
  /** Porcentaje (0-100) de uso que dispara la alerta */
  alertThreshold: number;
  /** Si acumula el sobrante (o el exceso) mes a mes en lugar de evaporarlo. */
  rollover: boolean;
  /** Null = presupuesto global (techo total del mes). Uno solo por usuario. */
  categoryId: string | null;
  /** Null en el presupuesto global. */
  category: Category | null;
  createdAt: string;
}

export interface BudgetStatus extends Budget {
  spent: number;
  /** Arrastre entrante del mes (0 sin rollover; negativo si el mes anterior se pasó). */
  carryOver: number;
  /** Límite efectivo del mes: amount + carryOver (== amount sin rollover). */
  effectiveLimit: number;
  /** Uso calculado sobre effectiveLimit. */
  percentUsed: number;
  month: string;
}

export interface Debt {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  description: string | null;
  totalAmount: number;
  /** Moneda de la deuda (código libre, ej: ARS, USD): totalAmount, installmentAmount y
   * remainingBalance están en esta moneda. Inmutable una vez que hay pagos registrados. */
  currency: string;
  /** Calculado: totalAmount - suma de pagos vinculados (los cross-currency cuentan por su
   * monto convertido al TC del día del pago). No se persiste. En la moneda de la deuda. */
  remainingBalance: number;
  /** Calculado: true si tiene pagos vinculados (la moneda ya no se puede cambiar). */
  hasPayments: boolean;
  /** Vencimiento opcional (ISO). Solo se usa la parte de fecha. */
  dueDate: string | null;
  /** Cantidad de cuotas (null = deuda simple sin cronograma). */
  installmentCount: number | null;
  /** Monto por cuota; null = totalAmount / installmentCount. La última cuota ajusta contra el total. */
  installmentAmount: number | null;
  /** Vencimiento de la cuota 1 (ISO); las siguientes son mensuales, mismo día con clamp a fin de mes. */
  firstDueDate: string | null;
  /** Derivado: cuotas completamente pagadas (floor(pagado / monto por cuota)). Null sin cuotas. */
  paidInstallments: number | null;
  /** Derivado: próxima cuota impaga. Null sin cuotas o con todas pagas. */
  nextInstallment: DebtScheduleItem | null;
  settledAt: string | null;
  categoryId: string | null;
  category: Category | null;
  createdAt: string;
}

/** Una cuota del cronograma derivado de una deuda en cuotas (no se persiste, se recalcula). */
export interface DebtScheduleItem {
  n: number;
  dueDate: string;
  amount: number;
  paid: boolean;
}

/** Cronograma derivado completo de una deuda en cuotas. */
export type DebtSchedule = DebtScheduleItem[];

export interface DebtDetail extends Debt {
  /** Pagos vinculados a esta deuda (transacciones con este debtId), orden desc por fecha. */
  payments: Transaction[];
  /** Cronograma derivado (null para deudas sin cuotas). Editar los campos de cuotas lo regenera. */
  schedule: DebtSchedule | null;
}

export type InvestmentType = 'ACCION' | 'ETF' | 'CEDEAR' | 'CRIPTO' | 'FCI' | 'PLAZO_FIJO' | 'BONO' | 'OTRO';
/** COMPRA/VENTA mueven la tenencia; RENTA (dividendo/cupón/amortización) es sólo un cobro. */
export type InvestmentOperationType = 'COMPRA' | 'VENTA' | 'RENTA';

/** Proveedor de precios automáticos de un activo vinculado. */
export type ProviderSource = 'TWELVE_DATA' | 'DATA912';

/** Mercado dentro de data912. Define de qué listado sale el precio y si hay histórico. */
export type ProviderMarket = 'stocks' | 'cedears' | 'bonds' | 'notes' | 'corp';

/** Tipos de activo con buscador de símbolos. El resto se carga a mano. */
export type SymbolSearchKind = 'ACCION' | 'ETF' | 'CRIPTO' | 'CEDEAR' | 'BONO';

export interface Investment {
  id: string;
  name: string;
  type: InvestmentType;
  /** Ticker o símbolo opcional (ej: AAPL, BTC). */
  symbol: string | null;
  /** Código de moneda del activo (ej: USD). Null = moneda base de la app. */
  currency: string | null;
  /** Precio unitario actual; null hasta la primera actualización. Manual, o
   * automático (cron diario) si el activo está vinculado a un proveedor. */
  currentPrice: number | null;
  priceUpdatedAt: string | null;
  /** Símbolo en el proveedor (ej: AAPL, BTC/USD, GGAL). Null = activo manual.
   * Con valor, el precio es automático y se bloquea la carga manual. */
  providerSymbol: string | null;
  /** Proveedor que mantiene el precio. Null en activos manuales. */
  providerSource: ProviderSource | null;
  /** Mercado dentro de data912. Null para Twelve Data y activos manuales. */
  providerMarket: ProviderMarket | null;
  /** Bolsa del símbolo (ej: NASDAQ, BYMA). Null para cripto o activos manuales. */
  providerExchange: string | null;
  /** Nominales que cubre un precio cotizado: 1, o 100 en renta fija.
   * `currentPrice` y `avgCost` están en precio cotizado; los importes se dividen por él. */
  priceFactor: number;
  color: string;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  /** Calculados del ledger de operaciones (no persistidos), en moneda del activo: */
  quantity: number;
  /** Costo promedio ponderado, en precio cotizado (comparable con `currentPrice`). */
  avgCost: number;
  /** Costo de la tenencia actual: avgCost * quantity / priceFactor. */
  investedCost: number;
  /** quantity * (currentPrice ?? avgCost) / priceFactor. */
  currentValue: number;
  /** currentValue - investedCost (no realizado). P&L de precio ("pnlPrice"). */
  pnl: number;
  pnlPercent: number;
  /** Renta cobrada acumulada (Σ RENTA): dividendos, cupones y amortizaciones.
   * Opcional: puede faltar en clientes/respuestas viejas. Default a tratar como 0. */
  incomeCollected?: number;
  /** Resultado total: pnl (precio) + incomeCollected (renta). Opcional (ver incomeCollected). */
  pnlTotal?: number;
  /** TIR anualizada (money-weighted) del activo, en %. Null si no converge o hay
   * poco historial (<2 flujos o <30 días). Opcional: no lo devuelven todos los endpoints. */
  tir?: number | null;
  operationCount: number;
}

export interface InvestmentOperation {
  id: string;
  type: InvestmentOperationType;
  /** COMPRA/VENTA: unidades operadas. RENTA: 0 (no mueve la tenencia). */
  quantity: number;
  /** COMPRA/VENTA: precio unitario. RENTA: monto total cobrado (efectivo real). */
  unitPrice: number;
  date: string;
  note: string | null;
  investmentId: string;
  createdAt: string;
}

/** Punto del histórico de precios (un snapshot por actualización manual). */
export interface InvestmentPricePoint {
  id: string;
  price: number;
  date: string;
}

export interface InvestmentDetail extends Investment {
  operations: InvestmentOperation[];
  priceHistory: InvestmentPricePoint[];
}

/** Cotización manual de una moneda extranjera en moneda base (por 1 unidad). */
export interface ExchangeRate {
  id: string;
  currency: string;
  rate: number;
  updatedAt: string;
}

/** Totales del portafolio en moneda base, convertidos al TC vigente. */
export interface InvestmentsSummary {
  totalInvested: number;
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  /** Monedas usadas por activos sin cotización cargada (excluidos de los totales). */
  missingRates: string[];
  /** TIR anualizada del portafolio (money-weighted), en %. Null si no converge.
   * Opcional: solo la calcula `GET /api/investments`, no el resumen del dashboard. */
  tir?: number | null;
}

/** Un punto de la curva de valor del portafolio (un día con snapshots). */
export interface PortfolioHistoryPoint {
  /** Día del punto (YYYY-MM-DD, UTC). */
  date: string;
  /** Valor total en moneda base: Σ tenencia × precio snapshot / priceFactor, al TC vigente. */
  value: number;
}

/**
 * Curva de valor del portafolio. El TC usado es el vigente (no hay historial de
 * cotizaciones), así que la conversión multi-moneda es aproximada hacia atrás.
 */
export interface PortfolioHistory {
  points: PortfolioHistoryPoint[];
  /** Costo invertido acumulado actual en moneda base: línea de referencia de la curva. */
  invested: number;
  /** Monedas sin cotización, excluidas de la curva (mismo criterio que el resumen). */
  missingRates: string[];
}

/** Resultado del refresh de precios on-demand. */
export interface RefreshPricesResult {
  /** Cantidad de activos con precio actualizado. */
  updated: number;
  /** Timestamp (ISO) del precio más reciente tras la corrida, para "Actualizado hace {x}". */
  lastUpdatedAt: string | null;
}

/** Qué proveedores de precio automático tiene configurados la API. */
export interface ProviderAvailability {
  /** Acciones/ETFs de EE.UU. y cripto. Requiere TWELVE_DATA_API_KEY. */
  twelveData: boolean;
  /** Mercado argentino y dólar MEP/CCL. Sin API key: activo salvo DATA912_ENABLED=false. */
  data912: boolean;
}

export interface InvestmentsOverview {
  items: Investment[];
  rates: ExchangeRate[];
  summary: InvestmentsSummary;
  providers: ProviderAvailability;
}

export interface InvestmentInput {
  name: string;
  type: InvestmentType;
  symbol?: string | null;
  currency?: string | null;
  color?: string;
  icon?: string | null;
  /** Símbolo del proveedor para precio automático (ej: AAPL, BTC/USD, AL30D). */
  providerSymbol?: string | null;
  /** Obligatorio junto con `providerSymbol`. */
  providerSource?: ProviderSource | null;
  /** Obligatorio cuando `providerSource` es DATA912. */
  providerMarket?: ProviderMarket | null;
  providerExchange?: string | null;
  /** Solo en activos manuales (1 o 100). En vinculados lo deriva el servidor del mercado. */
  priceFactor?: number;
}

/** Resultado del buscador de símbolos. */
export interface SymbolSearchResult {
  /** Símbolo con el que se piden precios (ej: AAPL, BTC/USD, AL30D). */
  symbol: string;
  /** Nombre del instrumento. data912 no publica nombres: cae al propio símbolo. */
  name: string;
  /** Bolsa (ej: NASDAQ, BYMA). Null para cripto. */
  exchange: string | null;
  /** Moneda sugerida para el formulario (ej: USD, ARS). Editable por el usuario. */
  currency: string;
  source: ProviderSource;
  market: ProviderMarket | null;
  /** Informativo: el servidor lo recalcula al vincular. */
  priceFactor: number;
}

export interface SymbolSearchResponse {
  /** false si ningún proveedor cubre ese tipo de activo. */
  enabled: boolean;
  items: SymbolSearchResult[];
}

/** Edición; `archived` mapea a archivedAt (patrón Account). */
export type InvestmentUpdateInput = Partial<InvestmentInput> & { archived?: boolean };

/** Compra o venta: cantidad de unidades × precio unitario. */
export interface InvestmentTradeInput {
  type: 'COMPRA' | 'VENTA';
  quantity: number;
  unitPrice: number;
  /** Default: ahora. */
  date?: string;
  note?: string | null;
}

/** Renta cobrada (dividendo/cupón/amortización): monto total, sin mover la tenencia. */
export interface InvestmentRentaInput {
  type: 'RENTA';
  /** Monto total cobrado (no por unidad). Debe ser > 0 y exige tenencia > 0 a esa fecha. */
  amount: number;
  /** Default: ahora. */
  date?: string;
  note?: string | null;
  /** Si true, además registra un INCOME en movimientos. Default: no (inversiones desacopladas del flujo de caja). */
  credit?: boolean;
  /** Cuenta destino del INCOME cuando credit=true. Default: cuenta por defecto del usuario. */
  accountId?: string | null;
}

export type InvestmentOperationInput = InvestmentTradeInput | InvestmentRentaInput;

/** Precio para una fecha pasada (autocompleta el formulario de compra/venta). */
export interface InvestmentPriceAtDate {
  price: number | null;
  /** Fecha real del dato encontrado (puede diferir de la pedida: fin de semana/feriado). */
  date: string | null;
  exact: boolean;
}

export interface ExchangeRateInput {
  currency: string;
  rate: number;
}

export interface CategorySummary {
  categoryId: string | null;
  categoryName: string;
  color: string;
  total: number;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  income: number;
  expense: number;
}

export interface PreviousMonthDelta {
  current: number;
  previous: number;
  deltaPercent: number;
}

export interface CategoryAnomaly {
  categoryId: string;
  name: string;
  currentAmount: number;
  avgAmount: number;
  percentOfAvg: number;
}

export interface DashboardInsights {
  /** Gasto acumulado del mes / días transcurridos * días del mes. `null` si falta historial. */
  projectedMonthTotal: number | null;
  /** Gasto alineado por día vs el mismo rango del mes anterior. `null` si no hay datos del mes anterior. */
  previousMonthComparison: {
    total: PreviousMonthDelta;
    byCategory: Array<PreviousMonthDelta & { categoryId: string; name: string }>;
  } | null;
  /** Categorías con gasto > 1.5x su promedio de los últimos 3 meses completos. */
  anomalies: CategoryAnomaly[];
}

export interface SafeToSpend {
  /** Balance total actual (base del cálculo), en moneda base. */
  balance: number;
  /** Gastos fijos activos aún por vencer antes de fin del mes seleccionado.
   * Los recurrentes no tienen moneda propia: se asumen en moneda base. */
  committedExpenses: number;
  /** balance - committedExpenses. Puede ser negativo si los compromisos superan el balance. */
  available: number;
}

/** Consolidación multi-moneda de los totales del dashboard (spec 19, fase A). */
export interface DashboardCurrency {
  /** Moneda base del usuario: balance, ingresos/gastos del mes, netWorthTrend y
   * safe-to-spend vienen consolidados en esta moneda. */
  baseCurrency: string;
  /** true si algún total incluyó conversión desde otra moneda (la UI muestra "≈"). */
  converted: boolean;
  /** Monedas de cuenta sin cotización cargada: sus montos quedan fuera de los
   * totales consolidados (patrón missingRates de Inversiones). */
  missingRates: string[];
  /** Desglose del balance total por moneda de cuenta (montos originales). */
  balanceByCurrency: CurrencyAmount[];
  /** Desglose de los ingresos del mes por moneda. */
  monthIncomeByCurrency: CurrencyAmount[];
  /** Desglose de los gastos del mes por moneda. */
  monthExpenseByCurrency: CurrencyAmount[];
}

export interface DebtsSummary {
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction I_OWE,
   * consolidada a la moneda base del usuario (spec 19, fase B). */
  totalIOwe: number;
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction OWED_TO_ME,
   * consolidada a la moneda base del usuario. */
  totalOwedToMe: number;
  /** Moneda base del usuario: los totales están expresados en ella. */
  baseCurrency: string;
  /** true si algún saldo entró convertido desde otra moneda (la UI muestra "≈"). */
  converted: boolean;
  /** Monedas de deuda sin cotización cargada, excluidas de los totales. */
  missingRates: string[];
  /** Desglose de "Debés" por moneda de deuda (montos originales). */
  iOweByCurrency: CurrencyAmount[];
  /** Desglose de "Te deben" por moneda de deuda (montos originales). */
  owedToMeByCurrency: CurrencyAmount[];
}

/** Patrimonio neto a fin de un mes "YYYY-MM" (saldos iniciales + ingresos - gastos
 * ± transferencias, acumulados por moneda y consolidados a moneda base al TC vigente). */
export interface NetWorthPoint {
  month: string;
  netWorth: number;
}

export interface DashboardData {
  /** Balance total (todas las cuentas), consolidado a moneda base. */
  balance: number;
  month: string;
  /** Ingresos del mes seleccionado, consolidados a moneda base. */
  monthIncome: number;
  /** Gastos del mes seleccionado, consolidados a moneda base. */
  monthExpense: number;
  /** Detalle multi-moneda de los totales consolidados. */
  currency: DashboardCurrency;
  /** Total de movimientos del mes (incluye aportes/retiros de metas, a diferencia de
   * monthIncome/monthExpense). Alimenta el footnote de Reportes sin pedir un listado aparte. */
  monthTransactionCount: number;
  /** Ahorro neto en metas del mes (aportes - retiros), consolidado a moneda base (fase B).
   * No está incluido en monthExpense/monthIncome: se muestra como línea propia ("Ahorro en
   * metas") para que la tasa de ahorro no lo cuente como gasto. */
  goalContributions: number;
  expensesByCategory: CategorySummary[];
  monthlyComparison: MonthlySummary[];
  netWorthTrend: NetWorthPoint[];
  upcomingPayments: RecurringExpense[];
  insights: DashboardInsights;
  debtsSummary: DebtsSummary;
  safeToSpend: SafeToSpend;
  investmentsSummary: InvestmentsSummary;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
  /** Texto libre: matchea nota (substring) o monto (exacto, si el texto parsea como número). */
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Params de `GET /api/reports/*`. El CSV usa from/to/type/categoryId/accountId (rango libre,
 * independiente del período mostrado en pantalla); el PDF usa solo `month`. */
export interface ReportFilters {
  from?: string;
  to?: string;
  month?: string;
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  date: string;
  note?: string | null;
  categoryId?: string | null;
  /** Cuenta destino. Si se omite, la API usa la cuenta por defecto. */
  accountId?: string | null;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  /** Moneda de la cuenta (código libre, ej: ARS, USD). Sus movimientos están en
   * esta moneda; inmutable una vez que la cuenta tiene movimientos. */
  currency: string;
  color: string;
  icon: string | null;
  isDefault: boolean;
  archivedAt: string | null;
  /** Calculado: inicial + ingresos - gastos + transferencias netas. En la moneda de la cuenta. */
  balance: number;
  /** Calculado: true si tiene transacciones o transferencias (la moneda ya no se puede cambiar). */
  hasMovements: boolean;
  createdAt: string;
}

/** Un monto en una moneda concreta (desgloses por moneda). */
export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/** Total consolidado a la moneda base del usuario, con desglose por moneda. */
export interface ConsolidatedTotal {
  /** Moneda base del usuario: `total` está expresado en ella. */
  baseCurrency: string;
  /** Total en moneda base. Excluye las monedas listadas en `missingRates`. */
  total: number;
  /** true si algún monto entró convertido desde otra moneda (la UI muestra "≈"). */
  converted: boolean;
  /** Desglose por moneda, en los montos originales de cada una. */
  byCurrency: CurrencyAmount[];
  /** Monedas sin cotización cargada, excluidas del total (patrón de Inversiones). */
  missingRates: string[];
}

/** Respuesta de `GET /api/accounts`: cuentas + patrimonio consolidado a moneda base. */
export interface AccountsOverview {
  items: Account[];
  /** Suma del saldo de todas las cuentas (incluidas archivadas), consolidada. */
  netWorth: ConsolidatedTotal;
}

export interface AccountInput {
  name: string;
  type?: AccountType;
  initialBalance?: number;
  /** Moneda de la cuenta. Default ARS. Solo editable mientras no tenga movimientos. */
  currency?: string;
  color?: string;
  icon?: string | null;
  isDefault?: boolean;
}

/** Edición; `archived` mapea a archivedAt (patrón Account/Investment). */
export type AccountUpdateInput = Partial<AccountInput> & { archived?: boolean };

export interface AccountReconcileInput {
  /** Saldo real informado por el usuario. */
  actualBalance: number;
  /** Fecha de la transacción de ajuste. Default: hoy. */
  date?: string;
}

export interface AccountReconcileResult {
  /** actualBalance − balance calculado, con signo. 0 si no hizo falta ajustar. */
  adjustment: number;
  newBalance: number;
}

export interface TransferAccountRef {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  type: AccountType;
  currency: string;
}

export interface Transfer {
  id: string;
  /** Monto que sale de la cuenta origen, en su moneda. */
  amount: number;
  /** Monto que entra en la cuenta destino, en su moneda. Igual a `amount` entre
   * cuentas de la misma moneda; si difieren, el par registra el TC implícito. */
  amountTo: number;
  date: string;
  note: string | null;
  fromAccountId: string;
  fromAccount: TransferAccountRef;
  toAccountId: string;
  toAccount: TransferAccountRef;
  createdAt: string;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** Monto que sale de la cuenta origen, en su moneda. */
  amount: number;
  /** Monto que entra en la cuenta destino. Obligatorio cuando las cuentas están
   * en monedas distintas; se ignora (== amount) cuando comparten moneda. */
  amountTo?: number;
  date?: string;
  note?: string | null;
}

export interface CategoryInput {
  name: string;
  color?: string;
  icon?: string | null;
  type: TransactionType;
}

export interface RecurringExpenseInput {
  name: string;
  /** Default EXPENSE si se omite. */
  type?: TransactionType;
  amount: number;
  frequency: Frequency;
  dueDay: number;
  dueMonth?: number | null;
  reminderDaysBefore?: number;
  active?: boolean;
  categoryId?: string | null;
}

/** Body opcional de POST /:id/pay. Todo opcional; sin body = comportamiento previo (monto y
 * categoría del recurrente, cuenta por defecto, fecha de hoy). Pagar con otro monto no
 * modifica el `amount` del recurrente. */
export interface RecurringPayInput {
  amount?: number;
  /** Cuenta donde se registra el movimiento. Default: cuenta por defecto del usuario. */
  accountId?: string | null;
  /** Fecha del movimiento (ISO o YYYY-MM-DD). Default: ahora. */
  date?: string;
}

export interface BudgetInput {
  /** Null = presupuesto global (techo total del mes). */
  categoryId: string | null;
  amount: number;
  alertThreshold?: number;
  /** Acumular el sobrante/exceso mes a mes. Default false. */
  rollover?: boolean;
}

export interface DebtInput {
  direction: DebtDirection;
  counterparty: string;
  description?: string | null;
  totalAmount: number;
  /** Moneda de la deuda. Default: la moneda base del usuario. Solo editable sin pagos. */
  currency?: string;
  categoryId?: string | null;
  /** Vencimiento opcional como `YYYY-MM-DD` o null. */
  dueDate?: string | null;
  /** Cuotas: si se envía, exige también `firstDueDate`. Null = deuda simple. */
  installmentCount?: number | null;
  /** Monto por cuota opcional; null = totalAmount / installmentCount (última cuota ajusta). */
  installmentAmount?: number | null;
  /** Vencimiento de la cuota 1 como `YYYY-MM-DD`. Requerido si hay `installmentCount`. */
  firstDueDate?: string | null;
}

/** Edición: no permite cambiar `direction` (ver spec de deudas). Editar los campos de
 * cuotas regenera el cronograma derivado (las cuotas pagadas se recalculan de los pagos). */
export type DebtUpdateInput = Partial<Omit<DebtInput, 'direction'>>;

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  /** Moneda de la meta (código libre, ej: ARS, USD): targetAmount, saved y remaining están
   * en esta moneda. Inmutable una vez que hay aportes o retiros registrados. */
  currency: string;
  targetDate: string | null;
  color: string;
  icon: string | null;
  achievedAt: string | null;
  /** Calculado: aportes menos retiros vinculados (los cross-currency cuentan por su monto
   * convertido al TC del día). No se persiste. En la moneda de la meta. */
  saved: number;
  /** Calculado: targetAmount - saved (mínimo 0). No se persiste. */
  remaining: number;
  /** Calculado: true si tiene aportes o retiros vinculados (la moneda ya no se puede cambiar). */
  hasMovements: boolean;
  createdAt: string;
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  /** Moneda de la meta. Default: la moneda base del usuario. Solo editable sin movimientos. */
  currency?: string;
  targetDate?: string | null;
  color?: string;
  icon?: string | null;
}

export type GoalUpdateInput = Partial<GoalInput>;

/** Body de POST /:id/withdrawals. `amount` está en la moneda de la cuenta destino; su
 * equivalente en la moneda de la meta no puede superar lo ahorrado (`saved`). */
export interface GoalWithdrawalInput {
  amount: number;
  /** Cuenta destino del retiro. Default: cuenta por defecto del usuario. */
  accountId?: string | null;
  note?: string | null;
}

export interface CategoryRule {
  id: string;
  /** Texto a buscar (substring, sin distinguir mayúsculas) en la nota del movimiento. */
  keyword: string;
  categoryId: string;
  category: Category;
  createdAt: string;
}

export interface CategoryRuleInput {
  keyword: string;
  categoryId: string;
}

export interface ImportResult {
  /** Filas insertadas correctamente. */
  imported: number;
  /** Filas ignoradas (vacías o encabezado). */
  skipped: number;
  /** Detalle de errores por fila (línea 1-indexada + motivo). Lista completa, sin límite. */
  errors: Array<{ line: number; reason: string }>;
}

/**
 * Respuesta de `POST /api/transactions/import?dryRun=true`: corre el mismo parseo/validación que
 * el import real pero sin escribir nada (ni transacciones ni categorías nuevas), para mostrar un
 * preview antes de confirmar.
 */
export interface ImportPreview {
  /** Filas de datos del archivo (válidas + con error). No cuenta encabezado ni líneas vacías. */
  total: number;
  /** Filas que se importarían si se confirma. */
  valid: number;
  /** Filas ignoradas (vacías o encabezado). */
  skipped: number;
  /** Detalle de errores por fila (línea 1-indexada + motivo). Lista completa, sin límite. */
  errors: Array<{ line: number; reason: string }>;
  /** Primeras 10 filas válidas, ya interpretadas. */
  sample: Array<{
    fecha: string;
    tipo: 'ingreso' | 'gasto';
    monto: number;
    /** Nombre de categoría resuelta, "se creará", "regla aplicada" o "Sin categoría". */
    categoria: string;
    nota: string;
  }>;
}

/** Body de POST /api/transactions/bulk. `categoryId` obligatorio para `setCategory`. */
export interface BulkTransactionsInput {
  /** Máximo 100. Todos deben pertenecer al usuario o la operación se rechaza completa. */
  ids: string[];
  action: 'delete' | 'setCategory';
  categoryId?: string | null;
}

export interface BulkTransactionsResult {
  /** Cantidad de movimientos afectados. */
  affected: number;
}

/** Body de POST /api/rules/apply. */
export interface RuleApplyInput {
  /** true: solo simula y devuelve el conteo, sin escribir. */
  dryRun?: boolean;
}

export interface RuleApplyResult {
  /** Movimientos categorizados (o que se categorizarían, si dryRun). */
  total: number;
  /** Desglose por regla aplicada. */
  byRule: Array<{ keyword: string; count: number }>;
}

export type SuggestionType = 'RECURRING' | 'RULE';
export type SuggestionStatus = 'PENDING' | 'ACCEPTED' | 'DISMISSED';

/** Patrón repetido detectado en el historial: propone crear un gasto/ingreso recurrente. */
export interface RecurringSuggestionPayload {
  name: string;
  type: TransactionType;
  /** Último monto observado (no promedio: sigue aumentos de precio). */
  amount: number;
  frequency: Frequency;
  dueDay: number;
  dueMonth: number | null;
  categoryId: string | null;
  /** Nombre de la categoría al momento de detectar (para mostrar sin otra consulta). */
  categoryName: string | null;
  occurrences: number;
  /** Fecha (ISO) de la última ocurrencia observada. */
  lastDate: string;
}

/** Keyword categorizado consistentemente: propone crear una regla de categorización. */
export interface RuleSuggestionPayload {
  keyword: string;
  categoryId: string;
  categoryName: string | null;
  occurrences: number;
}

interface SuggestionBase {
  id: string;
  status: SuggestionStatus;
  /** Clave estable del patrón; una sugerencia descartada no vuelve a aparecer. */
  fingerprint: string;
  createdAt: string;
}

export interface RecurringSuggestion extends SuggestionBase {
  type: 'RECURRING';
  payload: RecurringSuggestionPayload;
}

export interface RuleSuggestion extends SuggestionBase {
  type: 'RULE';
  payload: RuleSuggestionPayload;
}

export type Suggestion = RecurringSuggestion | RuleSuggestion;

export interface SuggestionsRefreshResult {
  /** Sugerencias nuevas creadas en esta corrida. */
  created: number;
  /** Todas las pendientes tras la corrida. */
  items: Suggestion[];
}

/** Ediciones opcionales al aceptar una sugerencia: pisan los valores detectados. */
export interface AcceptSuggestionInput {
  name?: string;
  amount?: number;
  frequency?: Frequency;
  dueDay?: number;
  dueMonth?: number | null;
  reminderDaysBefore?: number;
  categoryId?: string | null;
  keyword?: string;
}

/** Respuesta al aceptar: la entidad creada según el tipo de sugerencia. */
export interface AcceptSuggestionResult {
  suggestion: Suggestion;
  recurring?: RecurringExpense;
  rule?: CategoryRule;
}

/** Sugerencia de categoría para el formulario de transacción. */
export interface CategorySuggestion {
  categoryId: string;
  /** 'rule' si la decidió una regla del usuario, 'history' si el análisis del historial. */
  source: 'rule' | 'history';
  /** 0-1. Las reglas son deterministas: 1. */
  confidence: number;
}
