import type { BudgetStatus } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

export function BudgetsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .listBudgets()
      .then(setBudgets)
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.wrap}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={budgets}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: spacing.md }}
        ListEmptyComponent={
          <Text style={styles.muted}>
            Sin presupuestos. Definilos desde la app web para recibir alertas.
          </Text>
        }
        renderItem={({ item }) => {
          const over = item.percentUsed >= 100;
          const near = !over && item.percentUsed >= item.alertThreshold;
          return (
            <View style={styles.card}>
              <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.dot, { backgroundColor: item.category.color }]} />
                  <Text style={styles.title}>{item.category.name}</Text>
                </View>
                <Text style={styles.percent}>{item.percentUsed}%</Text>
              </View>
              <View style={styles.meter}>
                <View
                  style={[
                    styles.meterFill,
                    { width: `${Math.min(100, item.percentUsed)}%` },
                    over && { backgroundColor: colors.critical },
                    near && { backgroundColor: colors.warning },
                  ]}
                />
              </View>
              <Text style={styles.sub}>
                {formatMoney(item.spent)} de {formatMoney(item.amount)}
              </Text>
              {over && <Text style={[styles.status, { color: colors.critical }]}>⛔ Presupuesto superado</Text>}
              {near && (
                <Text style={[styles.status, { color: colors.warning }]}>
                  ⚠️ Cerca del límite ({item.alertThreshold}%)
                </Text>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
    error: { color: colors.critical, padding: spacing.sm, textAlign: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: 6,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    percent: { color: colors.textPrimary, fontWeight: '700' },
    sub: { color: colors.textMuted, fontSize: 12 },
    status: { fontWeight: '600', fontSize: 13 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    meter: { height: 8, borderRadius: 4, backgroundColor: colors.gridline, overflow: 'hidden' },
    meterFill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  });
}
