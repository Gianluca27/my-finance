import type {
  AcceptSuggestionInput,
  AcceptSuggestionResult,
  Account,
  AccountInput,
  AccountUpdateInput,
  AuthResponse,
  Budget,
  BudgetInput,
  BudgetStatus,
  Category,
  CategoryInput,
  CategoryRule,
  CategoryRuleInput,
  CategorySuggestion,
  ChangePasswordInput,
  DashboardData,
  Debt,
  DigestFrequency,
  DebtInput,
  DebtUpdateInput,
  ExchangeRate,
  ExchangeRateInput,
  ForgotPasswordInput,
  Goal,
  GoalInput,
  GoalUpdateInput,
  GoalWithdrawalInput,
  ImportResult,
  Investment,
  InvestmentDetail,
  InvestmentInput,
  InvestmentOperationInput,
  InvestmentPriceAtDate,
  InvestmentsOverview,
  InvestmentUpdateInput,
  MessageResponse,
  Paginated,
  RecurringExpense,
  RecurringExpenseInput,
  RecurringPayInput,
  ResetPasswordInput,
  Suggestion,
  SuggestionsRefreshResult,
  SymbolSearchKind,
  SymbolSearchResponse,
  Transaction,
  TransactionFilters,
  TransactionInput,
  TransactionType,
  Transfer,
  TransferInput,
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
  changePassword(input: ChangePasswordInput) {
    return this.request<MessageResponse>('POST', '/api/auth/change-password', input);
  }
  /** Siempre responde 200 con el mismo mensaje, exista o no el email — no filtra cuentas. */
  forgotPassword(input: ForgotPasswordInput) {
    return this.request<MessageResponse>('POST', '/api/auth/forgot-password', input);
  }
  resetPassword(input: ResetPasswordInput) {
    return this.request<MessageResponse>('POST', '/api/auth/reset-password', input);
  }
  updateAlertPreferences(input: {
    emailAlerts?: boolean;
    pushAlerts?: boolean;
    digestFrequency?: DigestFrequency;
    /** Nombre del perfil — mismo endpoint, ya soportado por la API. */
    name?: string;
  }) {
    return this.request<User>('PATCH', '/api/auth/me', input);
  }
  registerFcmToken(token: string, platform?: string) {
    return this.request<{ ok: true }>('POST', '/api/notifications/fcm-token', { token, platform });
  }

  // --- Cuentas ---
  listAccounts() {
    return this.request<Account[]>('GET', '/api/accounts');
  }
  createAccount(input: AccountInput) {
    return this.request<Account>('POST', '/api/accounts', input);
  }
  updateAccount(id: string, input: AccountUpdateInput) {
    return this.request<Account>('PUT', `/api/accounts/${id}`, input);
  }
  deleteAccount(id: string) {
    return this.request<void>('DELETE', `/api/accounts/${id}`);
  }

  // --- Transferencias entre cuentas ---
  listTransfers() {
    return this.request<Transfer[]>('GET', '/api/transfers');
  }
  createTransfer(input: TransferInput) {
    return this.request<Transfer>('POST', '/api/transfers', input);
  }
  deleteTransfer(id: string) {
    return this.request<void>('DELETE', `/api/transfers/${id}`);
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

  // --- Reglas de categorización automática ---
  listCategoryRules() {
    return this.request<CategoryRule[]>('GET', '/api/rules');
  }
  createCategoryRule(input: CategoryRuleInput) {
    return this.request<CategoryRule>('POST', '/api/rules', input);
  }
  deleteCategoryRule(id: string) {
    return this.request<void>('DELETE', `/api/rules/${id}`);
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
  /** Adjunta un recibo (imagen en base64, sin prefijo data:). */
  uploadReceipt(id: string, data: string, mime: string) {
    return this.request<{ receiptMime: string }>('POST', `/api/transactions/${id}/receipt`, { data, mime });
  }
  deleteReceipt(id: string) {
    return this.request<void>('DELETE', `/api/transactions/${id}/receipt`);
  }
  /** Descarga el recibo como Blob (para mostrar en <img> vía object URL). */
  async getReceipt(id: string): Promise<Blob> {
    const token = await this.opts.getToken();
    const res = await fetch(`${this.opts.baseUrl}/api/transactions/${id}/receipt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) this.opts.onUnauthorized?.();
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`);
    return res.blob();
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
  /** Registra el pago del período actual: crea la transacción (monto/cuenta/fecha indicados,
   * o los defaults del recurrente) y avanza el vencimiento. */
  payRecurring(id: string, body?: RecurringPayInput) {
    return this.request<{ transaction: Transaction; recurring: RecurringExpense }>(
      'POST',
      `/api/recurring/${id}/pay`,
      body,
    );
  }
  /** Salta el período actual sin registrar pago: solo avanza el vencimiento. */
  skipRecurring(id: string) {
    return this.request<RecurringExpense>('POST', `/api/recurring/${id}/skip`);
  }
  /** Últimos pagos vinculados a este recurrente (orden desc, máx. 24). El historial arranca
   * desde que existe el vínculo `recurringId`; pagos anteriores no aparecen acá. */
  listRecurringPayments(id: string) {
    return this.request<Transaction[]>('GET', `/api/recurring/${id}/payments`);
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

  // --- Metas de ahorro ---
  listGoals() {
    return this.request<Goal[]>('GET', '/api/goals');
  }
  createGoal(input: GoalInput) {
    return this.request<Goal>('POST', '/api/goals', input);
  }
  updateGoal(id: string, input: GoalUpdateInput) {
    return this.request<Goal>('PUT', `/api/goals/${id}`, input);
  }
  deleteGoal(id: string) {
    return this.request<void>('DELETE', `/api/goals/${id}`);
  }
  /** Registra un aporte: crea la Transaction (EXPENSE) vinculada y marca la meta como lograda al
   * alcanzar el objetivo. `accountId` es opcional (default: cuenta por defecto del usuario). */
  contributeGoal(id: string, amount: number, accountId?: string | null) {
    return this.request<{ transaction: Transaction; goal: Goal }>('POST', `/api/goals/${id}/contributions`, {
      amount,
      accountId,
    });
  }
  /** Registra un retiro: crea la Transaction (INCOME) vinculada. `amount` no puede superar `saved`. */
  withdrawFromGoal(id: string, input: GoalWithdrawalInput) {
    return this.request<{ transaction: Transaction; goal: Goal }>('POST', `/api/goals/${id}/withdrawals`, input);
  }

  // --- Inversiones ---
  /** Portafolio completo: activos con métricas calculadas, cotizaciones y totales en moneda base. */
  listInvestments() {
    return this.request<InvestmentsOverview>('GET', '/api/investments');
  }
  /** Detalle de un activo: operaciones + histórico de precios. */
  getInvestment(id: string) {
    return this.request<InvestmentDetail>('GET', `/api/investments/${id}`);
  }
  createInvestment(input: InvestmentInput) {
    return this.request<Investment>('POST', '/api/investments', input);
  }
  updateInvestment(id: string, input: InvestmentUpdateInput) {
    return this.request<Investment>('PUT', `/api/investments/${id}`, input);
  }
  /** Solo permitido sin operaciones registradas. */
  deleteInvestment(id: string) {
    return this.request<void>('DELETE', `/api/investments/${id}`);
  }
  /** Registra compra/venta. La venta no puede superar la tenencia. */
  addInvestmentOperation(id: string, input: InvestmentOperationInput) {
    return this.request<InvestmentDetail>('POST', `/api/investments/${id}/operations`, input);
  }
  deleteInvestmentOperation(id: string, operationId: string) {
    return this.request<InvestmentDetail>('DELETE', `/api/investments/${id}/operations/${operationId}`);
  }
  /** Precio para una fecha pasada, para autocompletar el formulario de compra/venta. */
  getInvestmentPriceAtDate(id: string, date: string) {
    const params = new URLSearchParams({ date });
    return this.request<InvestmentPriceAtDate>('GET', `/api/investments/${id}/price-at?${params.toString()}`);
  }
  /** Actualiza el precio manual y guarda un snapshot para el histórico.
   * Rechazado (400) si el activo está vinculado a un proveedor. */
  updateInvestmentPrice(id: string, price: number) {
    return this.request<Investment>('PATCH', `/api/investments/${id}/price`, { price });
  }
  /** Busca símbolos para vincular precio automático (Twelve Data y/o data912 según el tipo). */
  searchInvestmentSymbols(type: SymbolSearchKind, q: string) {
    const params = new URLSearchParams({ type, q });
    return this.request<SymbolSearchResponse>('GET', `/api/investments/symbols/search?${params.toString()}`);
  }
  upsertExchangeRate(input: ExchangeRateInput) {
    return this.request<ExchangeRate>('PUT', '/api/investments/rates', input);
  }
  deleteExchangeRate(currency: string) {
    return this.request<void>('DELETE', `/api/investments/rates/${encodeURIComponent(currency)}`);
  }

  // --- Sugerencias ---
  /** Sugerencia de categoría para una nota (regla del usuario o historial). Null si no hay señal. */
  suggestCategory(note: string, type: TransactionType) {
    const params = new URLSearchParams({ note, type });
    return this.request<CategorySuggestion | null>(
      'GET',
      `/api/transactions/suggest-category?${params.toString()}`,
    );
  }
  /** Sugerencias pendientes (recurrentes y reglas detectadas). */
  listSuggestions() {
    return this.request<Suggestion[]>('GET', '/api/suggestions');
  }
  /** Corre la detección sobre el historial y devuelve las pendientes actualizadas. */
  refreshSuggestions() {
    return this.request<SuggestionsRefreshResult>('POST', '/api/suggestions/refresh');
  }
  /** Acepta la sugerencia creando el recurrente o la regla; `edits` pisa campos del patrón detectado. */
  acceptSuggestion(id: string, edits?: AcceptSuggestionInput) {
    return this.request<AcceptSuggestionResult>('POST', `/api/suggestions/${id}/accept`, edits ?? {});
  }
  /** Descarta la sugerencia; el mismo patrón no se vuelve a sugerir. */
  dismissSuggestion(id: string) {
    return this.request<void>('POST', `/api/suggestions/${id}/dismiss`);
  }

  // --- Dashboard ---
  dashboard(month?: string) {
    return this.request<DashboardData>('GET', `/api/dashboard${month ? `?month=${month}` : ''}`);
  }

  // --- Importación ---
  /** Importa transacciones desde el CSV con el mismo formato que exporta la app. */
  importTransactions(csv: string, accountId?: string) {
    return this.request<ImportResult>('POST', '/api/transactions/import', { csv, accountId });
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
