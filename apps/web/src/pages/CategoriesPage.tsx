import type { Category, TransactionType } from '@myfinance/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [color, setColor] = useState('#6366f1');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listCategories().then(setCategories).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createCategory({ name, type, color, icon: icon || null });
      setName('');
      setIcon('');
      load();
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
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const expenseCategories = categories?.filter((c) => c.type === 'EXPENSE') ?? [];
  const incomeCategories = categories?.filter((c) => c.type === 'INCOME') ?? [];

  return (
    <>
      <h1 className="page-title">Categorías</h1>
      <p className="page-subtitle">Personalizá cómo clasificás tus movimientos</p>
      {error && <div className="error-banner">{error}</div>}

      <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
        <h3>Nueva categoría</h3>
        <div className="form-row">
          <label className="field" style={{ flex: 2 }}>
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
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
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              placeholder="🛒"
            />
          </label>
          <button disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </form>

      <div className="grid two-col">
        <div className="card">
          <h3>Gastos</h3>
          {expenseCategories.map((c) => (
            <div className="list-row" key={c.id}>
              <span className="cat-chip" style={{ fontSize: 14 }}>
                <span className="cat-dot" style={{ background: c.color }} />
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </span>
              <button className="danger" onClick={() => onDelete(c)}>
                Eliminar
              </button>
            </div>
          ))}
          {categories && expenseCategories.length === 0 && (
            <p className="muted">Sin categorías de gasto.</p>
          )}
        </div>
        <div className="card">
          <h3>Ingresos</h3>
          {incomeCategories.map((c) => (
            <div className="list-row" key={c.id}>
              <span className="cat-chip" style={{ fontSize: 14 }}>
                <span className="cat-dot" style={{ background: c.color }} />
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </span>
              <button className="danger" onClick={() => onDelete(c)}>
                Eliminar
              </button>
            </div>
          ))}
          {categories && incomeCategories.length === 0 && (
            <p className="muted">Sin categorías de ingreso.</p>
          )}
        </div>
      </div>
    </>
  );
}
