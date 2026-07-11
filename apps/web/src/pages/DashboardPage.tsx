import type { BudgetStatus, CategorySummary, DashboardData, PreviousMonthDelta } from '@myfinance/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { useCached } from '../cache';
import { MonthPicker } from '../components/MonthPicker';
import { Skeleton } from '../components/Skeleton';
import { currentMonthKey, monthLabel } from '../lib/months';

const DONUT_R = 42;
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

/** Sigla del gasto fijo para el marcador: "Alquiler" → ALQ. */
function shortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 3).toUpperCase();
}

function budgetBarColor(status: BudgetStatus): string {
  if (status.percentUsed >= 100) return 'var(--neg)';
  if (status.percentUsed >= status.alertThreshold) return 'var(--warn)';
  return 'var(--accent)';
}

/** Top 5 categorías por delta absoluto ($) para que pesos chicos con % gigantes no dominen. */
function topCategoryDeltas(
  byCategory: Array<PreviousMonthDelta & { categoryId: string; name: string }>,
): Array<PreviousMonthDelta & { categoryId: string; name: string }> {
  return [...byCategory]
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))
    .slice(0, 5);
}

/** Silueta de carga con la misma grilla que el dashboard real, para que no haya salto de layout al llegar los datos. */
function DashboardSkeleton({ isCurrentMonth }: { isCurrentMonth: boolean }) {
  const cardBody = (contentHeight: number) => (
    <>
      <Skeleton width="45%" height={10} />
      <Skeleton height={contentHeight} style={{ marginTop: 14 }} />
    </>
  );
  return (
    <div className={isCurrentMonth ? 'mf-dashboard' : 'mf-dashboard mf-dashboard--past'} role="status">
      <span className="mf-sr-only">Cargando…</span>
      <div className="mf-hero-card mf-b-balance">{cardBody(90)}</div>
      {isCurrentMonth && <div className="card mf-b-proj">{cardBody(70)}</div>}
      <div className="mf-b-side">
        {isCurrentMonth && <div className="card">{cardBody(40)}</div>}
        <div className="card">{cardBody(40)}</div>
        <div className="card">{cardBody(40)}</div>
      </div>
      <div className="card mf-b-networth">{cardBody(92)}</div>
      <div className="card mf-b-catdelta">{cardBody(90)}</div>
      <div className="card mf-b-donut">{cardBody(108)}</div>
      <div className="card mf-b-bars">{cardBody(118)}</div>
      {isCurrentMonth && <div className="card mf-b-upcoming">{cardBody(90)}</div>}
      <div className="card mf-b-budgets">{cardBody(100)}</div>
    </div>
  );
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const isCurrentMonth = month === currentMonthKey();
  const { data, error } = useCached<DashboardData>(`dashboard:${month}`, () => api.dashboard(month));
  const { data: budgets } = useCached<BudgetStatus[]>(`budgets:${month}`, () => api.listBudgets(month));
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

  const catDeltas = useMemo(
    () => (data?.insights.previousMonthComparison ? topCategoryDeltas(data.insights.previousMonthComparison.byCategory) : []),
    [data],
  );

  // Geometría del gráfico de patrimonio neto (área + línea, SVG a mano como el resto del dashboard).
  const nw = useMemo(() => {
    const pts = data?.netWorthTrend ?? [];
    if (pts.length < 2) return null;
    const W = 600;
    const H = 92;
    const padY = 12;
    const values = pts.map((p) => p.netWorth);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.netWorth).toFixed(1)}`).join(' ');
    return { W, H, line, area: `${line} L ${W} ${H} L 0 ${H} Z` };
  }, [data]);

  const picker = (
    <div style={{ marginBottom: 14 }}>
      <MonthPicker month={month} onChange={setMonth} />
    </div>
  );

  if (error && !data) {
    return (
      <>
        {picker}
        <div className="error-banner">{error}</div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {picker}
        <DashboardSkeleton isCurrentMonth={isCurrentMonth} />
      </>
    );
  }

  const netWorthCurrent = data.netWorthTrend.length
    ? data.netWorthTrend[data.netWorthTrend.length - 1].netWorth
    : data.balance;
  const netWorthDelta =
    data.netWorthTrend.length >= 2 ? netWorthCurrent - data.netWorthTrend[0].netWorth : null;
  const netWorthUp = (netWorthDelta ?? 0) >= 0;

  const savingsRate =
    data.monthIncome > 0 ? Math.round(((data.monthIncome - data.monthExpense) / data.monthIncome) * 100) : 0;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgressPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const projected = data.insights.projectedMonthTotal;
  const expenseOfProjectedPct =
    projected && projected > 0 ? Math.round((data.monthExpense / projected) * 100) : null;

  // Comparación de gasto alineada por día ("mismo día del mes pasado"), no del balance total.
  const prevExpenseWindow = data.insights.previousMonthComparison?.total ?? null;
  const expenseDelta = prevExpenseWindow ? prevExpenseWindow.current - prevExpenseWindow.previous : null;
  const expenseDeltaUp = (expenseDelta ?? 0) > 0;

  const maxBar = Math.max(1, ...data.monthlyComparison.map((m) => Math.max(m.income, m.expense)));

  return (
    <>
      {picker}
      <div className={isCurrentMonth ? 'mf-dashboard' : 'mf-dashboard mf-dashboard--past'}>
        <div className="mf-hero-card mf-b-balance">
          <div className="mf-hero-glow" />
          <div className="mf-hero-body">
            <div className="mf-label" data-n="01">Balance total</div>
            <div className="mf-hero-balance">{formatMoney(data.balance)}</div>
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
                {prevExpenseWindow && expenseDelta !== null && (
                  <div className="mf-hero-delta" style={{ marginTop: 5, fontSize: 11, flexWrap: 'wrap' }}>
                    <span
                      className="mf-delta-badge"
                      style={{
                        background: expenseDeltaUp ? 'var(--neg-weak)' : 'var(--accent-weak)',
                        color: expenseDeltaUp ? 'var(--neg)' : 'var(--pos)',
                      }}
                    >
                      {expenseDeltaUp ? '▲' : '▼'} {formatMoney(Math.abs(expenseDelta))}
                    </span>
                    <span>vs. mismo día del mes pasado</span>
                  </div>
                )}
              </div>
              <div>
                <div className="mf-stat-label">Tasa de ahorro</div>
                <div className="mf-stat-value">{savingsRate}%</div>
              </div>
              {/* Aportes y retiros de metas no cuentan como gasto/ingreso: se muestran aparte. */}
              {data.goalContributions !== 0 && (
                <div>
                  <div className="mf-stat-label">Ahorro en metas</div>
                  <div
                    className="mf-stat-value"
                    style={{ color: data.goalContributions > 0 ? 'var(--pos)' : 'var(--neg)' }}
                  >
                    {formatMoney(data.goalContributions)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Usa el día real de hoy para la barra de progreso: solo tiene sentido en el mes en curso. */}
        {isCurrentMonth && (
          <div className="card mf-insight-card mf-b-proj">
            <div className="mf-label" data-n="02">Proyección del mes</div>
            {projected === null ? (
              <p className="muted">Necesitás más historial para proyectar.</p>
            ) : (
              <>
                <div className="mf-projection-row">
                  <div className="mf-figure">{formatMoney(projected)}</div>
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
                  <span style={{ flex: 1 }}>
                    <strong>Todo en orden</strong> — tus gastos siguen tu patrón habitual
                  </span>
                </div>
              ) : (
                data.insights.anomalies.map((a) => (
                  <div className="mf-anomaly-row" key={a.categoryId}>
                    <span style={{ flex: 1 }}>
                      <strong>{a.name}</strong>: gastaste {formatMoney(a.currentAmount)} vs. promedio{' '}
                      {formatMoney(a.avgAmount)}
                    </span>
                    <span className="mf-anomaly-pct">+{a.percentOfAvg - 100}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="mf-b-side">
          {/* Balance menos fijos por vencer: estado presente, no aplica a meses pasados. */}
          {isCurrentMonth && (
            <div className="card">
              <div className="mf-label" data-n="03">Disponible</div>
              <div
                className="mf-figure"
                style={{
                  fontSize: 23,
                  marginTop: 6,
                  color: data.safeToSpend.available < 0 ? 'var(--neg)' : 'var(--pos)',
                }}
              >
                {formatMoney(data.safeToSpend.available)}
              </div>
              <div className="mf-caption" title="Balance menos los gastos fijos que faltan pagar este mes">
                {data.safeToSpend.committedExpenses === 0
                  ? `Balance ${formatMoney(data.safeToSpend.balance)} · sin fijos pendientes`
                  : `Balance ${formatMoney(data.safeToSpend.balance)} − Fijos por vencer ${formatMoney(data.safeToSpend.committedExpenses)}`}
              </div>
            </div>
          )}

          <div className="card mf-debt-strip">
            <div style={{ flex: 1 }}>
              <div className="mf-eyebrow">Debo</div>
              <div className="mf-figure" style={{ fontSize: 17, marginTop: 3, color: 'var(--neg)' }}>
                {formatMoney(data.debtsSummary.totalIOwe)}
              </div>
            </div>
            <div className="mf-debt-divider" />
            <div style={{ flex: 1 }}>
              <div className="mf-eyebrow">Me deben</div>
              <div className="mf-figure" style={{ fontSize: 17, marginTop: 3, color: 'var(--pos)' }}>
                {formatMoney(data.debtsSummary.totalOwedToMe)}
              </div>
            </div>
            <Link to="/deudas" className="mf-link" style={{ alignSelf: 'center' }}>
              Ver →
            </Link>
          </div>

          <div className="card">
            <div className="mf-card-head">
              <div className="mf-label mf-label--dot">Inversiones</div>
              <Link to="/inversiones" className="mf-link">
                Ver →
              </Link>
            </div>
            {data.investmentsSummary.totalValue === 0 && data.investmentsSummary.missingRates.length === 0 ? (
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                Todavía no cargaste inversiones.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div className="mf-figure" style={{ fontSize: 18 }}>
                    {formatMoney(data.investmentsSummary.totalValue)}
                  </div>
                  {data.investmentsSummary.totalInvested > 0 && (
                    <span
                      className="mf-delta-badge"
                      style={{
                        background: data.investmentsSummary.pnl >= 0 ? 'var(--accent-weak)' : 'var(--neg-weak)',
                        color: data.investmentsSummary.pnl >= 0 ? 'var(--pos)' : 'var(--neg)',
                      }}
                    >
                      {data.investmentsSummary.pnl >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(data.investmentsSummary.pnl))}{' '}
                      ({data.investmentsSummary.pnlPercent}%)
                    </span>
                  )}
                </div>
                {data.investmentsSummary.missingRates.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>
                    Falta cotización: {data.investmentsSummary.missingRates.join(', ')}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="card mf-b-networth">
          <div className="mf-card-head" style={{ marginBottom: 6 }}>
            <div className="mf-label" data-n={isCurrentMonth ? '04' : '02'}>Patrimonio neto</div>
            <span className="chip">Últimos 12 meses</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <div className="mf-figure" style={{ fontSize: 26 }}>{formatMoney(netWorthCurrent)}</div>
            {netWorthDelta !== null && (
              <span
                className="mf-delta-badge"
                style={{
                  background: netWorthUp ? 'var(--accent-weak)' : 'var(--neg-weak)',
                  color: netWorthUp ? 'var(--pos)' : 'var(--neg)',
                }}
              >
                {netWorthUp ? '▲' : '▼'} {formatMoney(Math.abs(netWorthDelta))}
              </span>
            )}
          </div>
          {nw === null ? (
            <p className="muted">Necesitás más historial para ver la tendencia.</p>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${nw.W} ${nw.H}`}
                width="100%"
                height={nw.H}
                preserveAspectRatio="none"
                style={{ display: 'block' }}
              >
                <defs>
                  <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={nw.area} fill="url(#nwFill)" />
                <path
                  d={nw.line}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="mf-nw-labels">
                {data.netWorthTrend.map((p, i) => (
                  <span
                    key={p.month}
                    style={{ color: p.month === data.month ? 'var(--text)' : 'var(--text-3)' }}
                  >
                    {i % 2 === 0 ? shortMonthLabel(p.month) : ''}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card mf-b-catdelta">
          <div className="mf-label" data-n={isCurrentMonth ? '05' : '03'} style={{ marginBottom: 4 }}>
            Qué cambió vs. mes anterior
          </div>
          {!data.insights.previousMonthComparison ? (
            <p className="muted">Todavía no hay datos del mes anterior para comparar.</p>
          ) : catDeltas.length === 0 ? (
            <p className="muted">Sin categorías comparables entre ambos meses.</p>
          ) : (
            <div className="mf-catdelta-list">
              {catDeltas.map((c) => {
                const spentMore = c.current > c.previous;
                return (
                  <div className="mf-catdelta-row" key={c.categoryId}>
                    <span className="mf-catdelta-name">{c.name}</span>
                    <span className="mf-catdelta-values">
                      {formatMoney(c.previous)} → {formatMoney(c.current)}
                    </span>
                    <span
                      className="mf-delta-badge"
                      style={{
                        background: spentMore ? 'var(--neg-weak)' : 'var(--accent-weak)',
                        color: spentMore ? 'var(--neg)' : 'var(--pos)',
                      }}
                    >
                      {spentMore ? '▲' : '▼'} {Math.abs(c.deltaPercent)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card mf-b-donut">
          <div className="mf-label" data-n={isCurrentMonth ? '06' : '04'} style={{ marginBottom: 14 }}>
            Gastos por categoría
          </div>
          {data.expensesByCategory.length === 0 ? (
            <p className="muted">
              Todavía no hay gastos este mes. Registrá el primero desde Movimientos.
            </p>
          ) : (
            <div className="mf-donut-row">
              <div className="mf-donut-wrap">
                <svg width={108} height={108} viewBox="0 0 108 108" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx={54} cy={54} r={DONUT_R} fill="none" stroke="var(--surface-2)" strokeWidth={13} />
                  {donutSegments.map((seg, i) => (
                    <circle
                      key={i}
                      cx={54}
                      cy={54}
                      r={DONUT_R}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={13}
                      strokeDasharray={seg.dash}
                      strokeDashoffset={seg.offset}
                    />
                  ))}
                </svg>
                <div className="mf-donut-center">
                  <div className="mf-donut-total">{formatMoneyShort(data.monthExpense)}</div>
                  <div className="mf-caption" style={{ marginTop: 0 }}>
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
            <div className="mf-label" data-n={isCurrentMonth ? '07' : '05'}>Ingresos vs. gastos · {data.monthlyComparison.length} meses</div>
            <div className="chip-legend">
              <span className="chip">
                <span className="chip-swatch" style={{ background: 'var(--pos)' }} />
                Ingresos
              </span>
              <span className="chip">
                <span className="chip-swatch" style={{ background: 'var(--bar-expense)' }} />
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

        {/* Vencimientos de los próximos 14 días desde hoy: estado presente, no aplica a meses pasados. */}
        {isCurrentMonth && (
          <div className="card mf-b-upcoming">
            <div className="mf-card-head" style={{ marginBottom: 14 }}>
              <div className="mf-label" data-n="08">Próximos pagos</div>
              <Link to="/recurrentes" className="mf-link">
                Ver todos →
              </Link>
            </div>
            {data.upcomingPayments.length === 0 ? (
              <p className="muted">No hay vencimientos en los próximos 14 días.</p>
            ) : (
              <div>
                {data.upcomingPayments.slice(0, 4).map((p) => {
                  const due = dueInfo(p.nextDueDate);
                  return (
                    <div className="mf-list-row" key={p.id}>
                      <div className="mf-list-icon mf-list-code">{shortCode(p.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mf-list-title">{p.name}</div>
                        <div style={{ fontSize: 11.5, color: due.color }}>{due.label}</div>
                      </div>
                      <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                        {formatMoney(p.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="card mf-b-budgets">
          <div className="mf-card-head" style={{ marginBottom: 14 }}>
            <div className="mf-label" data-n={isCurrentMonth ? '09' : '06'}>Presupuestos del mes</div>
            <Link to="/presupuestos" className="mf-link">
              Gestionar →
            </Link>
          </div>
          {miniBudgets.length === 0 ? (
            <p className="muted">Todavía no configuraste presupuestos.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
    </>
  );
}
