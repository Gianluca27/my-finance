import type { BudgetStatus, Category } from '@myfinance/shared';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { currentMonth, formatMoney, monthName, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  Card,
  EmptyState,
  ErrorText,
  FAB,
  Field,
  IconButton,
  Input,
  Meter,
  MutedText,
  PrimaryButton,
  Select,
  SummaryTile,
  type Option,
} from '../components/ui';

// Presupuesto global (spec 16) tiene category/categoryId null; el soporte mobile llega con spec 18.
type CategorizedBudget = BudgetStatus & { category: Category; categoryId: string };

export function BudgetsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [budgets, setBudgets] = useState<CategorizedBudget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Estado del formulario "Nuevo presupuesto".
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return api
      .listBudgets()
      .then((list) =>
        setBudgets(
          // Presupuesto global (spec 16) se filtra — soporte mobile llega con spec 18
          list.filter((b): b is CategorizedBudget => b.category != null),
        ),
      )
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Las categorías cambian poco: se cargan una sola vez.
  useEffect(() => {
    api
      .listCategories()
      .then((cs) => setCategories(cs.filter((c) => c.type === 'EXPENSE')))
      .catch(() => {});
  }, []);

  const categoryOptions: Option[] = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
    [categories],
  );

  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);

  // Días que quedan en el mes (incluyendo hoy) para repartir lo que resta del presupuesto.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);

  function openSheet() {
    setFormError(null);
    setSheetOpen(true);
  }

  async function onSubmit() {
    if (!categoryId) {
      setFormError('Elegí una categoría.');
      return;
    }
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setFormError('Ingresá un límite mayor a cero.');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await api.upsertBudget({
        categoryId,
        amount: parsedAmount,
        alertThreshold: Number(threshold),
      });
      setCategoryId(null);
      setAmount('');
      setThreshold('80');
      setSheetOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onDelete(id: string) {
    Alert.alert('Eliminar presupuesto', '¿Eliminar este presupuesto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          api
            .deleteBudget(id)
            .then(() => load())
            .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 96 }}>
        <ErrorText>{error}</ErrorText>

        <View style={styles.summaryRow}>
          <SummaryTile label="Presupuestado" value={formatMoney(totalBudgeted)} />
          <SummaryTile
            label={`Gastado · ${monthName(currentMonth())}`}
            value={formatMoney(totalSpent)}
            tone="expense"
          />
          <SummaryTile label="Restante" value={formatMoney(totalBudgeted - totalSpent)} tone="good" />
        </View>

        {budgets.length === 0 ? (
          <EmptyState text="Sin presupuestos todavía." />
        ) : (
          budgets.map((budget) => {
            const over = budget.percentUsed >= 100;
            const near = !over && budget.percentUsed >= budget.alertThreshold;
            const statusText = over ? 'Superado' : near ? 'Cerca del límite' : 'En camino';
            const statusColor = over ? colors.critical : near ? colors.warning : colors.textMuted;
            const meterColor = over ? colors.critical : near ? colors.warning : colors.accent;
            const remaining = Math.max(0, budget.amount - budget.spent);
            const perDay = remaining / daysLeft;
            return (
              <Card key={budget.id} style={{ marginBottom: 0, gap: 8 }}>
                <View style={styles.header}>
                  <View style={styles.headerLeft}>
                    <View style={[styles.iconBadge, { backgroundColor: `${budget.category.color}26` }]}>
                      <Text style={styles.iconText}>{budget.category.icon ?? '🏷️'}</Text>
                    </View>
                    <Text style={styles.title} numberOfLines={1}>
                      {budget.category.name}
                    </Text>
                  </View>
                  <View style={styles.rightCluster}>
                    <Text style={[styles.status, { color: statusColor }]} numberOfLines={1}>
                      {statusText}
                    </Text>
                    <Text style={styles.percent}>{budget.percentUsed}%</Text>
                    <IconButton icon="🗑" onPress={() => onDelete(budget.id)} color={colors.critical} />
                  </View>
                </View>

                <Meter percent={budget.percentUsed} color={meterColor} />

                <View style={styles.footRow}>
                  <Text style={styles.footText}>
                    {formatMoney(budget.spent)} de {formatMoney(budget.amount)}
                  </Text>
                  <Text style={styles.footText}>Quedan {formatMoney(remaining)}</Text>
                </View>

                {over ? (
                  <Text style={[styles.perDay, { color: colors.critical, fontWeight: '600' }]}>
                    Presupuesto superado
                  </Text>
                ) : (
                  <Text style={styles.perDay}>
                    {daysLeft} días para fin de mes ·{' '}
                    <Text style={{ color: colors.deltaGood, fontWeight: '600' }}>
                      {formatMoney(perDay)}/día disponible
                    </Text>
                  </Text>
                )}
              </Card>
            );
          })
        )}
      </ScrollView>

      <FAB onPress={openSheet} />

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Nuevo presupuesto">
        <ErrorText>{formError}</ErrorText>

        <Field label="Categoría">
          <Select
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            placeholder="Elegir categoría…"
          />
        </Field>

        <Field label="Límite mensual">
          <Input
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0,00"
          />
        </Field>

        <Field label="Umbral de alerta (%)">
          <Input value={threshold} onChangeText={setThreshold} keyboardType="numeric" placeholder="80" />
        </Field>

        <MutedText>Si la categoría ya tiene presupuesto, se actualiza.</MutedText>

        <PrimaryButton label="Guardar" onPress={onSubmit} busy={busy} />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    summaryRow: { flexDirection: 'row', gap: spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    iconBadge: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    iconText: { fontSize: 17 },
    title: { color: colors.textPrimary, fontWeight: '600', fontSize: 15, flexShrink: 1 },
    rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    status: { fontSize: 12, fontWeight: '600' },
    percent: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    footText: { color: colors.textMuted, fontSize: 12 },
    perDay: { color: colors.textMuted, fontSize: 12 },
  });
}
