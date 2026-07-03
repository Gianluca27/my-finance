export type TransactionType = 'INCOME' | 'EXPENSE';
export type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type DebtDirection = 'I_OWE' | 'OWED_TO_ME';

export interface User {
  id: string;
  email: string;
  name: string;
  emailAlerts: boolean;
  pushAlerts: boolean;
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
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  note: string | null;
  categoryId: string | null;
  category: Category | null;
  debtId: string | null;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
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
  settledAt: string | null;
  categoryId: string | null;
  category: Category | null;
  createdAt: string;
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

export interface DebtsSummary {
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction I_OWE. */
  totalIOwe: number;
  /** Suma de remainingBalance de deudas activas (no saldadas) con direction OWED_TO_ME. */
  totalOwedToMe: number;
}

export interface DashboardData {
  balance: number;
  month: string;
  monthIncome: number;
  monthExpense: number;
  expensesByCategory: CategorySummary[];
  monthlyComparison: MonthlySummary[];
  upcomingPayments: RecurringExpense[];
  insights: DashboardInsights;
  debtsSummary: DebtsSummary;
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
}

export interface CategoryInput {
  name: string;
  color?: string;
  icon?: string | null;
  type: TransactionType;
}

export interface RecurringExpenseInput {
  name: string;
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
}

/** Edición: no permite cambiar `direction` (ver spec de deudas). */
export type DebtUpdateInput = Partial<Omit<DebtInput, 'direction'>>;
