import type { DashboardData } from '@myfinance/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
      income: token('--income'),
      expense: token('--expense'),
      gridline: token('--gridline'),
      muted: token('--text-muted'),
      surface: token('--surface-1'),
    };
  }, []);
}

function monthLabel(month: string): string {
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
  if (!data) return <p className="muted">Cargando dashboard…</p>;

  const comparison = data.monthlyComparison.map((m) => ({
    ...m,
    label: monthLabel(m.month),
  }));
  const totalExpenses = data.expensesByCategory.reduce((sum, c) => sum + c.total, 0);

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">Resumen de {monthLabel(data.month)}</p>

      <div className="grid kpi-row" style={{ marginBottom: 16 }}>
        <div className="card stat-tile">
          <div className="stat-label">Balance actual</div>
          <div className={`stat-value ${data.balance >= 0 ? 'positive' : 'negative'}`}>
            {formatMoney(data.balance)}
          </div>
          <div className="stat-delta">acumulado histórico</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Ingresos del mes</div>
          <div className="stat-value">{formatMoney(data.monthIncome)}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Gastos del mes</div>
          <div className="stat-value">{formatMoney(data.monthExpense)}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Resultado del mes</div>
          <div
            className={`stat-value ${data.monthIncome - data.monthExpense >= 0 ? 'positive' : 'negative'}`}
          >
            {formatMoney(data.monthIncome - data.monthExpense)}
          </div>
        </div>
      </div>

      <div className="grid two-col" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Gastos por categoría</h3>
          {data.expensesByCategory.length === 0 ? (
            <p className="muted">Sin gastos este mes.</p>
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
                    stroke={tokens.surface}
                    strokeWidth={2}
                  >
                    {data.expensesByCategory.map((entry) => (
                      <Cell key={entry.categoryId ?? 'none'} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatMoney(value)} />
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
          <h3>Comparativa mes a mes</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={comparison} barGap={2}>
              <CartesianGrid vertical={false} stroke={tokens.gridline} />
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
              />
              <Legend
                formatter={(value: string) => (value === 'income' ? 'Ingresos' : 'Gastos')}
              />
              <Bar dataKey="income" fill={tokens.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" fill={tokens.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Próximos pagos (14 días)</h3>
        {data.upcomingPayments.length === 0 ? (
          <p className="muted">No hay pagos próximos. 🎉</p>
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
                  <td>{formatDate(item.nextDueDate)}</td>
                  <td className="num">{formatMoney(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
