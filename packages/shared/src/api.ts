import type {
  AuthResponse,
  Budget,
  BudgetInput,
  BudgetStatus,
  Category,
  CategoryInput,
  DashboardData,
  Debt,
  DebtInput,
  DebtUpdateInput,
  Paginated,
  RecurringExpense,
  RecurringExpenseInput,
  Transaction,
  TransactionFilters,
  TransactionInput,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Devuelve el token JWT actual (o null). Inyectable para web (localStorage) y móvil (AsyncStorage). */
  getToken: () => Promise<string | null> | string | null;
  onUnauthorized?: () => void;
}

export class ApiClient {
  private opts: ApiClientOptions;

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.opts.getToken();
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      this.opts.onUnauthorized?.();
    }
    if (!res.ok) {
      let message = `Error ${res.status}`;
      try {
        const data = await res.json();
        if (data && typeof data.error === 'string') message = data.error;
      } catch {
        // cuerpo no JSON
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // --- Auth ---
  register(input: { email: string; password: string; name: string }) {
    return this.request<AuthResponse>('POST', '/api/auth/register', input);
  }
  login(input: { email: string; password: string }) {
    return this.request<AuthResponse>('POST', '/api/auth/login', input);
  }
  me() {
    return this.request<User>('GET', '/api/auth/me');
  }
  updateAlertPreferences(input: { emailAlerts?: boolean; pushAlerts?: boolean }) {
    return this.request<User>('PATCH', '/api/auth/me', input);
  }
  registerFcmToken(token: string, platform?: string) {
    return this.request<{ ok: true }>('POST', '/api/notifications/fcm-token', { token, platform });
  }

  // --- Categorías ---
  listCategories() {
    return this.request<Category[]>('GET', '/api/categories');
  }
  createCategory(input: CategoryInput) {
    return this.request<Category>('POST', '/api/categories', input);
  }
  updateCategory(id: string, input: Partial<CategoryInput>) {
    return this.request<Category>('PUT', `/api/categories/${id}`, input);
  }
  deleteCategory(id: string) {
    return this.request<void>('DELETE', `/api/categories/${id}`);
  }

  // --- Transacciones ---
  listTransactions(filters: TransactionFilters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return this.request<Paginated<Transaction>>('GET', `/api/transactions${qs ? `?${qs}` : ''}`);
  }
  createTransaction(input: TransactionInput) {
    return this.request<Transaction>('POST', '/api/transactions', input);
  }
  updateTransaction(id: string, input: Partial<TransactionInput>) {
    return this.request<Transaction>('PUT', `/api/transactions/${id}`, input);
  }
  deleteTransaction(id: string) {
    return this.request<void>('DELETE', `/api/transactions/${id}`);
  }

  // --- Gastos recurrentes ---
  listRecurring() {
    return this.request<RecurringExpense[]>('GET', '/api/recurring');
  }
  createRecurring(input: RecurringExpenseInput) {
    return this.request<RecurringExpense>('POST', '/api/recurring', input);
  }
  updateRecurring(id: string, input: Partial<RecurringExpenseInput>) {
    return this.request<RecurringExpense>('PUT', `/api/recurring/${id}`, input);
  }
  deleteRecurring(id: string) {
    return this.request<void>('DELETE', `/api/recurring/${id}`);
  }
  /** Registra el pago del período actual: crea la transacción y avanza el vencimiento. */
  payRecurring(id: string) {
    return this.request<{ transaction: Transaction; recurring: RecurringExpense }>(
      'POST',
      `/api/recurring/${id}/pay`,
    );
  }

  // --- Presupuestos ---
  listBudgets(month?: string) {
    return this.request<BudgetStatus[]>('GET', `/api/budgets${month ? `?month=${month}` : ''}`);
  }
  upsertBudget(input: BudgetInput) {
    return this.request<Budget>('PUT', '/api/budgets', input);
  }
  deleteBudget(id: string) {
    return this.request<void>('DELETE', `/api/budgets/${id}`);
  }

  // --- Deudas ---
  listDebts() {
    return this.request<Debt[]>('GET', '/api/debts');
  }
  createDebt(input: DebtInput) {
    return this.request<Debt>('POST', '/api/debts', input);
  }
  updateDebt(id: string, input: DebtUpdateInput) {
    return this.request<Debt>('PUT', `/api/debts/${id}`, input);
  }
  deleteDebt(id: string) {
    return this.request<void>('DELETE', `/api/debts/${id}`);
  }
  /** Registra un pago parcial: crea la Transaction (EXPENSE o INCOME según dirección) vinculada. */
  payDebt(id: string, amount: number) {
    return this.request<{ transaction: Transaction; debt: Debt }>('POST', `/api/debts/${id}/payments`, {
      amount,
    });
  }

  // --- Dashboard ---
  dashboard(month?: string) {
    return this.request<DashboardData>('GET', `/api/dashboard${month ? `?month=${month}` : ''}`);
  }

  // --- Reportes ---
  reportUrl(kind: 'csv' | 'pdf', params: { from?: string; to?: string; month?: string } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    const qs = search.toString();
    const path = kind === 'csv' ? '/api/reports/transactions.csv' : '/api/reports/summary.pdf';
    return `${this.opts.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }
  async downloadReport(kind: 'csv' | 'pdf', params: { from?: string; to?: string; month?: string } = {}) {
    const token = await this.opts.getToken();
    const res = await fetch(this.reportUrl(kind, params), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`);
    return res.blob();
  }
}
