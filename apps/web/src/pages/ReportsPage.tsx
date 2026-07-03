import type { DashboardData, Paginated, Transaction } from '@myfinance/shared';
import { useState } from 'react';
import { api, formatMoney } from '../api';
import { useCached } from '../cache';
import { IcoDoc } from '../components/icons';

const MONTHS_FULL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${y}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);

  const { data } = useCached<DashboardData>('dashboard', () => api.dashboard());
  const range = data ? monthRange(data.month) : null;
  const { data: monthTx } = useCached<Paginated<Transaction>>(
    range ? `reports-month-count:${data!.month}` : 'reports-month-count:pending',
    () => (range ? api.listTransactions({ from: range.from, to: range.to, pageSize: 1 }) : Promise.resolve(null as never)),
  );

  async function downloadCsv() {
    setError(null);
    setBusy('csv');
    try {
      const blob = await api.downloadReport('csv', {
        from: from || undefined,
        to: to || undefined,
      });
      downloadBlob(blob, 'transacciones.csv');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setError(null);
    setBusy('pdf');
    try {
      const blob = await api.downloadReport('pdf', { month });
      downloadBlob(blob, `reporte-${month}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {data && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="mf-eyebrow">Resumen de {monthLabel(data.month)}</div>
          <div className="mf-hero-stats" style={{ marginTop: 16, paddingTop: 0, border: 'none' }}>
            <div>
              <div className="mf-stat-label">Ingresos</div>
              <div className="mf-stat-value" style={{ color: 'var(--pos)' }}>
                {formatMoney(data.monthIncome)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Gastos</div>
              <div className="mf-stat-value" style={{ color: 'var(--neg)' }}>
                {formatMoney(data.monthExpense)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Neto</div>
              <div className="mf-stat-value">{formatMoney(data.monthIncome - data.monthExpense)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mf-grid-2">
        <div className="card mf-report-card">
          <div className="mf-report-head">
            <div className="mf-report-icon csv">
              <IcoDoc size={20} />
            </div>
            <div className="mf-report-title">Transacciones CSV</div>
          </div>
          <p className="mf-report-desc">
            Exportá tus movimientos del período seleccionado en formato CSV para tu planilla.
          </p>
          <div className="mf-report-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta" />
          </div>
          <button type="button" className="mf-report-btn primary" onClick={downloadCsv} disabled={busy !== null}>
            {busy === 'csv' ? 'Generando…' : 'Descargar CSV'}
          </button>
        </div>

        <div className="card mf-report-card">
          <div className="mf-report-head">
            <div className="mf-report-icon pdf">
              <IcoDoc size={20} />
            </div>
            <div className="mf-report-title">Resumen PDF</div>
          </div>
          <p className="mf-report-desc">
            Resumen mensual con balance, gastos por categoría y comparativa, listo para imprimir.
          </p>
          <div className="mf-report-range">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button type="button" className="mf-report-btn secondary" onClick={downloadPdf} disabled={busy !== null}>
            {busy === 'pdf' ? 'Generando…' : 'Generar PDF'}
          </button>
        </div>
      </div>

      {data && monthTx && (
        <p className="mf-report-footnote">
          {monthTx.total} movimientos registrados en {monthLabel(data.month)}.
        </p>
      )}
    </>
  );
}
