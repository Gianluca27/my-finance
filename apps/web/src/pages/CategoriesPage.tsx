import type { Category, TransactionType } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { invalidate, useCached } from '../cache';
import { IcoPlus, IcoTrash } from '../components/icons';
import { Modal } from '../components/Modal';

export function CategoriesPage() {
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [color, setColor] = useState('#6366f1');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: categories, error: loadError, refresh } = useCached<Category[]>('categories', () =>
    api.listCategories(),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createCategory({ name, type, color, icon: icon || null });
      setName('');
      setIcon('');
      setFormOpen(false);
      invalidate('categories');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(category: Category) {
    if (
      !confirm(
        `¿Eliminar la categoría "${category.name}"? Sus transacciones quedarán sin categoría.`,
      )
    )
      return;
    try {
      await api.deleteCategory(category.id);
      // Borrar una categoría toca transacciones, presupuestos y recurrentes: limpiar todo.
      invalidate();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const expenseCategories = categories?.filter((c) => c.type === 'EXPENSE') ?? [];
  const incomeCategories = categories?.filter((c) => c.type === 'INCOME') ?? [];

  function renderGrid(list: Category[], emptyText: string) {
    if (categories && list.length === 0) return <p className="muted">{emptyText}</p>;
    return (
      <div className="mf-cat-grid">
        {list.map((c) => (
          <div className="card mf-cat-card" key={c.id}>
            <span className="mf-cat-dot" style={{ background: c.color }} />
            <button
              type="button"
              className="mf-cat-delete"
              aria-label={`Eliminar categoría ${c.name}`}
              onClick={() => onDelete(c)}
            >
              <IcoTrash size={13} />
            </button>
            <div className="mf-cat-icon" style={{ background: `${c.color}26` }}>
              {c.icon || '🏷️'}
            </div>
            <div className="mf-cat-name">{c.name}</div>
            <div className="mf-cat-count">{c.transactionCount} movimientos</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      <div className="mf-eyebrow" style={{ marginBottom: 12 }}>
        Ingresos
      </div>
      {renderGrid(incomeCategories, 'Sin categorías de ingreso.')}

      <div className="mf-eyebrow" style={{ margin: '24px 0 12px' }}>
        Gastos
      </div>
      {renderGrid(expenseCategories, 'Sin categorías de gasto.')}

      <button type="button" className="mf-add-btn" style={{ marginTop: 24 }} onClick={() => setFormOpen(true)}>
        <IcoPlus />
        <span className="mf-add-label">Nueva Categoría</span>
      </button>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nueva categoría">
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} autoFocus />
          </label>
          <label className="field">
            Tipo
            <select value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
              <option value="EXPENSE">Gasto</option>
              <option value="INCOME">Ingreso</option>
            </select>
          </label>
          <label className="field">
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="field">
            Emoji (opcional)
            <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="🛒" />
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </form>
      </Modal>
    </>
  );
}
