import type { Category, Debt, DebtDirection } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { daysUntil, formatMoney, formatShortDate, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  Card,
  EmptyState,
  ErrorText,
  FAB,
  Field,
  GhostButton,
  IconButton,
  Input,
  Meter,
  MutedText,
  type Option,
  OutlineButton,
  PrimaryButton,
  SectionTitle,
  Segmented,
  Select,
  SummaryTile,
} from '../components/ui';

/** Etiqueta de la deuda en la tarjeta (según a quién le corresponde el saldo). */
const DIRECTION_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Debés',
  OWED_TO_ME: 'Te deben',
};

/** Etiqueta de la dirección en el formulario. */
const DIRECTION_FORM_LABEL: Record<DebtDirection, string> = {
  I_OWE: 'Yo debo',
  OWED_TO_ME: 'Me deben',
};

type DueTone = 'critical' | 'warning' | 'muted';

/** Badge de vencimiento a partir de los días restantes hasta la fecha. */
function dueBadge(dueDate: string): { text: string; tone: DueTone } {
  const d = daysUntil(dueDate);
  if (d < 0) return { text: 'Vencida', tone: 'critical' };
  if (d === 0) return { text: 'Vence hoy', tone: 'warning' };
  if (d <= 7) return { text: `Vence en ${d} día${d === 1 ? '' : 's'}`, tone: 'warning' };
  return { text: `Vence ${formatShortDate(dueDate)}`, tone: 'muted' };
}

const AVATAR_PALETTE = ['#f59e0b', '#ef4444', '#22c55e', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];

/** Color estable de avatar derivado del nombre. */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function DebtsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  // Formulario crear/editar.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [direction, setDirection] = useState<DebtDirection>('I_OWE');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  // Registrar pago.
  const [payingDebt, setPayingDebt] = useState<Debt | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([api.listDebts(), api.listCategories()])
      .then(([d, c]) => {
        setDebts(d);
        setCategories(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // El pago genera EXPENSE (I_OWE) o INCOME (OWED_TO_ME): la categoría elegible sigue esa dirección.
  const formCategories = categories.filter((c) => c.type === (direction === 'I_OWE' ? 'EXPENSE' : 'INCOME'));
  const categoryOptions: Option[] = [
    { label: 'Sin categoría', value: '' },
    ...formCategories.map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
  ];

  const all = debts ?? [];
  const activeDebts = all.filter((d) => !d.settledAt);
  const settledDebts = all.filter((d) => d.settledAt);
  // Deudas con vencimiento primero (más próximo/vencido arriba); sin fecha al final.
  const byDueDate = (a: Debt, b: Debt) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  };
  const oweDebts = activeDebts.filter((d) => d.direction === 'I_OWE').sort(byDueDate);
  const owedDebts = activeDebts.filter((d) => d.direction === 'OWED_TO_ME').sort(byDueDate);

  const totalIOwe = oweDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const totalOwedToMe = owedDebts.reduce((sum, d) => sum + d.remainingBalance, 0);
  const netBalance = totalOwedToMe - totalIOwe;

  function resetForm() {
    setEditingId(null);
    setDirection('I_OWE');
    setCounterparty('');
    setDescription('');
    setTotalAmount('');
    setCategoryId('');
    setDueDate('');
  }

  function onOpenCreate() {
    resetForm();
    setError(null);
    setFormOpen(true);
  }

  function onStartEdit(debt: Debt) {
    setEditingId(debt.id);
    setDirection(debt.direction);
    setCounterparty(debt.counterparty);
    setDescription(debt.description ?? '');
    setTotalAmount(String(debt.totalAmount));
    setCategoryId(debt.categoryId ?? '');
    setDueDate(debt.dueDate ? debt.dueDate.slice(0, 10) : '');
    setError(null);
    setFormOpen(true);
  }

  function onCloseForm() {
    setFormOpen(false);
    resetForm();
  }

  async function onSubmit() {
    if (!counterparty.trim()) {
      setError('Ingresá la persona o entidad');
      return;
    }
    const total = Number(totalAmount.replace(',', '.'));
    if (!total || total <= 0) {
      setError('Ingresá un monto válido');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payload = {
        counterparty: counterparty.trim(),
        description: description || null,
        totalAmount: total,
        categoryId: categoryId || null,
        dueDate: dueDate || null,
      };
      if (editingId) {
        await api.updateDebt(editingId, payload);
      } else {
        await api.createDebt({ direction, ...payload });
      }
      onCloseForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onStartPay(debt: Debt) {
    setPayingDebt(debt);
    setPayAmount(String(debt.remainingBalance));
    setError(null);
  }

  async function onConfirmPay() {
    if (!payingDebt) return;
    const amount = Number(payAmount.replace(',', '.'));
    if (!amount || amount <= 0 || amount > payingDebt.remainingBalance) {
      setError('Ingresá un monto válido (no mayor al saldo)');
      return;
    }
    setError(null);
    setPayBusy(true);
    try {
      await api.payDebt(payingDebt.id, amount);
      setPayingDebt(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setPayBusy(false);
    }
  }

  function onDelete(debt: Debt) {
    Alert.alert(
      'Eliminar deuda',
      '¿Eliminar esta deuda? Los pagos ya registrados quedan como movimientos sueltos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            api
              .deleteDebt(debt.id)
              .then(load)
              .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado')),
        },
      ],
    );
  }

  const badgeColor = (tone: DueTone) =>
    tone === 'critical' ? colors.critical : tone === 'warning' ? colors.warning : colors.textMuted;

  function renderDebtCard(debt: Debt) {
    const settled = debt.settledAt !== null;
    const color = avatarColor(debt.counterparty);
    const percent = debt.totalAmount > 0 ? ((debt.totalAmount - debt.remainingBalance) / debt.totalAmount) * 100 : 100;
    const meterColor = debt.direction === 'I_OWE' ? colors.expense : colors.income;
    const badge = debt.dueDate ? dueBadge(debt.dueDate) : null;
    return (
      <Card key={debt.id} style={{ gap: spacing.sm }}>
        <View style={styles.debtHead}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{debt.counterparty.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.debtName} numberOfLines={1}>
              {debt.counterparty}
            </Text>
            <Text style={styles.debtDesc} numberOfLines={1}>
              {debt.description || DIRECTION_LABEL[debt.direction]}
            </Text>
          </View>
          {!settled && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.remaining}>{formatMoney(debt.remainingBalance)}</Text>
              <Text style={styles.total}>de {formatMoney(debt.totalAmount)}</Text>
            </View>
          )}
        </View>

        {settled ? (
          <MutedText>Saldada · {formatMoney(debt.totalAmount)}</MutedText>
        ) : (
          <>
            <View style={styles.metaRow}>
              {badge ? (
                <View style={[styles.badge, { borderColor: badgeColor(badge.tone) }]}>
                  <Text style={[styles.badgeText, { color: badgeColor(badge.tone) }]}>{badge.text}</Text>
                </View>
              ) : (
                <View />
              )}
              <View style={{ flexDirection: 'row' }}>
                <IconButton icon="✎" onPress={() => onStartEdit(debt)} />
                <IconButton icon="🗑" onPress={() => onDelete(debt)} color={colors.critical} />
              </View>
            </View>
            <Meter percent={percent} color={meterColor} />
            <OutlineButton label="Registrar pago" onPress={() => onStartPay(debt)} />
          </>
        )}
      </Card>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ErrorText>{error}</ErrorText>

        <View style={styles.summaryRow}>
          <SummaryTile label="Debo" value={formatMoney(totalIOwe)} tone="critical" />
          <SummaryTile label="Me deben" value={formatMoney(totalOwedToMe)} tone="good" />
          <SummaryTile
            label="Balance neto"
            value={`${netBalance < 0 ? '−' : ''}${formatMoney(Math.abs(netBalance))}`}
            tone={netBalance < 0 ? 'critical' : 'good'}
          />
        </View>

        {debts === null ? (
          <MutedText>Cargando…</MutedText>
        ) : activeDebts.length === 0 ? (
          <EmptyState text="No hay deudas activas." />
        ) : (
          <>
            <View>
              <SectionTitle>Debo</SectionTitle>
              <View style={{ gap: spacing.sm }}>
                {oweDebts.length === 0 ? (
                  <MutedText>Nada pendiente.</MutedText>
                ) : (
                  oweDebts.map(renderDebtCard)
                )}
              </View>
            </View>
            <View>
              <SectionTitle>Me deben</SectionTitle>
              <View style={{ gap: spacing.sm }}>
                {owedDebts.length === 0 ? (
                  <MutedText>Nada pendiente.</MutedText>
                ) : (
                  owedDebts.map(renderDebtCard)
                )}
              </View>
            </View>
          </>
        )}

        {settledDebts.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <GhostButton
              label={`${showSettled ? 'Ocultar' : 'Ver'} saldadas (${settledDebts.length})`}
              onPress={() => setShowSettled((v) => !v)}
            />
            {showSettled && <View style={{ gap: spacing.sm }}>{settledDebts.map(renderDebtCard)}</View>}
          </View>
        )}
      </ScrollView>

      <FAB onPress={onOpenCreate} />

      <BottomSheet
        visible={formOpen}
        onClose={onCloseForm}
        title={editingId ? 'Editar deuda' : 'Nueva deuda'}
      >
        <Field label="Dirección">
          {editingId ? (
            <Text style={styles.staticDirection}>{DIRECTION_FORM_LABEL[direction]}</Text>
          ) : (
            <Segmented
              options={[
                { label: 'Yo debo', value: 'I_OWE' },
                { label: 'Me deben', value: 'OWED_TO_ME' },
              ]}
              value={direction}
              onChange={(v) => {
                setDirection(v as DebtDirection);
                setCategoryId('');
              }}
            />
          )}
        </Field>
        <Field label="Persona/entidad">
          <Input
            value={counterparty}
            onChangeText={setCounterparty}
            maxLength={100}
            placeholder="Ej: Juan, tarjeta…"
          />
        </Field>
        <Field label="Monto total">
          <Input value={totalAmount} onChangeText={setTotalAmount} keyboardType="decimal-pad" placeholder="0" />
        </Field>
        <Field label="Categoría">
          <Select value={categoryId} options={categoryOptions} onChange={setCategoryId} placeholder="Sin categoría" />
        </Field>
        <Field label="Vencimiento">
          <Input value={dueDate} onChangeText={setDueDate} placeholder="AAAA-MM-DD" autoCapitalize="none" />
        </Field>
        <Field label="Descripción">
          <Input value={description} onChangeText={setDescription} maxLength={500} placeholder="Opcional" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          label={editingId ? 'Guardar cambios' : 'Agregar deuda'}
          onPress={onSubmit}
          busy={busy}
        />
      </BottomSheet>

      <BottomSheet visible={payingDebt !== null} onClose={() => setPayingDebt(null)} title="Registrar pago">
        {payingDebt && (
          <>
            <MutedText>Saldo pendiente: {formatMoney(payingDebt.remainingBalance)}</MutedText>
            <Field label="Monto">
              <Input value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />
            </Field>
            <ErrorText>{error}</ErrorText>
            <PrimaryButton label="Confirmar" onPress={onConfirmPay} busy={payBusy} />
          </>
        )}
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { padding: spacing.md, paddingBottom: 96, gap: spacing.md },
    summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    debtHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    debtName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    debtDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    remaining: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    total: { color: colors.textMuted, fontSize: 12 },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    badge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
    badgeText: { fontSize: 12, fontWeight: '600' },
    staticDirection: { color: colors.textPrimary, fontSize: 15, paddingVertical: 10 },
  });
}
