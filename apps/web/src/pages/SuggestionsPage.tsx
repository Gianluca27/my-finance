import type {
  Category,
  Frequency,
  RecurringSuggestion,
  RuleSuggestion,
  Suggestion,
} from '@myfinance/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, formatMoney } from '../api';
import { invalidate, useCached } from '../cache';
import { Modal } from '../components/Modal';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
};

function dueLabel(frequency: Frequency, dueDay: number, dueMonth: number | null): string {
  if (frequency === 'WEEKLY') return `los ${WEEKDAYS[dueDay] ?? '?'}`;
  if (frequency === 'YEARLY') return `${dueDay}/${dueMonth ?? 1}`;
  return `día ${dueDay}`;
}

/** Modal para aceptar una sugerencia con los valores detectados, editables antes de crear. */
function AcceptModal({
  suggestion,
  onClose,
  onError,
}: {
  suggestion: Suggestion | null;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const isRecurring = suggestion?.type === 'RECURRING';
  const recurringPayload = isRecurring ? (suggestion as RecurringSuggestion).payload : null;
  const rulePayload = !isRecurring && suggestion ? (suggestion as RuleSuggestion).payload : null;

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('1');
  const [dueMonth, setDueMonth] = useState('1');
  const [reminderDays, setReminderDays] = useState('3');
  const [categoryId, setCategoryId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  // Un recurrente hereda el tipo del patrón; una regla puede apuntar a cualquier categoría.
  const categories = (categoriesData ?? []).filter(
    (c) => !recurringPayload || c.type === recurringPayload.type,
  );

  // Precargar el formulario con lo detectado cada vez que se abre una sugerencia.
  useEffect(() => {
    if (!suggestion) return;
    if (recurringPayload) {
      setName(recurringPayload.name);
      setAmount(String(recurringPayload.amount));
      setFrequency(recurringPayload.frequency);
      setDueDay(String(recurringPayload.dueDay));
      setDueMonth(String(recurringPayload.dueMonth ?? 1));
      setReminderDays('3');
      setCategoryId(recurringPayload.categoryId ?? '');
    } else if (rulePayload) {
      setKeyword(rulePayload.keyword);
      setCategoryId(rulePayload.categoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!suggestion) return;
    setBusy(true);
    try {
      if (isRecurring) {
        await api.acceptSuggestion(suggestion.id, {
          name,
          amount: Number(amount),
          frequency,
          dueDay: Number(dueDay),
          dueMonth: frequency === 'YEARLY' ? Number(dueMonth) : null,
          reminderDaysBefore: Number(reminderDays),
          categoryId: categoryId || null,
        });
        invalidate('recurring');
        invalidate('dashboard');
      } else {
        await api.acceptSuggestion(suggestion.id, { keyword, categoryId });
        invalidate('rules');
      }
      invalidate('suggestions');
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error inesperado');
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!suggestion}
      onClose={onClose}
      title={isRecurring ? 'Crear movimiento fijo' : 'Crear regla de categoría'}
    >
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isRecurring ? (
          <>
            <label className="field">
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
            </label>
            <label className="field">
              Monto
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Frecuencia
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                <option value="MONTHLY">Mensual</option>
                <option value="WEEKLY">Semanal</option>
                <option value="YEARLY">Anual</option>
              </select>
            </label>
            {frequency === 'WEEKLY' ? (
              <label className="field">
                Día de la semana
                <select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                Día de vencimiento
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  required
                />
              </label>
            )}
            {frequency === 'YEARLY' && (
              <label className="field">
                Mes
                <select value={dueMonth} onChange={(e) => setDueMonth(e.target.value)}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              Recordar (días antes)
              <input
                type="number"
                min="0"
                max="30"
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="field">
            Si la nota contiene
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} required maxLength={100} autoFocus />
          </label>
        )}
        <label className="field">
          Categoría
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required={!isRecurring}>
            {isRecurring && <option value="">Sin categoría</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>{busy ? 'Creando…' : isRecurring ? 'Crear movimiento fijo' : 'Crear regla'}</button>
      </form>
    </Modal>
  );
}

export function SuggestionsPage() {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [accepting, setAccepting] = useState<Suggestion | null>(null);

  const { data: items, error: loadError } = useCached<Suggestion[]>('suggestions', () =>
    api.listSuggestions(),
  );

  // Al entrar, correr la detección sobre el historial para que la lista esté al día.
  useEffect(() => {
    let cancelled = false;
    api
      .refreshSuggestions()
      .then(() => {
        if (!cancelled) invalidate('suggestions');
      })
      .catch(() => {
        // La lista cacheada sigue siendo válida; el error de análisis no bloquea la vista.
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDismiss(s: Suggestion) {
    try {
      await api.dismissSuggestion(s.id);
      invalidate('suggestions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const recurring = (items ?? []).filter((s): s is RecurringSuggestion => s.type === 'RECURRING');
  const rules = (items ?? []).filter((s): s is RuleSuggestion => s.type === 'RULE');
  const loading = !items && (scanning || !loadError);

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Movimientos fijos detectados</h3>
        <p className="muted mf-suggest-hint">
          Patrones que se repiten en tus movimientos de los últimos 6 meses y todavía no tenés como fijos.
        </p>
        {loading ? (
          <p className="muted">Analizando tu historial…</p>
        ) : recurring.length === 0 ? (
          <p className="muted">Nada nuevo por ahora.</p>
        ) : (
          <div className="mf-recur-list">
            {recurring.map((s) => (
              <div key={s.id} className="mf-recur-row">
                <div className="mf-recur-icon" style={{ background: 'rgba(99,102,241,0.15)' }}>
                  {s.payload.type === 'INCOME' ? '💵' : '🔁'}
                </div>
                <div className="mf-recur-info">
                  <div className="mf-recur-name">{s.payload.name}</div>
                  <div className="mf-recur-meta">
                    {s.payload.occurrences} veces · {FREQUENCY_LABEL[s.payload.frequency]} ·{' '}
                    {dueLabel(s.payload.frequency, s.payload.dueDay, s.payload.dueMonth)} ·{' '}
                    {s.payload.categoryName ?? 'Sin categoría'}
                  </div>
                </div>
                <div className="mf-recur-amount" style={s.payload.type === 'INCOME' ? { color: 'var(--pos)' } : undefined}>
                  {s.payload.type === 'INCOME' ? '+' : ''}
                  {formatMoney(s.payload.amount)}
                </div>
                <div className="mf-recur-actions">
                  <button className="mf-recur-pay" onClick={() => setAccepting(s)}>
                    Crear fijo
                  </button>
                  <button type="button" className="mf-btn-ghost" onClick={() => onDismiss(s)}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Reglas de categoría sugeridas</h3>
        <p className="muted mf-suggest-hint">
          Palabras que venís categorizando siempre igual: con una regla se asignan solas al cargar.
        </p>
        {loading ? (
          <p className="muted">Analizando tu historial…</p>
        ) : rules.length === 0 ? (
          <p className="muted">Nada nuevo por ahora.</p>
        ) : (
          <div className="mf-recur-list">
            {rules.map((s) => (
              <div key={s.id} className="mf-recur-row">
                <div className="mf-recur-icon" style={{ background: 'rgba(99,102,241,0.15)' }}>
                  🏷️
                </div>
                <div className="mf-recur-info">
                  <div className="mf-recur-name">
                    “{s.payload.keyword}” → {s.payload.categoryName ?? 'categoría'}
                  </div>
                  <div className="mf-recur-meta">Categorizaste así {s.payload.occurrences} movimientos</div>
                </div>
                <div className="mf-recur-actions">
                  <button className="mf-recur-pay" onClick={() => setAccepting(s)}>
                    Crear regla
                  </button>
                  <button type="button" className="mf-btn-ghost" onClick={() => onDismiss(s)}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mf-recur-footnote">
        Las sugerencias se recalculan cada día y al entrar a esta pantalla. Lo que descartás no se vuelve a
        sugerir.
      </p>

      <AcceptModal suggestion={accepting} onClose={() => setAccepting(null)} onError={setError} />
    </>
  );
}
