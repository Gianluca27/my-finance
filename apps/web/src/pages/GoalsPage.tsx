import type { Account, AccountsOverview, ExchangeRate, Goal } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { useAuth } from '../auth';
import { invalidate, useCached } from '../cache';
import { IcoPencil, IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';
import { crossRate, floor2, rateLabel } from '../lib/currency';

const COLOR_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];

/** Monedas first-class en la UI. El modelo acepta cualquier código (free-string). */
const CURRENCY_OPTIONS = ['ARS', 'USD'];

function pace(goal: Goal): string | null {
  if (!goal.targetDate || goal.remaining <= 0) return null;
  const msLeft = new Date(goal.targetDate).getTime() - Date.now();
  if (msLeft <= 0) return 'Fecha objetivo cumplida';
  const monthsLeft = Math.max(1, Math.ceil(msLeft / (30 * 86_400_000)));
  return `Ahorrá ${formatMoney(goal.remaining / monthsLeft, goal.currency)}/mes para llegar a tiempo`;
}

export function GoalsPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showAchieved, setShowAchieved] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [targetDate, setTargetDate] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [contribGoal, setContribGoal] = useState<Goal | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribAccountId, setContribAccountId] = useState('');
  const [contribBusy, setContribBusy] = useState(false);

  const [withdrawGoal, setWithdrawGoal] = useState<Goal | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAccountId, setWithdrawAccountId] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const { data: goals, error: loadError, refresh } = useCached<Goal[]>('goals', () => api.listGoals());
  const { data: accountsData } = useCached<AccountsOverview>('accounts', () => api.listAccounts());
  // Las archivadas no se ofrecen para aportes ni retiros nuevos.
  const accounts = (accountsData?.items ?? []).filter((a) => !a.archivedAt);
  // Cotizaciones vigentes: previsualizan la conversión de aportes/retiros cross-currency
  // (el servidor convierte con las mismas reglas al confirmar).
  const { data: ratesData } = useCached<ExchangeRate[]>('rates', () => api.listExchangeRates());
  const rates = ratesData ?? [];

  // La moneda es inmutable con aportes/retiros registrados (regla de la API, espejo de cuentas).
  const editingGoal = editingId ? (goals ?? []).find((g) => g.id === editingId) : undefined;
  const currencyLocked = editingGoal?.hasMovements ?? false;

  function invalidateAfterMutation() {
    invalidate('goals');
    invalidate('transactions');
    invalidate('dashboard');
    // Aportes y retiros mueven el balance de la cuenta elegida.
    invalidate('accounts');
    refresh();
  }

  function openCreate() {
    setEditingId(null);
    setName('');
    setTargetAmount('');
    // Default de moneda: la base del usuario (spec 19 fase B).
    setCurrency(user?.baseCurrency ?? 'ARS');
    setTargetDate('');
    setIcon('');
    setColor(COLOR_PALETTE[0]);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(goal: Goal) {
    setEditingId(goal.id);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setCurrency(goal.currency ?? 'ARS');
    setTargetDate(goal.targetDate ? goal.targetDate.slice(0, 10) : '');
    setIcon(goal.icon ?? '');
    setColor(goal.color);
    setError(null);
    setFormOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name,
        targetAmount: Number(targetAmount),
        currency,
        targetDate: targetDate || null,
        icon: icon || null,
        color,
      };
      if (editingId) {
        await api.updateGoal(editingId, payload);
      } else {
        await api.createGoal(payload);
      }
      setFormOpen(false);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  /** Prellenado de aportes/retiros en la MONEDA DE LA CUENTA elegida: cross-currency se
   * convierte con piso a centavos (el reconvertido del servidor no supera el objetivo/ahorro);
   * sin cotización queda vacío. */
  function accountPrefill(target: number, goalCurrency: string, account: Account | undefined): string {
    if (target <= 0) return '';
    if (!account || account.currency === goalCurrency) return String(target);
    const rate = crossRate(goalCurrency, account.currency, rates);
    return rate === null ? '' : String(floor2(target * rate));
  }

  function onStartContrib(goal: Goal) {
    const account = accounts.find((a) => a.isDefault) ?? accounts[0];
    setContribGoal(goal);
    setContribAmount(accountPrefill(goal.remaining, goal.currency ?? 'ARS', account));
    setContribAccountId(account?.id ?? '');
    setError(null);
  }

  function onCloseContrib() {
    if (contribBusy) return;
    setContribGoal(null);
  }

  async function onConfirmContrib(e: FormEvent) {
    e.preventDefault();
    if (!contribGoal) return;
    setError(null);
    setContribBusy(true);
    try {
      await api.contributeGoal(contribGoal.id, Number(contribAmount), contribAccountId || undefined);
      setContribGoal(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setContribBusy(false);
    }
  }

  function onStartWithdraw(goal: Goal) {
    const account = accounts.find((a) => a.isDefault) ?? accounts[0];
    setWithdrawGoal(goal);
    setWithdrawAmount(accountPrefill(goal.saved, goal.currency ?? 'ARS', account));
    setWithdrawAccountId(account?.id ?? '');
    setWithdrawNote('');
    setError(null);
  }

  function onCloseWithdraw() {
    if (withdrawBusy) return;
    setWithdrawGoal(null);
  }

  async function onConfirmWithdraw(e: FormEvent) {
    e.preventDefault();
    if (!withdrawGoal) return;
    setError(null);
    setWithdrawBusy(true);
    try {
      await api.withdrawFromGoal(withdrawGoal.id, {
        amount: Number(withdrawAmount),
        accountId: withdrawAccountId || undefined,
        note: withdrawNote || undefined,
      });
      setWithdrawGoal(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setWithdrawBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar esta meta? Los aportes ya registrados quedan como movimientos sueltos.')) return;
    try {
      await api.deleteGoal(id);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const activeGoals = (goals ?? []).filter((g) => !g.achievedAt);
  const achievedGoals = (goals ?? []).filter((g) => g.achievedAt);
  // Totales por moneda de meta, sin convertir (los nominales de cada moneda no se mezclan).
  const sumByCurrency = (pick: (g: Goal) => number) => {
    const map = new Map<string, number>();
    for (const g of activeGoals) {
      const c = g.currency ?? 'ARS';
      map.set(c, (map.get(c) ?? 0) + pick(g));
    }
    return map;
  };
  const targetByCurrency = sumByCurrency((g) => g.targetAmount);
  const savedByCurrency = sumByCurrency((g) => g.saved);
  const multiCurrency = targetByCurrency.size > 1;
  const moneyList = (map: Map<string, number>) =>
    map.size === 0 ? formatMoney(0) : Array.from(map, ([c, v]) => formatMoney(v, c)).join(' + ');
  // Progreso general: con una sola moneda es el clásico ahorrado/objetivo; con varias se
  // muestra por moneda (mezclar nominales de monedas distintas daría un % sin sentido).
  const pctFor = (c: string) => {
    const target = targetByCurrency.get(c) ?? 0;
    return target > 0 ? Math.min(100, Math.round(((savedByCurrency.get(c) ?? 0) / target) * 100)) : 0;
  };
  const overallPctLabel = multiCurrency
    ? Array.from(targetByCurrency.keys())
        .map((c) => `${pctFor(c)}% ${c}`)
        .join(' · ')
    : `${pctFor(Array.from(targetByCurrency.keys())[0] ?? 'ARS')}%`;

  function renderGoalCard(goal: Goal) {
    const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.saved / goal.targetAmount) * 100)) : 100;
    const paceLabel = pace(goal);
    return (
      <div className="card mf-budget-card" key={goal.id}>
        <div className="mf-budget-head">
          <div className="mf-budget-icon" style={{ background: `${goal.color}26` }}>
            {goal.icon ?? '🎯'}
          </div>
          <div className="mf-budget-titles">
            <div className="mf-budget-name">{goal.name}</div>
            <div className="mf-budget-status">{goal.achievedAt ? '¡Lograda!' : `${pct}% ahorrado`}</div>
          </div>
          {!goal.achievedAt && <div className="mf-budget-pct">{pct}%</div>}
          <button type="button" className="mf-icon-btn" aria-label="Editar meta" onClick={() => openEdit(goal)}>
            <IcoPencil size={15} />
          </button>
          <button type="button" className="mf-icon-btn" aria-label="Eliminar meta" onClick={() => onDelete(goal.id)}>
            <IcoTrash size={15} />
          </button>
        </div>
        <div className="mf-progress">
          <div className="mf-progress-fill" style={{ width: `${pct}%`, background: goal.color }} />
        </div>
        <div className="mf-budget-foot">
          <span className="mono muted">
            {formatMoney(goal.saved, goal.currency)} de {formatMoney(goal.targetAmount, goal.currency)}
          </span>
          <span className="muted">Faltan {formatMoney(goal.remaining, goal.currency)}</span>
        </div>
        {paceLabel && (
          <div className="mf-budget-foot" style={{ marginTop: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {paceLabel}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!goal.achievedAt && (
            <button
              type="button"
              className="mf-debt-pay"
              style={{ marginTop: 0, flex: 1 }}
              onClick={() => onStartContrib(goal)}
            >
              Registrar aporte
            </button>
          )}
          {goal.saved > 0 && (
            <button
              type="button"
              className="mf-debt-pay secondary"
              style={{ marginTop: 0, flex: 1 }}
              onClick={() => onStartWithdraw(goal)}
            >
              Retirar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="mf-label">Ahorrado</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: multiCurrency ? 22 : 32, color: 'var(--pos)' }}>
            {moneyList(savedByCurrency)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Objetivo total</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: multiCurrency ? 22 : 32 }}>
            {moneyList(targetByCurrency)}
          </div>
        </div>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Progreso</div>
            <div className="mf-figure mf-figure--stat" style={{ fontSize: multiCurrency ? 22 : 32 }}>
              {overallPctLabel}
            </div>
          </div>
        </div>
      </div>

      {!goals ? (
        <p className="muted">Cargando…</p>
      ) : activeGoals.length === 0 ? (
        <p className="muted">Todavía no definiste metas de ahorro.</p>
      ) : (
        <div className="mf-grid-2">{activeGoals.map(renderGoalCard)}</div>
      )}

      {achievedGoals.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={() => setShowAchieved((v) => !v)}>
            {showAchieved ? 'Ocultar' : 'Ver'} logradas ({achievedGoals.length})
          </button>
          {showAchieved && (
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 12 }}
            >
              {achievedGoals.map(renderGoalCard)}
            </div>
          )}
        </div>
      )}

      <div className="mf-dashed-tile mf-dashed-tile--row">
        <button type="button" className="mf-dashed-main" onClick={openCreate}>
          <span className="mf-dashed-mark" aria-hidden="true">
            <IcoPlus />
          </span>
          <span className="mf-dashed-title">Nueva meta</span>
        </button>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Editar meta de ahorro' : 'Nueva meta de ahorro'}
      >
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="Ej: Vacaciones, Fondo de emergencia…"
              autoFocus
            />
          </label>
          <div className="form-row">
            <label className="field" style={{ flex: 2 }}>
              Monto objetivo
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                required
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Moneda
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={currencyLocked}>
                {/* Si la meta ya está en otra moneda (modelo free-string), se muestra igual. */}
                {!CURRENCY_OPTIONS.includes(currency) && <option value={currency}>{currency}</option>}
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {currencyLocked && (
            <p className="muted" style={{ margin: 0 }}>
              La moneda no se puede cambiar: la meta ya tiene aportes o retiros registrados en {currency}.
            </p>
          )}
          <label className="field">
            Fecha objetivo (opcional)
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
          <label className="field">
            Emoji (opcional)
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              placeholder="🎯"
            />
          </label>
          <label className="field">
            Color
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '3px solid var(--text)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear meta'}</button>
        </form>
      </Modal>

      <Modal
        open={contribGoal !== null}
        onClose={onCloseContrib}
        title={contribGoal ? `Registrar aporte: ${contribGoal.name}` : ''}
      >
        {contribGoal &&
          (() => {
            // El monto se ingresa en la moneda de la cuenta elegida; si difiere de la de la
            // meta se muestra la conversión (TC + convertido) antes de confirmar.
            const goalCurrency = contribGoal.currency ?? 'ARS';
            const account = accounts.find((a) => a.id === contribAccountId);
            const cross = account !== undefined && account.currency !== goalCurrency;
            const rateToGoal = cross ? crossRate(account.currency, goalCurrency, rates) : 1;
            const rateMissing = cross && rateToGoal === null;
            const converted =
              cross && rateToGoal !== null && contribAmount !== ''
                ? Math.round(Number(contribAmount) * rateToGoal * 100) / 100
                : null;
            return (
              <form onSubmit={onConfirmContrib} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {error && <div className="error-banner">{error}</div>}
                <label className="field">
                  {cross ? `Monto (${account.currency})` : 'Monto'}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                    autoFocus
                    required
                  />
                </label>
                {accounts.length > 0 && (
                  <label className="field">
                    Cuenta de origen
                    <select
                      value={contribAccountId}
                      onChange={(e) => {
                        setContribAccountId(e.target.value);
                        // Cambiar de cuenta re-prellena el monto en su moneda.
                        setContribAmount(
                          accountPrefill(
                            contribGoal.remaining,
                            goalCurrency,
                            accounts.find((a) => a.id === e.target.value),
                          ),
                        );
                      }}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.icon ? `${a.icon} ` : ''}
                          {a.name} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {rateMissing && (
                  <div style={{ fontSize: 12, color: 'var(--warn)' }}>
                    Falta cotización para convertir {account.currency} a {goalCurrency}: cargala en
                    Inversiones para aportar desde esta cuenta.
                  </div>
                )}
                {cross && converted !== null && (
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    ≈ {formatMoney(converted, goalCurrency)} se suman a la meta ·{' '}
                    {rateLabel(account.currency, goalCurrency, rates)}
                  </div>
                )}
                <button disabled={contribBusy || rateMissing}>{contribBusy ? 'Guardando…' : 'Aportar'}</button>
              </form>
            );
          })()}
      </Modal>

      <Modal
        open={withdrawGoal !== null}
        onClose={onCloseWithdraw}
        title={withdrawGoal ? `Retirar de: ${withdrawGoal.name}` : ''}
      >
        {withdrawGoal &&
          (() => {
            // El monto se ingresa en la moneda de la cuenta destino (lo que entra a la cuenta);
            // si difiere de la de la meta, se muestra cuánto se descuenta de lo ahorrado.
            const goalCurrency = withdrawGoal.currency ?? 'ARS';
            const account = accounts.find((a) => a.id === withdrawAccountId);
            const cross = account !== undefined && account.currency !== goalCurrency;
            const rateToGoal = cross ? crossRate(account.currency, goalCurrency, rates) : 1;
            const rateMissing = cross && rateToGoal === null;
            const converted =
              cross && rateToGoal !== null && withdrawAmount !== ''
                ? Math.round(Number(withdrawAmount) * rateToGoal * 100) / 100
                : null;
            const maxAmount = !cross
              ? withdrawGoal.saved
              : rateToGoal !== null
                ? floor2(withdrawGoal.saved / rateToGoal)
                : undefined;
            return (
              <form onSubmit={onConfirmWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {error && <div className="error-banner">{error}</div>}
                <label className="field">
                  {cross ? `Monto (${account.currency})` : 'Monto'}
                  <input
                    type="number"
                    min="0.01"
                    max={maxAmount}
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    autoFocus
                    required
                  />
                </label>
                {accounts.length > 0 && (
                  <label className="field">
                    Cuenta destino
                    <select
                      value={withdrawAccountId}
                      onChange={(e) => {
                        setWithdrawAccountId(e.target.value);
                        // Cambiar de cuenta re-prellena el monto en su moneda.
                        setWithdrawAmount(
                          accountPrefill(
                            withdrawGoal.saved,
                            goalCurrency,
                            accounts.find((a) => a.id === e.target.value),
                          ),
                        );
                      }}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.icon ? `${a.icon} ` : ''}
                          {a.name} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {rateMissing && (
                  <div style={{ fontSize: 12, color: 'var(--warn)' }}>
                    Falta cotización para convertir {account.currency} a {goalCurrency}: cargala en
                    Inversiones para retirar hacia esta cuenta.
                  </div>
                )}
                {cross && converted !== null && (
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    ≈ {formatMoney(converted, goalCurrency)} se descuentan de lo ahorrado ·{' '}
                    {rateLabel(account.currency, goalCurrency, rates)}
                  </div>
                )}
                <label className="field">
                  Nota (opcional)
                  <input value={withdrawNote} onChange={(e) => setWithdrawNote(e.target.value)} maxLength={500} />
                </label>
                <button disabled={withdrawBusy || rateMissing}>{withdrawBusy ? 'Guardando…' : 'Retirar'}</button>
              </form>
            );
          })()}
      </Modal>
    </>
  );
}
