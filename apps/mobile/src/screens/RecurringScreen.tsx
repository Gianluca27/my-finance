import type { Category, Frequency, RecurringExpense, TransactionType } from '@myfinance/shared';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { daysUntil, formatMoney, spacing, type ThemeColors } from '../theme';
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
  MutedText,
  OutlineButton,
  PrimaryButton,
  Segmented,
  Select,
  SummaryTile,
  type Option,
} from '../components/ui';

const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
};

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const FREQUENCY_OPTIONS: Option[] = [
  { label: 'Mensual', value: 'MONTHLY' },
  { label: 'Semanal', value: 'WEEKLY' },
  { label: 'Anual', value: 'YEARLY' },
];
const WEEKDAY_OPTIONS: Option[] = WEEKDAYS.map((d, i) => ({ label: d, value: String(i) }));
const MONTH_OPTIONS: Option[] = MONTHS.map((m, i) => ({ label: m, value: String(i + 1) }));

function dueLabel(item: RecurringExpense): string {
  if (item.frequency === 'WEEKLY') return `los ${WEEKDAYS[item.dueDay] ?? '?'}`;
  if (item.frequency === 'YEARLY') return `${item.dueDay} de ${MONTHS_SHORT[(item.dueMonth ?? 1) - 1]}`;
  return `día ${item.dueDay}`;
}

export function RecurringScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('1');
  const [dueMonth, setDueMonth] = useState('1');
  const [reminderDays, setReminderDays] = useState('3');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  const activeItems = items.filter((i) => i.active);
  const totalExpense = activeItems
    .filter((i) => i.type === 'EXPENSE')
    .reduce((sum, i) => sum + i.amount, 0);
  const totalIncome = activeItems
    .filter((i) => i.type === 'INCOME')
    .reduce((sum, i) => sum + i.amount, 0);

  const formCategories = categories.filter((c) => c.type === type);
  const categoryOptions: Option[] = [
    { label: 'Sin categoría', value: '' },
    ...formCategories.map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
  ];

  function openForm() {
    setFormError(null);
    setShowForm(true);
  }

  function onPay(item: RecurringExpense) {
    const isIncome = item.type === 'INCOME';
    const verb = isIncome ? 'cobro' : 'pago';
    Alert.alert(
      isIncome ? 'Registrar cobro' : 'Registrar pago',
      `¿Registrar el ${verb} de "${item.name}" por ${formatMoney(item.amount)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar', onPress: () => api.payRecurring(item.id).then(load).catch(() => {}) },
      ],
    );
  }

  function onToggle(item: RecurringExpense) {
    api
      .updateRecurring(item.id, { active: !item.active })
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }

  function onDelete(item: RecurringExpense) {
    Alert.alert('Eliminar', '¿Eliminar este movimiento fijo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => api.deleteRecurring(item.id).then(load).catch(() => {}),
      },
    ]);
  }

  async function onSubmit() {
    const parsed = Number(amount);
    if (!(parsed > 0)) {
      setFormError('Ingresá un monto válido.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.createRecurring({
        name,
        type,
        amount: parsed,
        frequency,
        dueDay: Number(dueDay),
        dueMonth: frequency === 'YEARLY' ? Number(dueMonth) : null,
        reminderDaysBefore: Number(reminderDays),
        categoryId: categoryId || null,
      });
      setName('');
      setAmount('');
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {error ? (
        <View style={styles.banner}>
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.md }}
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <SummaryTile
              label="Gastos fijos comprometidos"
              value={formatMoney(totalExpense)}
              tone="expense"
            />
            <SummaryTile
              label="Ingresos fijos esperados"
              value={formatMoney(totalIncome)}
              tone="income"
            />
          </View>
        }
        ListEmptyComponent={<EmptyState text="Todavía no cargaste movimientos fijos." />}
        ListFooterComponent={
          <MutedText style={styles.footnote}>
            Al registrar el pago se crea un movimiento y el próximo vencimiento avanza. Recibís un
            recordatorio por push y email según tus preferencias.
          </MutedText>
        }
        renderItem={({ item }) => {
          const isIncome = item.type === 'INCOME';
          const color = item.category?.color ?? colors.neutralDot;
          const icon = item.category?.icon ?? (isIncome ? '💵' : '💳');
          const d = daysUntil(item.nextDueDate);
          const badgeText = d < 0 ? 'Venció' : d === 0 ? 'Hoy' : `En ${d} días`;
          const badgeColor = d <= 3 ? colors.critical : colors.textMuted;
          return (
            <Card style={{ marginBottom: spacing.sm, opacity: item.active ? 1 : 0.5 }}>
              <View style={styles.cardRow}>
                <View style={[styles.iconCircle, { backgroundColor: `${color}26` }]}>
                  <Text style={styles.iconText}>{icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {item.name}
                    {!item.active ? ' (pausado)' : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {item.category?.name ?? 'Sin categoría'} · {FREQUENCY_LABEL[item.frequency]} ·{' '}
                    {dueLabel(item)}
                  </Text>
                </View>
                <View style={styles.rightCol}>
                  <Text style={[styles.badge, { color: badgeColor }]}>{badgeText}</Text>
                  <Text style={[styles.amount, isIncome && { color: colors.deltaGood }]}>
                    {isIncome ? '+' : ''}
                    {formatMoney(item.amount)}
                  </Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <OutlineButton
                  label={isIncome ? 'Cobrar' : 'Pagar'}
                  onPress={() => onPay(item)}
                />
                <View style={{ flex: 1 }} />
                <IconButton icon={item.active ? '⏸' : '▶'} onPress={() => onToggle(item)} />
                <IconButton icon="🗑" color={colors.critical} onPress={() => onDelete(item)} />
              </View>
            </Card>
          );
        }}
      />

      <FAB onPress={openForm} />

      <BottomSheet visible={showForm} onClose={() => setShowForm(false)} title="Nuevo movimiento fijo">
        <Field label="Tipo">
          <Segmented
            options={[
              { label: 'Gasto', value: 'EXPENSE' },
              { label: 'Ingreso', value: 'INCOME' },
            ]}
            value={type}
            onChange={(v) => {
              setType(v as TransactionType);
              setCategoryId('');
            }}
          />
        </Field>

        <Field label="Nombre">
          <Input
            value={name}
            onChangeText={setName}
            maxLength={100}
            placeholder={
              type === 'INCOME' ? 'Ej: Sueldo, Alquiler cobrado…' : 'Ej: Netflix, Alquiler…'
            }
          />
        </Field>

        <Field label="Monto">
          <Input
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </Field>

        <Field label="Frecuencia">
          <Select
            value={frequency}
            options={FREQUENCY_OPTIONS}
            onChange={(v) => setFrequency(v as Frequency)}
          />
        </Field>

        {frequency === 'WEEKLY' ? (
          <Field label="Día de la semana">
            <Select value={dueDay} options={WEEKDAY_OPTIONS} onChange={setDueDay} />
          </Field>
        ) : (
          <Field label="Día de vencimiento">
            <Input
              value={dueDay}
              onChangeText={setDueDay}
              keyboardType="number-pad"
              placeholder="1"
            />
          </Field>
        )}

        {frequency === 'YEARLY' ? (
          <Field label="Mes">
            <Select value={dueMonth} options={MONTH_OPTIONS} onChange={setDueMonth} />
          </Field>
        ) : null}

        <Field label="Recordar (días antes)">
          <Input
            value={reminderDays}
            onChangeText={setReminderDays}
            keyboardType="number-pad"
            placeholder="3"
          />
        </Field>

        <Field label="Categoría">
          <Select
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            placeholder="Sin categoría"
          />
        </Field>

        <ErrorText>{formError}</ErrorText>
        <PrimaryButton label="Guardar" onPress={onSubmit} busy={busy} />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    banner: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    footnote: { marginTop: spacing.md, textAlign: 'center' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconText: { fontSize: 18 },
    name: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rightCol: { alignItems: 'flex-end', gap: 4 },
    badge: { fontSize: 12, fontWeight: '600' },
    amount: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
  });
}
