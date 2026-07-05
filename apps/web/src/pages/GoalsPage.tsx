import type { Goal } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
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

  const [contribId, setContribId] = useState<string | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribBusy, setContribBusy] = useState(false);

  const { data: goals, error: loadError, refresh } = useCached<Goal[]>('goals', () => api.listGoals());

  function invalidateAfterMutation() {
    invalidate('goals');
    invalidate('transactions');
    invalidate('dashboard');
    refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createGoal({
        name,
        targetAmount: Number(targetAmount),
        targetDate: targetDate || null,
        icon: icon || null,
        color,
      });
      setName('');
      setTargetAmount('');
      setTargetDate('');
      setIcon('');
      setColor(COLOR_PALETTE[0]);
      setFormOpen(false);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onStartContrib(goal: Goal) {
    setContribId(goal.id);
    setContribAmount(String(goal.remaining || ''));
    setError(null);
  }

  async function onConfirmContrib(goal: Goal) {
    setError(null);
    setContribBusy(true);
    try {
      await api.contributeGoal(goal.id, Number(contribAmount));
      setContribId(null);
      invalidateAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setContribBusy(false);
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

        {!goal.achievedAt &&
          (contribId === goal.id ? (
            <div className="form-row" style={{ marginTop: 10 }}>
              <label className="field">
                Monto
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={contribAmount}
                  onChange={(e) => setContribAmount(e.target.value)}
                  autoFocus
                />
              </label>
              <button disabled={contribBusy} onClick={() => onConfirmContrib(goal)}>
                {contribBusy ? 'Guardando…' : 'Aportar'}
              </button>
              <button className="secondary" disabled={contribBusy} onClick={() => setContribId(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="mf-debt-pay" onClick={() => onStartContrib(goal)}>
              Registrar aporte
            </button>
          ))}
      </div>
    );
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="mf-serif-title">Ahorrado</div>
          <div className="mf-hero-balance" style={{ fontSize: 32, color: 'var(--pos)' }}>
            {formatMoney(totalSaved)}
          </div>
        </div>
        <div className="card">
          <div className="mf-serif-title">Objetivo total</div>
          <div className="mf-hero-balance" style={{ fontSize: 32 }}>
            {formatMoney(totalTarget)}
          </div>
        </div>
        <div className="card">
          <div className="mf-serif-title">Progreso</div>
          <div className="mf-hero-balance" style={{ fontSize: 32 }}>
            {overallPct}%
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

      <button type="button" className="mf-add-btn" style={{ marginTop: 16 }} onClick={() => setFormOpen(true)}>
        <IcoPlus />
        <span className="mf-add-label">Nueva Meta</span>
      </button>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nueva meta de ahorro">
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
          <button disabled={busy}>{busy ? 'Guardando…' : 'Crear meta'}</button>
        </form>
      </Modal>
    </>
  );
}
