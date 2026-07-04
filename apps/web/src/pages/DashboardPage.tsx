import type { BudgetStatus, CategorySummary, DashboardData } from '@myfinance/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { useCached } from '../cache';

const DONUT_R = 54;
const DONUT_C = 2 * Math.PI * DONUT_R;
const OTHER_COLOR = '#5a6472';

function formatMoneyShort(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 1000) return `$ ${Math.round(v / 1000)}k`;
  return `$ ${Math.round(v)}`;
}

function shortMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'short',
    timeZone: 'UTC',
  });
}

function hoverMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dueInfo(nextDueDate: string): { label: string; color: string } {
  const daysLeft = Math.round((new Date(nextDueDate).getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return { label: 'Vencido', color: 'var(--neg)' };
  if (daysLeft === 0) return { label: 'Vence hoy', color: 'var(--warn)' };
  if (daysLeft <= 3) return { label: `En ${daysLeft} día${daysLeft > 1 ? 's' : ''}`, color: 'var(--warn)' };
  return { label: `En ${daysLeft} días`, color: 'var(--text-3)' };
}

function topCategories(cats: CategorySummary[]): CategorySummary[] {
  const sorted = [...cats].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  if (rest.length) {
    top.push({
      categoryId: 'rest',
      categoryName: 'Otros',
      color: OTHER_COLOR,
      total: rest.reduce((sum, c) => sum + c.total, 0),
    });
  }
  return top;
}

function budgetBarColor(status: BudgetStatus): string {
  if (status.percentUsed >= 100) return 'var(--neg)';
  if (status.percentUsed >= status.alertThreshold) return 'var(--warn)';
  return 'var(--accent)';
}

export function DashboardPage() {
  const { data, error } = useCached<DashboardData>('dashboard', () => api.dashboard());
  const { data: budgets } = useCached<BudgetStatus[]>('budgets', () => api.listBudgets());
  const [barHover, setBarHover] = useState<{ month: string; left: number; top: number } | null>(null);

  const top = useMemo(() => (data ? topCategories(data.expensesByCategory) : []), [data]);
  const donutSegments = useMemo(() => {
    if (!data || data.monthExpense <= 0) return [];
    let cumulative = 0;
    return top.map((c) => {
      const fraction = c.total / data.monthExpense;
      const dash = fraction * DONUT_C;
      const segment = { color: c.color, dash: `${dash} ${DONUT_C - dash}`, offset: -cumulative };
      cumulative += dash;
      return segment;
    });
  }, [data, top]);

  const miniBudgets = useMemo(() => {
    if (!budgets) return [];
    return [...budgets].sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 4);
  }, [budgets]);

  if (error && !data) return <div className="error-banner">{error}</div>;
  if (!data) return <p className="muted">Cargando resumen…</p>;

  const savingsRate =
    data.monthIncome > 0 ? Math.round(((data.monthIncome - data.monthExpense) / data.monthIncome) * 100) : 0;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgressPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const projected = data.insights.projectedMonthTotal;
  const expenseOfProjectedPct =
    projected && projected > 0 ? Math.round((data.monthExpense / projected) * 100) : null;

  const prevTotal = data.insights.previousMonthComparison?.total ?? null;
  const balDelta = prevTotal ? prevTotal.current - prevTotal.previous : null;
  const deltaUp = (balDelta ?? 0) > 0;

  const maxBar = Math.max(1, ...data.monthlyComparison.map((m) => Math.max(m.income, m.expense)));

  return (
    <div className="mf-dashboard">
      <div className="mf-hero-card mf-b-balance">
        <div className="mf-hero-glow" />
        <div className="mf-hero-body">
          <div className="mf-eyebrow">Balance total</div>
          <div className="mf-hero-balance">{formatMoney(data.balance)}</div>
          {prevTotal && balDelta !== null && (
            <div className="mf-hero-delta">
              <span
                className="mf-delta-badge"
                style={{
                  background: deltaUp ? 'var(--neg-weak)' : 'var(--accent-weak)',
                  color: deltaUp ? 'var(--neg)' : 'var(--pos)',
                }}
              >
                {deltaUp ? '▲' : '▼'} {formatMoney(Math.abs(balDelta))}
              </span>
              <span>vs. mes anterior</span>
            </div>
          )}
          <div className="mf-hero-stats">
            <div>
              <div className="mf-stat-label">Ingresos · {monthLabel(data.month)}</div>
              <div className="mf-stat-value" style={{ color: 'var(--pos)' }}>
                {formatMoney(data.monthIncome)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Gastos · {monthLabel(data.month)}</div>
              <div className="mf-stat-value" style={{ color: 'var(--neg)' }}>
                {formatMoney(data.monthExpense)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Tasa de ahorro</div>
              <div className="mf-stat-value">{savingsRate}%</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card mf-insight-card mf-b-proj">
        <div className="mf-eyebrow">Proyección del mes</div>
        {projected === null ? (
          <p className="muted">Necesitás más historial para proyectar.</p>
        ) : (
          <>
            <div className="mf-projection-row">
              <div className="mf-hero-balance" style={{ fontSize: 26 }}>
                {formatMoney(projected)}
              </div>
              <div className="muted">gasto estimado</div>
            </div>
            <div className="mf-progress">
              <div className="mf-progress-fill" style={{ width: `${monthProgressPct}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Día {dayOfMonth} de {daysInMonth}
              {expenseOfProjectedPct !== null &&
                ` · llevás gastado el ${expenseOfProjectedPct}% de la proyección`}
            </div>
          </>
        )}
        <div className="mf-anomaly-list">
          {data.insights.anomalies.length === 0 ? (
            <div className="mf-anomaly-row mf-anomaly-ok">
              <span>✅</span>
              <span style={{ flex: 1 }}>
                <strong>Todo en orden</strong> — tus gastos siguen tu patrón habitual
              </span>
            </div>
          ) : (
            data.insights.anomalies.map((a) => (
              <div className="mf-anomaly-row" key={a.categoryId}>
                <span>⚠</span>
                <span style={{ flex: 1 }}>
                  <strong>{a.name}</strong> está por encima de tu promedio
                </span>
                <span className="mf-anomaly-pct">+{a.percentOfAvg - 100}%</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mf-b-side">
        <div className="card">
          <div className="mf-eyebrow">Disponible para gastar</div>
          <div
            className="mf-hero-balance"
            style={{ fontSize: 26, color: data.safeToSpend.available < 0 ? 'var(--neg)' : 'var(--pos)' }}
          >
            {formatMoney(data.safeToSpend.available)}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Balance {formatMoney(data.safeToSpend.balance)} − gastos fijos por venir{' '}
            {formatMoney(data.safeToSpend.committedExpenses)}
          </div>
        </div>

        <div className="card mf-debt-strip">
          <div style={{ flex: 1 }}>
            <div className="mf-eyebrow">Debo</div>
            <div className="mf-hero-balance" style={{ fontSize: 20, color: 'var(--neg)' }}>
              {formatMoney(data.debtsSummary.totalIOwe)}
            </div>
          </div>
          <div className="mf-debt-divider" />
          <div style={{ flex: 1 }}>
            <div className="mf-eyebrow">Me deben</div>
            <div className="mf-hero-balance" style={{ fontSize: 20, color: 'var(--pos)' }}>
              {formatMoney(data.debtsSummary.totalOwedToMe)}
            </div>
          </div>
          <Link to="/deudas" className="mf-link" style={{ alignSelf: 'center' }}>
            Ver →
          </Link>
        </div>
      </div>

      <div className="card mf-b-donut">
        <div className="mf-eyebrow" style={{ marginBottom: 16 }}>
          Gastos por categoría
        </div>
        {data.expensesByCategory.length === 0 ? (
          <p className="muted">
            Todavía no hay gastos este mes. Registrá el primero desde Movimientos.
          </p>
        ) : (
          <div className="mf-donut-row">
            <div className="mf-donut-wrap">
              <svg width={132} height={132} viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={66} cy={66} r={DONUT_R} fill="none" stroke="var(--surface-2)" strokeWidth={16} />
                {donutSegments.map((seg, i) => (
                  <circle
                    key={i}
                    cx={66}
                    cy={66}
                    r={DONUT_R}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={16}
                    strokeDasharray={seg.dash}
                    strokeDashoffset={seg.offset}
                  />
                ))}
              </svg>
              <div className="mf-donut-center">
                <div className="mf-donut-total">{formatMoneyShort(data.monthExpense)}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  total
                </div>
              </div>
            </div>
            <div className="mf-legend">
              {top.map((c) => (
                <div className="mf-legend-row" key={c.categoryId ?? 'none'}>
                  <span className="mf-legend-dot" style={{ background: c.color }} />
                  <span className="mf-legend-name">{c.categoryName}</span>
                  <span className="mono">
                    {data.monthExpense > 0 ? Math.round((c.total / data.monthExpense) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card mf-b-bars">
        <div className="mf-card-head">
          <div className="mf-eyebrow">Ingresos vs. gastos · {data.monthlyComparison.length} meses</div>
          <div className="chip-legend">
            <span className="chip">
              <span className="chip-swatch" style={{ background: 'var(--pos)' }} />
              Ingresos
            </span>
            <span className="chip">
              <span className="chip-swatch" style={{ background: 'var(--neg)' }} />
              Gastos
            </span>
          </div>
        </div>
        <div className="mf-bars">
          {data.monthlyComparison.map((m) => (
            <div className="mf-bar-col" key={m.month}>
              <div
                className="mf-bar-pair"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setBarHover({ month: m.month, left: rect.left + rect.width / 2, top: rect.top });
                }}
                onMouseLeave={() => setBarHover(null)}
              >
                <div
                  className="mf-bar mf-bar-income"
                  style={{ height: `${Math.max(2, (m.income / maxBar) * 100)}%` }}
                />
                <div
                  className="mf-bar mf-bar-expense"
                  style={{ height: `${Math.max(2, (m.expense / maxBar) * 100)}%` }}
                />
              </div>
              <div
                className="mf-bar-label"
                style={{
                  color: m.month === data.month ? 'var(--text)' : 'var(--text-3)',
                  fontWeight: m.month === data.month ? 700 : 500,
                }}
              >
                {shortMonthLabel(m.month)}
              </div>
            </div>
          ))}
        </div>
        {barHover &&
          (() => {
            const m = data.monthlyComparison.find((mm) => mm.month === barHover.month);
            if (!m) return null;
            return (
              <div
                className="mf-bar-tooltip"
                style={{ left: barHover.left, top: barHover.top }}
              >
                {hoverMonthLabel(m.month)}: Ingresos: {formatMoney(m.income)}. Gastos: {formatMoney(m.expense)}.
              </div>
            );
          })()}
      </div>

      <div className="card mf-b-upcoming">
        <div className="mf-card-head" style={{ marginBottom: 14 }}>
          <div className="mf-eyebrow">Próximos pagos</div>
          <Link to="/recurrentes" className="mf-link">
            Ver todos →
          </Link>
        </div>
        {data.upcomingPayments.length === 0 ? (
          <p className="muted">No hay vencimientos en los próximos 14 días.</p>
        ) : (
          <div>
            {data.upcomingPayments.slice(0, 5).map((p) => {
              const due = dueInfo(p.nextDueDate);
              return (
                <div className="mf-list-row" key={p.id}>
                  <div className="mf-list-icon">{p.category?.icon ?? '💳'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mf-list-title">{p.name}</div>
                    <div style={{ fontSize: 12, color: due.color }}>{due.label}</div>
                  </div>
                  <div className="mono" style={{ fontWeight: 600 }}>
                    {formatMoney(p.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card mf-b-budgets">
        <div className="mf-card-head" style={{ marginBottom: 14 }}>
          <div className="mf-eyebrow">Presupuestos del mes</div>
          <Link to="/presupuestos" className="mf-link">
            Gestionar →
          </Link>
        </div>
        {miniBudgets.length === 0 ? (
          <p className="muted">Todavía no configuraste presupuestos.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {miniBudgets.map((b) => (
              <div key={b.id}>
                <div className="mf-mini-budget-head">
                  <span>
                    <span className="mf-legend-dot" style={{ background: b.category.color }} />
                    {b.category.name}
                  </span>
                  <span className="mono">
                    {formatMoney(b.spent)} / {formatMoney(b.amount)}
                  </span>
                </div>
                <div className="meter">
                  <div
                    className="meter-fill"
                    style={{ width: `${Math.min(100, b.percentUsed)}%`, background: budgetBarColor(b) }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
