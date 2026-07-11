import type { Account, Goal } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPencil, IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

const COLOR_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];

function pace(goal: Goal): string | null {
  if (!goal.targetDate || goal.remaining <= 0) return null;
  const msLeft = new Date(goal.targetDate).getTime() - Date.now();
  if (msLeft <= 0) return 'Fecha objetivo cumplida';
  const monthsLeft = Math.max(1, Math.ceil(msLeft / (30 * 86_400_000)));
  return `Ahorrá ${formatMoney(goal.remaining / monthsLeft)}/mes para llegar a tiempo`;
}

export function GoalsPage() {
  const [error, setError] = useState<string | null>(null);
  const [showAchieved, setShowAchieved] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
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
  const { data: accountsData } = useCached<Account[]>('accounts', () => api.listAccounts());
  const accounts = accountsData ?? [];

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

  function onStartContrib(goal: Goal) {
    setContribGoal(goal);
    setContribAmount(String(goal.remaining || ''));
    setContribAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
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
    setWithdrawGoal(goal);
    setWithdrawAmount(String(goal.saved || ''));
    setWithdrawAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
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
  const totalTarget = activeGoals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = activeGoals.reduce((sum, g) => sum + g.saved, 0);
  const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

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
            {formatMoney(goal.saved)} de {formatMoney(goal.targetAmount)}
          </span>
          <span className="muted">Faltan {formatMoney(goal.remaining)}</span>
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
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32, color: 'var(--pos)' }}>
            {formatMoney(totalSaved)}
          </div>
        </div>
        <div className="card">
          <div className="mf-label">Objetivo total</div>
          <div className="mf-figure mf-figure--stat" style={{ fontSize: 32 }}>
            {formatMoney(totalTarget)}
          </div>
        </div>
        <div className="mf-hero-card">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label">Progreso</div>
            <div className="mf-figure mf-figure--stat" style={{ fontSize: 32 }}>
              {overallPct}%
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
          <label className="field">
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
        {contribGoal && (
          <form onSubmit={onConfirmContrib} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <label className="field">
              Monto
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
                <select value={contribAccountId} onChange={(e) => setContribAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon ? `${a.icon} ` : ''}
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button disabled={contribBusy}>{contribBusy ? 'Guardando…' : 'Aportar'}</button>
          </form>
        )}
      </Modal>

      <Modal
        open={withdrawGoal !== null}
        onClose={onCloseWithdraw}
        title={withdrawGoal ? `Retirar de: ${withdrawGoal.name}` : ''}
      >
        {withdrawGoal && (
          <form onSubmit={onConfirmWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && <div className="error-banner">{error}</div>}
            <label className="field">
              Monto
              <input
                type="number"
                min="0.01"
                max={withdrawGoal.saved}
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
                <select value={withdrawAccountId} onChange={(e) => setWithdrawAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon ? `${a.icon} ` : ''}
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              Nota (opcional)
              <input value={withdrawNote} onChange={(e) => setWithdrawNote(e.target.value)} maxLength={500} />
            </label>
            <button disabled={withdrawBusy}>{withdrawBusy ? 'Guardando…' : 'Retirar'}</button>
          </form>
        )}
      </Modal>
    </>
  );
}
