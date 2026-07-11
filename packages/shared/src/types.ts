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
  amount: number;
  date: string;
  note: string | null;
  categoryId: string | null;
  category: Category | null;
  accountId: string;
  debtId: string | null;
  goalId: string | null;
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
  categoryId: string;
  category: Category;
  createdAt: string;
}

export interface BudgetStatus extends Budget {
  spent: number;
  percentUsed: number;
  month: string;
}

export interface Debt {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  description: string | null;
  totalAmount: number;
  /** Calculado: totalAmount - suma de pagos vinculados. No se persiste. */
  remainingBalance: number;
  /** Vencimiento opcional (ISO). Solo se usa la parte de fecha. */
  dueDate: string | null;
  settledAt: string | null;
  categoryId: string | null;
  category: Category | null;
  createdAt: string;
}

export interface DebtDetail extends Debt {
  /** Pagos vinculados a esta deuda (transacciones con este debtId), orden desc por fecha. */
  payments: Transaction[];
}

export type InvestmentType = 'ACCION' | 'ETF' | 'CEDEAR' | 'CRIPTO' | 'FCI' | 'PLAZO_FIJO' | 'BONO' | 'OTRO';
export type InvestmentOperationType = 'COMPRA' | 'VENTA';

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
  /** currentValue - investedCost (no realizado). */
  pnl: number;
  pnlPercent: number;
  operationCount: number;
}

export interface InvestmentOperation {
  id: string;
  type: InvestmentOperationType;
  quantity: number;
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

export interface InvestmentOperationInput {
  type: InvestmentOperationType;
  quantity: number;
  unitPrice: number;
  /** Default: ahora. */
  date?: string;
  note?: string | null;
}

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
  /** Balance total actual (base del cálculo). */
  balance: number;
  /** Gastos fijos activos aún por vencer antes de fin del mes seleccionado. */
  committedExpenses: number;
  /** balance - committedExpenses. Puede ser negativo si los compromisos superan el balance. */
  available: number;
}

export interface DebtsSummary {
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction I_OWE. */
  totalIOwe: number;
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction OWED_TO_ME. */
  totalOwedToMe: number;
}

/** Patrimonio neto a fin de un mes "YYYY-MM" (saldos iniciales + ingresos - gastos acumulados). */
export interface NetWorthPoint {
  month: string;
  netWorth: number;
}

export interface DashboardData {
  balance: number;
  month: string;
  monthIncome: number;
  monthExpense: number;
  /** Ahorro neto en metas del mes (aportes - retiros). No está incluido en monthExpense/monthIncome:
   * se muestra como línea propia ("Ahorro en metas") para que la tasa de ahorro no lo cuente como gasto. */
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
  color: string;
  icon: string | null;
  isDefault: boolean;
  archivedAt: string | null;
  /** Calculado: inicial + ingresos - gastos + transferencias netas. No se persiste. */
  balance: number;
  createdAt: string;
}

export interface AccountInput {
  name: string;
  type?: AccountType;
  initialBalance?: number;
  color?: string;
  icon?: string | null;
  isDefault?: boolean;
}

export type AccountUpdateInput = Partial<AccountInput>;

export interface TransferAccountRef {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  type: AccountType;
}

export interface Transfer {
  id: string;
  amount: number;
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
  amount: number;
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
  categoryId: string;
  amount: number;
  alertThreshold?: number;
}

export interface DebtInput {
  direction: DebtDirection;
  counterparty: string;
  description?: string | null;
  totalAmount: number;
  categoryId?: string | null;
  /** Vencimiento opcional como `YYYY-MM-DD` o null. */
  dueDate?: string | null;
}

/** Edición: no permite cambiar `direction` (ver spec de deudas). */
export type DebtUpdateInput = Partial<Omit<DebtInput, 'direction'>>;

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  color: string;
  icon: string | null;
  achievedAt: string | null;
  /** Calculado: suma de los aportes vinculados. No se persiste. */
  saved: number;
  /** Calculado: targetAmount - saved (mínimo 0). No se persiste. */
  remaining: number;
  createdAt: string;
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  targetDate?: string | null;
  color?: string;
  icon?: string | null;
}

export type GoalUpdateInput = Partial<GoalInput>;

/** Body de POST /:id/withdrawals. `amount` no puede superar lo ahorrado (`saved`). */
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
  /** Filas ignoradas (vacías, encabezado, formato inválido). */
  skipped: number;
  /** Detalle de errores por fila (línea 1-indexada + motivo), acotado. */
  errors: Array<{ line: number; reason: string }>;
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
