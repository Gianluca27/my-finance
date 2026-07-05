import type { Goal } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { COLOR_PALETTE, formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  ColorSwatchRow,
  EmptyState,
  ErrorText,
  FAB,
  Field,
  IconButton,
  Input,
  Meter,
  MutedText,
  OutlineButton,
  GhostButton,
  PrimaryButton,
  SummaryTile,
} from '../components/ui';

/** Ritmo de ahorro sugerido para llegar a la fecha objetivo. Null si no aplica. */
function pace(goal: Goal): string | null {
  if (!goal.targetDate || goal.remaining <= 0) return null;
  const msLeft = new Date(goal.targetDate).getTime() - Date.now();
  if (msLeft <= 0) return 'Fecha objetivo cumplida';
  const monthsLeft = Math.max(1, Math.ceil(msLeft / (30 * 86_400_000)));
  return `Ahorrá ${formatMoney(goal.remaining / monthsLeft)}/mes para llegar a tiempo`;
}

export function GoalsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAchieved, setShowAchieved] = useState(false);

  // --- Alta de meta ---
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [busy, setBusy] = useState(false);

  // --- Aporte ---
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribBusy, setContribBusy] = useState(false);

  const load = useCallback(() => {
    return api
      .listGoals()
      .then(setGoals)
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function resetForm() {
    setName('');
    setTargetAmount('');
    setTargetDate('');
    setIcon('');
    setColor(COLOR_PALETTE[0]);
  }

  async function onCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Ingresá un nombre para la meta.');
      return;
    }
    const amount = Number(targetAmount);
    if (!(amount > 0)) {
      setError('El monto objetivo debe ser mayor a 0.');
      return;
    }
    setBusy(true);
    try {
      await api.createGoal({
        name: name.trim(),
        targetAmount: amount,
        targetDate: targetDate || null,
        icon: icon || null,
        color,
      });
      setFormOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onStartContrib(goal: Goal) {
    setError(null);
    setContribGoal(goal);
    setContribAmount(goal.remaining > 0 ? String(goal.remaining) : '');
  }

  async function onConfirmContrib() {
    if (!contribGoal) return;
    setError(null);
    const amount = Number(contribAmount);
    if (!(amount > 0)) {
      setError('El monto del aporte debe ser mayor a 0.');
      return;
    }
    setContribBusy(true);
    try {
      await api.contributeGoal(contribGoal.id, amount);
      setContribGoal(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setContribBusy(false);
    }
  }

  function onDelete(goal: Goal) {
    Alert.alert(
      'Eliminar meta',
      '¿Eliminar esta meta? Los aportes ya registrados quedan como movimientos sueltos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            api
              .deleteGoal(goal.id)
              .then(load)
              .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado')),
        },
      ],
    );
  }

  const activeGoals = goals.filter((g) => !g.achievedAt);
  const achievedGoals = goals.filter((g) => g.achievedAt);
  const totalTarget = activeGoals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = activeGoals.reduce((sum, g) => sum + g.saved, 0);
  const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

  function renderGoalCard(goal: Goal) {
    const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.saved / goal.targetAmount) * 100)) : 100;
    const paceLabel = pace(goal);
    return (
      <View key={goal.id} style={styles.card}>
        <View style={styles.cardHead}>
          <View style={[styles.iconTile, { backgroundColor: `${goal.color}26` }]}>
            <Text style={styles.iconText}>{goal.icon ?? '🎯'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.goalName} numberOfLines={1}>
              {goal.name}
            </Text>
            <Text style={styles.goalStatus}>{goal.achievedAt ? '¡Lograda!' : `${pct}% ahorrado`}</Text>
          </View>
          <IconButton icon="🗑" color={colors.critical} onPress={() => onDelete(goal)} />
        </View>

        <Meter percent={pct} color={goal.color} />

        <View style={styles.cardFoot}>
          <Text style={styles.footMuted}>
            {formatMoney(goal.saved)} de {formatMoney(goal.targetAmount)}
          </Text>
          <Text style={styles.footMuted}>Faltan {formatMoney(goal.remaining)}</Text>
        </View>

        {paceLabel ? <MutedText style={{ fontSize: 12 }}>{paceLabel}</MutedText> : null}

        {!goal.achievedAt ? (
          <View style={{ marginTop: spacing.xs }}>
            <OutlineButton label="Registrar aporte" onPress={() => onStartContrib(goal)} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 96, gap: spacing.md }}>
        <ErrorText>{error}</ErrorText>

        <View style={styles.summaryRow}>
          <SummaryTile label="Ahorrado" value={formatMoney(totalSaved)} tone="good" />
          <SummaryTile label="Objetivo total" value={formatMoney(totalTarget)} />
          <SummaryTile label="Progreso" value={`${overallPct}%`} />
        </View>

        {activeGoals.length === 0 ? (
          <EmptyState text="Todavía no definiste metas de ahorro." />
        ) : (
          <View style={{ gap: spacing.sm }}>{activeGoals.map(renderGoalCard)}</View>
        )}

        {achievedGoals.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <GhostButton
              label={`${showAchieved ? 'Ocultar' : 'Ver'} logradas (${achievedGoals.length})`}
              onPress={() => setShowAchieved((v) => !v)}
            />
            {showAchieved ? <View style={{ gap: spacing.sm }}>{achievedGoals.map(renderGoalCard)}</View> : null}
          </View>
        ) : null}
      </ScrollView>

      <FAB onPress={() => setFormOpen(true)} />

      {/* Alta de meta */}
      <BottomSheet visible={formOpen} onClose={() => setFormOpen(false)} title="Nueva meta de ahorro">
        <ErrorText>{error}</ErrorText>
        <Field label="Nombre">
          <Input
            value={name}
            onChangeText={setName}
            maxLength={100}
            placeholder="Ej: Vacaciones, Fondo de emergencia…"
          />
        </Field>
        <Field label="Monto objetivo">
          <Input value={targetAmount} onChangeText={setTargetAmount} keyboardType="decimal-pad" placeholder="0" />
        </Field>
        <Field label="Fecha objetivo (opcional)">
          <Input value={targetDate} onChangeText={setTargetDate} placeholder="AAAA-MM-DD" autoCapitalize="none" />
        </Field>
        <Field label="Emoji (opcional)">
          <Input value={icon} onChangeText={setIcon} maxLength={4} placeholder="🎯" />
        </Field>
        <Field label="Color">
          <ColorSwatchRow value={color} onChange={setColor} palette={COLOR_PALETTE} />
        </Field>
        <PrimaryButton label="Crear meta" onPress={onCreate} busy={busy} />
      </BottomSheet>

      {/* Registrar aporte */}
      <BottomSheet visible={contribGoal !== null} onClose={() => setContribGoal(null)} title="Registrar aporte">
        <ErrorText>{error}</ErrorText>
        {contribGoal ? <MutedText>{contribGoal.name}</MutedText> : null}
        <Field label="Monto">
          <Input value={contribAmount} onChangeText={setContribAmount} keyboardType="decimal-pad" placeholder="0" />
        </Field>
        <PrimaryButton label="Aportar" onPress={onConfirmContrib} busy={contribBusy} />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    iconTile: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    iconText: { fontSize: 20 },
    goalName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    goalStatus: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    footMuted: { color: colors.textMuted, fontSize: 12 },
  });
}
