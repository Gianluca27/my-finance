import type { Category, Transaction, TransactionType } from '@myfinance/shared';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, formatDate, formatMoney, spacing } from '../theme';

export function TransactionsScreen() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [formType, setFormType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return api
      .listTransactions({ pageSize: 50 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  const formCategories = categories.filter((c) => c.type === formType);

  async function onSubmit() {
    const parsed = Number(amount.replace(',', '.'));
    if (!parsed || parsed <= 0) {
      setError('Ingresá un monto válido');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createTransaction({
        type: formType,
        amount: parsed,
        date: new Date().toISOString(),
        note: note || null,
        categoryId,
      });
      setAmount('');
      setNote('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onDelete(tx: Transaction) {
    Alert.alert('Eliminar', '¿Eliminar esta transacción?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => api.deleteTransaction(tx.id).then(load).catch(() => {}),
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={items}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: spacing.md }}
        ListEmptyComponent={<Text style={styles.muted}>Sin transacciones todavía.</Text>}
        renderItem={({ item: tx }) => (
          <TouchableOpacity style={styles.row} onLongPress={() => onDelete(tx)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <View
                style={[styles.dot, { backgroundColor: tx.category?.color ?? '#9ca3af' }]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{tx.category?.name ?? 'Sin categoría'}</Text>
                <Text style={styles.rowSub}>
                  {formatDate(tx.date)}
                  {tx.note ? ` · ${tx.note}` : ''}
                </Text>
              </View>
            </View>
            <Text
              style={[
                styles.rowAmount,
                { color: tx.type === 'INCOME' ? colors.deltaGood : colors.textPrimary },
              ]}
            >
              {tx.type === 'INCOME' ? '+' : '−'}
              {formatMoney(tx.amount)}
            </Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowForm(true)}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nueva transacción</Text>
            <View style={styles.segment}>
              {(['EXPENSE', 'INCOME'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.segmentItem, formType === t && styles.segmentActive]}
                  onPress={() => {
                    setFormType(t);
                    setCategoryId(null);
                  }}
                >
                  <Text
                    style={[styles.segmentText, formType === t && styles.segmentTextActive]}
                  >
                    {t === 'EXPENSE' ? 'Gasto' : 'Ingreso'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Monto"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {formCategories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, categoryId === c.id && styles.chipActive]}
                    onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  >
                    <View style={[styles.dot, { backgroundColor: c.color }]} />
                    <Text style={styles.chipText}>
                      {c.icon ? `${c.icon} ` : ''}
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Nota (opcional)"
              placeholderTextColor={colors.textMuted}
              value={note}
              onChangeText={setNote}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={busy}>
              <Text style={styles.buttonText}>{busy ? 'Guardando…' : 'Guardar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowForm(false)}>
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 8 }}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.page },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  error: { color: colors.critical, padding: spacing.sm, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md - 2,
    marginBottom: spacing.sm,
  },
  rowTitle: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowAmount: { fontWeight: '700', fontSize: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 26, lineHeight: 30 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  segment: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.gridline,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, padding: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: colors.gridline,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.gridline,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: 'rgba(42,120,214,0.10)' },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    padding: 13,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
