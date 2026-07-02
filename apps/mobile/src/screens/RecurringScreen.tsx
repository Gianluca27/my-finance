import type { RecurringExpense } from '@myfinance/shared';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, formatDate, formatMoney, spacing } from '../theme';

const FREQUENCY_LABEL = { WEEKLY: 'Semanal', MONTHLY: 'Mensual', YEARLY: 'Anual' } as const;

export function RecurringScreen() {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .listRecurring()
      .then(setItems)
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function onPay(item: RecurringExpense) {
    Alert.alert(
      'Registrar pago',
      `¿Registrar el pago de "${item.name}" por ${formatMoney(item.amount)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar', onPress: () => api.payRecurring(item.id).then(load).catch(() => {}) },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.md }}
        ListEmptyComponent={
          <Text style={styles.muted}>
            Sin gastos fijos. Crealos desde la app web para recibir recordatorios.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, !item.active && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {item.name}
                {!item.active ? ' (pausado)' : ''}
              </Text>
              <Text style={styles.rowSub}>
                {FREQUENCY_LABEL[item.frequency]} · vence {formatDate(item.nextDueDate)}
              </Text>
              <Text style={styles.amount}>{formatMoney(item.amount)}</Text>
            </View>
            <TouchableOpacity style={styles.payButton} onPress={() => onPay(item)}>
              <Text style={styles.payButtonText}>Registrar pago</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.page },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  error: { color: colors.critical, padding: spacing.sm, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTitle: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  amount: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginTop: 4 },
  payButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  payButtonText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
});
