import type { Account, Category, CategorySuggestion, Transaction, TransactionType } from '@myfinance/shared';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { todayISODate } from '../theme';
import {
  BottomSheet,
  Chip,
  ErrorText,
  Field,
  Input,
  Option,
  PrimaryButton,
  Segmented,
  Select,
} from './ui';

/**
 * Modal compartido de alta/edición de movimientos. Sin `transaction` está en
 * modo alta; con `transaction` edita. Equivale al AddTransactionModal de web.
 */
export function AddTransactionModal({
  visible,
  onClose,
  transaction,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  transaction?: Transaction | null;
  onSaved: () => void;
}) {
  const editing = !!transaction;
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISODate());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null);

  useEffect(() => {
    if (!visible) return;
    api.listCategories().then(setCategories).catch(() => {});
    api.listAccounts().then(setAccounts).catch(() => {});
  }, [visible]);

  // Prefill al abrir según modo.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (transaction) {
      setType(transaction.type);
      setAmount(String(transaction.amount));
      setCategoryId(transaction.categoryId);
      setAccountId(transaction.accountId);
      setDate(transaction.date.slice(0, 10));
      setNote(transaction.note ?? '');
    } else {
      setType('EXPENSE');
      setAmount('');
      setCategoryId(null);
      setNote('');
      setDate(todayISODate());
    }
  }, [visible, transaction]);

  // Autoseleccionar cuenta por defecto al crear cuando cargan las cuentas.
  useEffect(() => {
    if (editing || accountId || accounts.length === 0) return;
    const def = accounts.find((a) => a.isDefault) ?? accounts[0];
    if (def) setAccountId(def.id);
  }, [accounts, editing, accountId]);

  // Con nota escrita y sin categoría elegida, pedir una sugerencia (con debounce).
  useEffect(() => {
    if (!visible || categoryId || note.trim().length < 3) {
      setSuggestion(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .suggestCategory(note.trim(), type)
        .then(setSuggestion)
        .catch(() => setSuggestion(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [visible, note, type, categoryId]);

  const suggestedCategory = useMemo(
    () =>
      suggestion
        ? (categories.find((c) => c.id === suggestion.categoryId && c.type === type) ?? null)
        : null,
    [suggestion, categories, type],
  );

  const catOptions: Option[] = [
    { label: 'Sin categoría', value: '' },
    ...categories
      .filter((c) => c.type === type)
      .map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
  ];
  const accOptions: Option[] = accounts.map((a) => ({ label: a.name, value: a.id, icon: a.icon }));

  async function onSubmit() {
    const parsed = Number(amount.replace(',', '.'));
    if (!parsed || parsed <= 0) {
      setError('Ingresá un monto válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type,
        amount: parsed,
        date: new Date(`${date}T00:00:00.000Z`).toISOString(),
        note: note || null,
        categoryId: categoryId || null,
        accountId: accountId || null,
      };
      if (transaction) await api.updateTransaction(transaction.id, payload);
      else await api.createTransaction(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}
    >
      <Segmented
        options={[
          { label: 'Gasto', value: 'EXPENSE' },
          { label: 'Ingreso', value: 'INCOME' },
        ]}
        value={type}
        onChange={(v) => {
          setType(v as TransactionType);
          setCategoryId(null);
        }}
      />
      <Field label="Monto">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0,00" />
      </Field>
      <Field label="Categoría">
        <Select
          value={categoryId ?? ''}
          options={catOptions}
          onChange={(v) => setCategoryId(v || null)}
          placeholder="Sin categoría"
        />
      </Field>
      {suggestedCategory && (
        <View style={{ flexDirection: 'row' }}>
          <Chip
            label={`✨ Sugerida: ${suggestedCategory.icon ? `${suggestedCategory.icon} ` : ''}${suggestedCategory.name}`}
            onPress={() => setCategoryId(suggestedCategory.id)}
          />
        </View>
      )}
      {accounts.length > 0 && (
        <Field label="Cuenta">
          <Select
            value={accountId}
            options={accOptions}
            onChange={setAccountId}
            placeholder="Elegí una cuenta"
          />
        </Field>
      )}
      <Field label="Fecha">
        <Input value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" autoCapitalize="none" />
      </Field>
      <Field label="Nota (opcional)">
        <Input value={note} onChangeText={setNote} maxLength={500} placeholder="Detalle" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={editing ? 'Guardar cambios' : 'Guardar movimiento'}
        onPress={onSubmit}
        busy={busy}
      />
      <View style={{ height: 4 }} />
    </BottomSheet>
  );
}
