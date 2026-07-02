import type { DashboardData } from '@myfinance/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, formatDate, formatMoney } from '../api';

/** Lee los tokens de color del tema activo (claro/oscuro) para pasarlos a Recharts. */
function useThemeTokens() {
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    return {
      ink: token('--ink'),
      debit: token('--debit'),
      rule: token('--rule'),
      muted: token('--ink-mut'),
      sheet: token('--sheet'),
    };
  }, []);
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shortMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokens = useThemeTokens();

  useEffect(() => {
    api.dashboard().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <p className="muted">Cargando resumen…</p>;

  const comparison = data.monthlyComparison.map((m) => ({
    ...m,
    label: shortMonthLabel(m.month),
  }));
  const totalExpenses = data.expensesByCategory.reduce((sum, c) => sum + c.total, 0);
  const monthResult = data.monthIncome - data.monthExpense;

  const tooltipStyle = {
    background: tokens.sheet,
    border: `1px solid ${tokens.rule}`,
    borderRadius: 4,
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
  };

  return (
    <>
      <header className="ledger-hero">
        <p className="eyebrow">Estado de cuenta · {monthLabel(data.month)}</p>
        <p className={`hero-balance ${data.balance < 0 ? 'negative' : ''}`}>
          {formatMoney(data.balance)}
        </p>
        <p className="hero-sub">Saldo total acumulado</p>
        <dl className="ledger-lines">
          <div className="ledger-line">
            <dt>Ingresos del mes</dt>
            <span className="leader" aria-hidden="true" />
            <dd>+{formatMoney(data.monthIncome)}</dd>
          </div>
          <div className="ledger-line">
            <dt>Gastos del mes</dt>
            <span className="leader" aria-hidden="true" />
            <dd className="debit">−{formatMoney(data.monthExpense)}</dd>
          </div>
          <div className="ledger-line">
            <dt>Resultado del mes</dt>
            <span className="leader" aria-hidden="true" />
            <dd className={monthResult < 0 ? 'debit' : ''}>
              {monthResult < 0 ? '−' : ''}
              {formatMoney(Math.abs(monthResult))}
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid two-col" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Gastos por categoría</h3>
          {data.expensesByCategory.length === 0 ? (
            <p className="muted">
              Todavía no hay gastos este mes. Registrá el primero desde Movimientos.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={data.expensesByCategory}
                    dataKey="total"
                    nameKey="categoryName"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke={tokens.sheet}
                    strokeWidth={2}
                  >
                    {data.expensesByCategory.map((entry) => (
                      <Cell key={entry.categoryId ?? 'none'} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatMoney(value)}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-legend" style={{ flex: 1, minWidth: 180 }}>
                {data.expensesByCategory.map((entry) => (
                  <div className="legend-row" key={entry.categoryId ?? 'none'}>
                    <span className="legend-name">
                      <span className="cat-dot" style={{ background: entry.color }} />
                      {entry.categoryName}
                    </span>
                    <span className="legend-value">
                      {formatMoney(entry.total)}
                      <span className="muted">
                        {' '}
                        · {totalExpenses > 0 ? Math.round((entry.total / totalExpenses) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Mes a mes</h3>
            <div className="chip-legend">
              <span className="chip">
                <span className="chip-swatch" style={{ background: tokens.ink }} />
                Ingresos
              </span>
              <span className="chip">
                <span className="chip-swatch" style={{ background: tokens.debit }} />
                Gastos
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={comparison} barGap={2}>
              <CartesianGrid vertical={false} stroke={tokens.rule} />
              <XAxis
                dataKey="label"
                tick={{ fill: tokens.muted, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: tokens.muted, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={70}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatMoney(value),
                  name === 'income' ? 'Ingresos' : 'Gastos',
                ]}
                labelFormatter={(label) => `Mes: ${label}`}
                contentStyle={tooltipStyle}
                cursor={{ fill: tokens.rule, fillOpacity: 0.35 }}
              />
              <Bar dataKey="income" fill={tokens.ink} radius={[2, 2, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" fill={tokens.debit} radius={[2, 2, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Próximos pagos (14 días)</h3>
        {data.upcomingPayments.length === 0 ? (
          <p className="muted">No hay vencimientos en los próximos 14 días.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Vence</th>
                <th className="num">Monto</th>
              </tr>
            </thead>
            <tbody>
              {data.upcomingPayments.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    <span className="cat-chip">
                      <span
                        className="cat-dot"
                        style={{ background: item.category?.color ?? '#9ca3af' }}
                      />
                      {item.category?.name ?? 'Sin categoría'}
                    </span>
                  </td>
                  <td className="mono">{formatDate(item.nextDueDate)}</td>
                  <td className="num amount-expense">{formatMoney(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
