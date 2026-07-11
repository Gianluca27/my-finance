/**
 * Selector de mes: chips "‹ mes año ›" para navegar entre meses. No se puede
 * avanzar más allá del mes en curso; el botón "Hoy" solo aparece cuando el
 * mes mostrado no es el actual, para volver rápido.
 */

/** Mes actual en formato YYYY-MM (fecha local: evita el corrimiento de huso horario de toISOString). */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Etiqueta en español del mes, ej: "junio 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface MonthPickerProps {
  month: string;
  onChange: (month: string) => void;
}

export function MonthPicker({ month, onChange }: MonthPickerProps) {
  const isCurrent = month === currentMonthKey();
  return (
    <div className="mf-month-picker-row">
      <div className="mf-month-picker">
        <button
          type="button"
          className="mf-month-picker-arrow"
          aria-label="Mes anterior"
          onClick={() => onChange(shiftMonthKey(month, -1))}
        >
          ‹
        </button>
        <span className="mf-month-picker-label">{monthLabel(month)}</span>
        <button
          type="button"
          className="mf-month-picker-arrow"
          aria-label="Mes siguiente"
          disabled={isCurrent}
          onClick={() => onChange(shiftMonthKey(month, 1))}
        >
          ›
        </button>
      </div>
      {!isCurrent && (
        <button type="button" className="secondary mf-month-picker-today" onClick={() => onChange(currentMonthKey())}>
          Hoy
        </button>
      )}
    </div>
  );
}
