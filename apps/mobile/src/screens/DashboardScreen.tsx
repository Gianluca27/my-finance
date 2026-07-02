import type { DashboardData } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { formatDate, formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

export function DashboardScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    return api
      .dashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const totalExpenses = data?.expensesByCategory.reduce((sum, c) => sum + c.total, 0) ?? 0;

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error && <Text style={styles.error}>{error}</Text>}
      {!data ? (
        <Text style={styles.muted}>Cargando…</Text>
      ) : (
        <>
          <View style={styles.tileRow}>
            <View style={[styles.card, styles.tile]}>
              <Text style={styles.tileLabel}>Balance</Text>
              <Text
                style={[
                  styles.tileValue,
                  { color: data.balance >= 0 ? colors.deltaGood : colors.critical },
                ]}
              >
                {formatMoney(data.balance)}
              </Text>
            </View>
          </View>
          <View style={styles.tileRow}>
            <View style={[styles.card, styles.tile]}>
              <Text style={styles.tileLabel}>Ingresos del mes</Text>
              <Text style={styles.tileValue}>{formatMoney(data.monthIncome)}</Text>
            </View>
            <View style={[styles.card, styles.tile]}>
              <Text style={styles.tileLabel}>Gastos del mes</Text>
              <Text style={styles.tileValue}>{formatMoney(data.monthExpense)}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Gastos por categoría</Text>
            {data.expensesByCategory.length === 0 ? (
              <Text style={styles.muted}>Sin gastos este mes.</Text>
            ) : (
              data.expensesByCategory.map((cat) => {
                const percent = totalExpenses > 0 ? cat.total / totalExpenses : 0;
                return (
                  <View key={cat.categoryId ?? 'none'} style={{ marginBottom: spacing.sm }}>
                    <View style={styles.legendRow}>
                      <View style={styles.legendName}>
                        <View style={[styles.dot, { backgroundColor: cat.color }]} />
                        <Text style={styles.legendText}>{cat.categoryName}</Text>
                      </View>
                      <Text style={styles.legendValue}>
                        {formatMoney(cat.total)} · {Math.round(percent * 100)}%
                      </Text>
                    </View>
                    <View style={styles.meter}>
                      <View
                        style={[
                          styles.meterFill,
                          { width: `${Math.round(percent * 100)}%`, backgroundColor: cat.color },
                        ]}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Comparativa mes a mes</Text>
            {data.monthlyComparison.map((m) => {
              const max = Math.max(
                1,
                ...data.monthlyComparison.map((x) => Math.max(x.income, x.expense)),
              );
              return (
                <View key={m.month} style={{ marginBottom: spacing.sm }}>
                  <Text style={styles.legendText}>{m.month}</Text>
                  <View style={styles.meter}>
                    <View
                      style={[
                        styles.meterFill,
                        { width: `${Math.round((m.income / max) * 100)}%`, backgroundColor: colors.income },
                      ]}
                    />
                  </View>
                  <View style={[styles.meter, { marginTop: 2 }]}>
                    <View
                      style={[
                        styles.meterFill,
                        { width: `${Math.round((m.expense / max) * 100)}%`, backgroundColor: colors.expense },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
            <View style={styles.legendRow}>
              <View style={styles.legendName}>
                <View style={[styles.dot, { backgroundColor: colors.income }]} />
                <Text style={styles.legendText}>Ingresos</Text>
              </View>
              <View style={styles.legendName}>
                <View style={[styles.dot, { backgroundColor: colors.expense }]} />
                <Text style={styles.legendText}>Gastos</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Próximos pagos (14 días)</Text>
            {data.upcomingPayments.length === 0 ? (
              <Text style={styles.muted}>No hay pagos próximos. 🎉</Text>
            ) : (
              data.upcomingPayments.map((item) => (
                <View key={item.id} style={styles.legendRow}>
                  <Text style={styles.legendText}>
                    {item.name} · vence {formatDate(item.nextDueDate)}
                  </Text>
                  <Text style={styles.legendValue}>{formatMoney(item.amount)}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
    tileRow: { flexDirection: 'row', gap: spacing.md },
    tile: { flex: 1 },
    tileLabel: { fontSize: 13, color: colors.textMuted },
    tileValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
    muted: { color: colors.textMuted },
    error: { color: colors.critical },
    legendRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    legendName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendText: { color: colors.textSecondary, fontSize: 13 },
    legendValue: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    meter: { height: 6, borderRadius: 3, backgroundColor: colors.gridline, overflow: 'hidden' },
    meterFill: { height: '100%', borderRadius: 3 },
  });
}
