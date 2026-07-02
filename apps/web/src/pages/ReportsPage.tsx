import { useState } from 'react';
import { api } from '../api';

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
      <h1 className="page-title">Reportes</h1>
      <p className="page-subtitle">Exportá tus movimientos en CSV o un resumen mensual en PDF</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="grid two-col">
        <div className="card">
          <h3>Exportar transacciones (CSV)</h3>
          <div className="form-row">
            <label className="field">
              Desde (opcional)
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              Hasta (opcional)
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button onClick={downloadCsv} disabled={busy !== null}>
              {busy === 'csv' ? 'Generando…' : 'Descargar CSV'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Sin fechas exporta el historial completo. Compatible con Excel y Google Sheets.
          </p>
        </div>

        <div className="card">
          <h3>Resumen mensual (PDF)</h3>
          <div className="form-row">
            <label className="field">
              Mes
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <button onClick={downloadPdf} disabled={busy !== null}>
              {busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Incluye resumen, gastos por categoría y el detalle de transacciones del mes.
          </p>
        </div>
      </div>
    </>
  );
}
