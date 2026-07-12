import type {
  Account, AccountsOverview,
  Category,
  DashboardData,
  ImportPreview,
  ImportResult,
  TransactionType,
} from '@myfinance/shared';
import { useEffect, useRef, useState } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoDoc } from '../components/icons';
import { MonthPicker } from '../components/MonthPicker';
import { currentMonthKey, monthLabel } from '../lib/months';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  // Período unificado (spec 13): un solo MonthPicker gobierna el resumen en pantalla, el
  // default del PDF y el footnote de conteo. El CSV es la excepción: es un export, no una
  // vista, así que su rango sigue siendo from/to libre e independiente.
  const [month, setMonth] = useState(currentMonthKey());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filterType, setFilterType] = useState<TransactionType | ''>('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Estados de busy separados: generar el CSV ya no bloquea el botón del PDF ni viceversa.
  const [csvBusy, setCsvBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const [importAccountId, setImportAccountId] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useCached<DashboardData>(`dashboard:${month}`, () => api.dashboard(month));
  const { data: accountsData } = useCached<AccountsOverview>('accounts', () => api.listAccounts());
  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const accounts = accountsData?.items ?? [];
  const categories = categoriesData ?? [];
  // El export de CSV mantiene las cuentas archivadas (su historial debe seguir siendo
  // exportable), pero el destino de import es un alta: se excluyen (spec 12).
  const importAccounts = accounts.filter((a) => !a.archivedAt);
  // Los montos importados son nominales en la moneda de la cuenta destino (spec 19, fase C):
  // el preview los muestra en esa moneda.
  const importCurrency = importAccounts.find((a) => a.id === importAccountId)?.currency;
  useEffect(() => {
    if (!importAccountId && importAccounts.length) {
      setImportAccountId(importAccounts.find((a) => a.isDefault)?.id ?? importAccounts[0].id);
    }
  }, [accountsData, importAccountId, importAccounts]);

  async function downloadCsv() {
    setError(null);
    setCsvBusy(true);
    try {
      const blob = await api.downloadReport('csv', {
        from: from || undefined,
        to: to || undefined,
        type: filterType || undefined,
        categoryId: filterCategoryId || undefined,
        accountId: filterAccountId || undefined,
      });
      downloadBlob(blob, 'transacciones.csv');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setCsvBusy(false);
    }
  }

  async function downloadPdf() {
    setError(null);
    setPdfBusy(true);
    try {
      const blob = await api.downloadReport('pdf', { month });
      downloadBlob(blob, `reporte-${month}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setPdfBusy(false);
    }
  }

  /** Al elegir un archivo, corre el dry-run automáticamente: preview antes de escribir nada. */
  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setImportResult(null);
    setPreview(null);
    setPendingCsv(null);
    setPreviewing(true);
    try {
      const csv = await file.text();
      const result = await api.previewImport(csv, importAccountId || undefined);
      setPreview(result);
      setPendingCsv(csv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setPreviewing(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setPendingCsv(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  /** Confirmar ejecuta el import real con el mismo CSV que ya se previsualizó. */
  async function confirmImport() {
    if (!pendingCsv) return;
    setError(null);
    setConfirming(true);
    try {
      const result = await api.importTransactions(pendingCsv, importAccountId || undefined);
      setImportResult(result);
      setPreview(null);
      setPendingCsv(null);
      if (fileRef.current) fileRef.current.value = '';
      // Los movimientos importados afectan resumen, presupuestos, listados y saldos.
      invalidate('transactions');
      invalidate('dashboard');
      invalidate('budgets');
      invalidate('accounts');
      // Corre la detección de sugerencias sobre lo recién importado (spec 01 — el badge no
      // quedaba al día hasta la próxima visita a /sugerencias). Best-effort: si falla, esa
      // página reintenta sola al entrar.
      api
        .refreshSuggestions()
        .then(() => invalidate('suggestions'))
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {data && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="mf-label">Resumen de {monthLabel(month)}</div>
          {/* Totales consolidados a moneda base por la API; "≈" indica conversión (spec 19). */}
          <div className="mf-hero-stats" style={{ marginTop: 16, paddingTop: 0, border: 'none' }}>
            <div>
              <div className="mf-stat-label">Ingresos</div>
              <div className="mf-stat-value" style={{ color: 'var(--pos)' }}>
                {data.currency?.converted && '≈ '}
                {formatMoney(data.monthIncome, data.currency?.baseCurrency)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Gastos</div>
              <div className="mf-stat-value" style={{ color: 'var(--neg)' }}>
                {data.currency?.converted && '≈ '}
                {formatMoney(data.monthExpense, data.currency?.baseCurrency)}
              </div>
            </div>
            <div>
              <div className="mf-stat-label">Neto</div>
              <div className="mf-stat-value">
                {formatMoney(data.monthIncome - data.monthExpense, data.currency?.baseCurrency)}
              </div>
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
            Exportá tus movimientos del período seleccionado en formato CSV para tu planilla. El rango es libre,
            independiente del mes de arriba. Cada fila incluye la moneda de su cuenta (columna{' '}
            <code>moneda</code>), sin conversión.
          </p>
          <div className="mf-report-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta" />
          </div>
          <div className="mf-report-filters">
            <select
              className="mf-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as TransactionType | '')}
            >
              <option value="">Todos los tipos</option>
              <option value="INCOME">Ingresos</option>
              <option value="EXPENSE">Gastos</option>
            </select>
            <select
              className="mf-select"
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {accounts.length > 0 && (
              <select
                className="mf-select"
                value={filterAccountId}
                onChange={(e) => setFilterAccountId(e.target.value)}
              >
                <option value="">Todas las cuentas</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button type="button" className="mf-report-btn primary" onClick={downloadCsv} disabled={csvBusy}>
            {csvBusy ? 'Generando…' : 'Descargar CSV'}
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
            Resumen de {monthLabel(month)} (el mes elegido arriba) con balance, gastos por categoría y comparativa,
            listo para imprimir.
          </p>
          <button type="button" className="mf-report-btn secondary" onClick={downloadPdf} disabled={pdfBusy}>
            {pdfBusy ? 'Generando…' : 'Generar PDF'}
          </button>
        </div>
      </div>

      <div className="card mf-report-card" style={{ marginTop: 16 }}>
        <div className="mf-report-head">
          <div className="mf-report-icon csv">
            <IcoDoc size={20} />
          </div>
          <div className="mf-report-title">Importar CSV</div>
        </div>
        <p className="mf-report-desc">
          Subí un CSV con el mismo formato que exporta la app (<code>fecha,tipo,monto,categoria,nota</code>; las
          columnas <code>meta</code>, <code>cuenta</code> y <code>moneda</code> de la exportación se ignoran al
          importar). Las categorías se emparejan por nombre; si no existen, se crean. Los movimientos quedan en
          la cuenta elegida y por lo tanto en su moneda: los montos se toman tal cual, sin conversión. Antes de
          escribir nada se muestra un preview para revisar.
        </p>
        {importAccounts.length > 0 && (
          <label className="field" style={{ marginBottom: 12 }}>
            Importar en la cuenta
            <select value={importAccountId} onChange={(e) => setImportAccountId(e.target.value)}>
              {importAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon ? `${a.icon} ` : ''}
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFileSelected}
          disabled={previewing || confirming}
          style={{ marginBottom: 12 }}
        />
        {previewing && <p className="muted">Analizando archivo…</p>}

        {preview && (
          <div className="mf-import-preview">
            <p>
              Se importarán <strong>{preview.valid}</strong>, se omitirán{' '}
              <strong>{preview.skipped + preview.errors.length}</strong>
              {preview.errors.length > 0 && (
                <> ({preview.errors.length} por error{preview.errors.length === 1 ? '' : 'es'})</>
              )}
              .
            </p>

            {preview.sample.length > 0 && (
              <div className="mf-import-sample">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Monto</th>
                      <th>Categoría</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, i) => (
                      <tr key={i}>
                        <td>{row.fecha}</td>
                        <td>{row.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</td>
                        <td className="mono">{formatMoney(row.monto, importCurrency)}</td>
                        <td>{row.categoria}</td>
                        <td>{row.nota || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.errors.length > 0 && (
              <>
                <div className="mf-label" style={{ marginTop: 12 }}>
                  Errores ({preview.errors.length})
                </div>
                <ul className="mf-import-errors">
                  {preview.errors.map((err) => (
                    <li key={err.line} className="muted" style={{ fontSize: 12 }}>
                      Línea {err.line}: {err.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mf-import-actions">
              <button
                type="button"
                className="mf-report-btn primary"
                onClick={confirmImport}
                disabled={confirming || preview.valid === 0}
              >
                {confirming ? 'Importando…' : 'Confirmar importación'}
              </button>
              <button
                type="button"
                className="mf-report-btn secondary"
                onClick={cancelPreview}
                disabled={confirming}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="mf-report-desc" style={{ marginTop: 12 }}>
            <strong>{importResult.imported}</strong> movimientos importados
            {importResult.skipped > 0 && <> · {importResult.skipped} filas ignoradas</>}
            {importResult.errors.length > 0 && (
              <>
                <span style={{ color: 'var(--neg)' }}> · {importResult.errors.length} con errores</span>
                <ul className="mf-import-errors">
                  {importResult.errors.map((err) => (
                    <li key={err.line} className="muted" style={{ fontSize: 12 }}>
                      Línea {err.line}: {err.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {data && (
        <p className="mf-report-footnote">
          {data.monthTransactionCount} movimientos registrados en {monthLabel(month)}.
        </p>
      )}
    </>
  );
}
