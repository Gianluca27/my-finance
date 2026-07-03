import type { Category, TransactionType } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { invalidate, useCached } from '../cache';
import { Modal } from './Modal';

export function AddTransactionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: categoriesData } = useCached<Category[]>('categories', () => api.listCategories());
  const categories = (categoriesData ?? []).filter((c) => c.type === type);

  function reset() {
    setType('EXPENSE');
    setAmount('');
    setCategoryId('');
    setDate(new Date().toISOString().slice(0, 10));
    setNote('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('Ingresá un monto válido.');
      return;
    }
    setBusy(true);
    try {
      await api.createTransaction({
        type,
        amount: amt,
        date,
        note: note || null,
        categoryId: categoryId || null,
      });
      invalidate('transactions');
      invalidate('dashboard');
      invalidate('budgets');
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="Nuevo movimiento">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="error-banner">{error}</div>}
        <div className="mf-seg">
          <button
            type="button"
            className={type === 'EXPENSE' ? 'on expense' : ''}
            onClick={() => {
              setType('EXPENSE');
              setCategoryId('');
            }}
          >
            Gasto
          </button>
          <button
            type="button"
            className={type === 'INCOME' ? 'on income' : ''}
            onClick={() => {
              setType('INCOME');
              setCategoryId('');
            }}
          >
            Ingreso
          </button>
        </div>
        <label className="field">
          Monto
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            autoFocus
            required
          />
        </label>
        <label className="field">
          Categoría
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Fecha
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          Nota
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <button disabled={busy}>{busy ? 'Guardando…' : 'Guardar movimiento'}</button>
      </form>
    </Modal>
  );
}
