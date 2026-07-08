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

export type InvestmentType = 'ACCION' | 'ETF' | 'CEDEAR' | 'CRIPTO' | 'FCI' | 'PLAZO_FIJO' | 'BONO' | 'OTRO';
export type InvestmentOperationType = 'COMPRA' | 'VENTA';

export interface Investment {
  id: string;
  name: string;
  type: InvestmentType;
  /** Ticker o símbolo opcional (ej: AAPL, BTC). */
  symbol: string | null;
  /** Código de moneda del activo (ej: USD). Null = moneda base de la app. */
  currency: string | null;
  /** Precio unitario actual; null hasta la primera actualización. Manual, o
   * automático (cron diario) si el activo está vinculado a Twelve Data. */
  currentPrice: number | null;
  priceUpdatedAt: string | null;
  /** Símbolo en Twelve Data (ej: AAPL, BTC/USD). Null = activo manual.
   * Con valor, el precio es automático y se bloquea la carga manual. */
  providerSymbol: string | null;
  /** Bolsa del símbolo (ej: NASDAQ). Null para cripto o activos manuales. */
  providerExchange: string | null;
  color: string;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  /** Calculados del ledger de operaciones (no persistidos), en moneda del activo: */
  quantity: number;
  /** Costo promedio ponderado por unidad (las ventas no lo alteran). */
  avgCost: number;
  /** Costo de la tenencia actual: avgCost * quantity. */
  investedCost: number;
  /** quantity * (currentPrice ?? avgCost). */
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

export interface InvestmentsOverview {
  items: Investment[];
  rates: ExchangeRate[];
  summary: InvestmentsSummary;
  /** true si la API tiene configurada la integración con Twelve Data. */
  providerEnabled: boolean;
}

export interface InvestmentInput {
  name: string;
  type: InvestmentType;
  symbol?: string | null;
  currency?: string | null;
  color?: string;
  icon?: string | null;
  /** Símbolo de Twelve Data para precio automático (ej: AAPL, BTC/USD). */
  providerSymbol?: string | null;
  providerExchange?: string | null;
}

/** Resultado del buscador de símbolos de Twelve Data. */
export interface SymbolSearchResult {
  /** Símbolo con el que se piden precios (ej: AAPL, BTC/USD). */
  symbol: string;
  name: string;
  /** Bolsa (ej: NASDAQ). Null para cripto. */
  exchange: string | null;
  /** Moneda de cotización (ej: USD). */
  currency: string;
}

export interface SymbolSearchResponse {
  /** false si la API no tiene configurada la integración. */
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
