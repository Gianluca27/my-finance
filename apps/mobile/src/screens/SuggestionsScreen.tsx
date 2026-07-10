import type {
  Category,
  Frequency,
  RecurringSuggestion,
  RuleSuggestion,
  Suggestion,
} from '@myfinance/shared';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  Card,
  ErrorText,
  Field,
  Input,
  MutedText,
  OutlineButton,
  PrimaryButton,
  Select,
  type Option,
} from '../components/ui';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
};

const FREQUENCY_OPTIONS: Option[] = [
  { label: 'Mensual', value: 'MONTHLY' },
  { label: 'Semanal', value: 'WEEKLY' },
  { label: 'Anual', value: 'YEARLY' },
];
const WEEKDAY_OPTIONS: Option[] = WEEKDAYS.map((d, i) => ({ label: d, value: String(i) }));
const MONTH_OPTIONS: Option[] = MONTHS.map((m, i) => ({ label: m, value: String(i + 1) }));

function dueLabel(frequency: Frequency, dueDay: number, dueMonth: number | null): string {
  if (frequency === 'WEEKLY') return `los ${WEEKDAYS[dueDay] ?? '?'}`;
  if (frequency === 'YEARLY') return `${dueDay}/${dueMonth ?? 1}`;
  return `día ${dueDay}`;
}

export function SuggestionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Suggestion | null>(null);

  // Formulario del modal de aceptación (prefillado con lo detectado).
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('1');
  const [dueMonth, setDueMonth] = useState('1');
  const [reminderDays, setReminderDays] = useState('3');
  const [categoryId, setCategoryId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Correr la detección al entrar y quedarse con la lista resultante.
    return api
      .refreshSuggestions()
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch(() =>
        // Si el análisis falla, mostrar al menos las pendientes ya guardadas.
        api
          .listSuggestions()
          .then(setItems)
          .catch((err) => setError(err.message)),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  const isRecurring = accepting?.type === 'RECURRING';
  const recurringPayload = isRecurring ? (accepting as RecurringSuggestion).payload : null;

  function openAccept(s: Suggestion) {
    setFormError(null);
    if (s.type === 'RECURRING') {
      setName(s.payload.name);
      setAmount(String(s.payload.amount));
      setFrequency(s.payload.frequency);
      setDueDay(String(s.payload.dueDay));
      setDueMonth(String(s.payload.dueMonth ?? 1));
      setReminderDays('3');
      setCategoryId(s.payload.categoryId ?? '');
    } else {
      setKeyword(s.payload.keyword);
      setCategoryId(s.payload.categoryId);
    }
    setAccepting(s);
  }

  function onDismiss(s: Suggestion) {
    api
      .dismissSuggestion(s.id)
      .then(() => setItems((prev) => (prev ?? []).filter((i) => i.id !== s.id)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }

  async function onAccept() {
    if (!accepting) return;
    setBusy(true);
    setFormError(null);
    try {
      if (accepting.type === 'RECURRING') {
        await api.acceptSuggestion(accepting.id, {
          name,
          amount: Number(amount.replace(',', '.')),
          frequency,
          dueDay: Number(dueDay),
          dueMonth: frequency === 'YEARLY' ? Number(dueMonth) : null,
          reminderDaysBefore: Number(reminderDays),
          categoryId: categoryId || null,
        });
      } else {
        await api.acceptSuggestion(accepting.id, { keyword, categoryId });
      }
      setItems((prev) => (prev ?? []).filter((i) => i.id !== accepting.id));
      setAccepting(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  const recurring = (items ?? []).filter((s): s is RecurringSuggestion => s.type === 'RECURRING');
  const rules = (items ?? []).filter((s): s is RuleSuggestion => s.type === 'RULE');

  // Las categorías del formulario siguen el tipo del patrón; una regla acepta cualquiera.
  const formCategories = recurringPayload
    ? categories.filter((c) => c.type === recurringPayload.type)
    : categories;
  const categoryOptions: Option[] = [
    ...(isRecurring ? [{ label: 'Sin categoría', value: '' }] : []),
    ...formCategories.map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <Text style={styles.sectionTitle}>Movimientos fijos detectados</Text>
        <MutedText style={styles.hint}>
          Patrones que se repiten en tus movimientos de los últimos 6 meses y todavía no tenés como fijos.
        </MutedText>
        {!items ? (
          <MutedText>Analizando tu historial…</MutedText>
        ) : recurring.length === 0 ? (
          <MutedText>Nada nuevo por ahora.</MutedText>
        ) : (
          recurring.map((s) => (
            <Card key={s.id} style={{ marginBottom: spacing.sm }}>
              <View style={styles.cardRow}>
                <View style={styles.iconCircle}>
                  <Text style={styles.iconText}>{s.payload.type === 'INCOME' ? '💵' : '🔁'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.payload.name}</Text>
                  <Text style={styles.meta}>
                    {s.payload.occurrences} veces · {FREQUENCY_LABEL[s.payload.frequency]} ·{' '}
                    {dueLabel(s.payload.frequency, s.payload.dueDay, s.payload.dueMonth)} ·{' '}
                    {s.payload.categoryName ?? 'Sin categoría'}
                  </Text>
                </View>
                <Text style={[styles.amount, s.payload.type === 'INCOME' && { color: colors.deltaGood }]}>
                  {s.payload.type === 'INCOME' ? '+' : ''}
                  {formatMoney(s.payload.amount)}
                </Text>
              </View>
              <View style={styles.actionsRow}>
                <OutlineButton label="Crear fijo" onPress={() => openAccept(s)} />
                <OutlineButton label="Descartar" onPress={() => onDismiss(s)} />
              </View>
            </Card>
          ))
        )}

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Reglas de categoría sugeridas</Text>
        <MutedText style={styles.hint}>
          Palabras que venís categorizando siempre igual: con una regla se asignan solas al cargar.
        </MutedText>
        {!items ? (
          <MutedText>Analizando tu historial…</MutedText>
        ) : rules.length === 0 ? (
          <MutedText>Nada nuevo por ahora.</MutedText>
        ) : (
          rules.map((s) => (
            <Card key={s.id} style={{ marginBottom: spacing.sm }}>
              <View style={styles.cardRow}>
                <View style={styles.iconCircle}>
                  <Text style={styles.iconText}>🏷️</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    “{s.payload.keyword}” → {s.payload.categoryName ?? 'categoría'}
                  </Text>
                  <Text style={styles.meta}>Categorizaste así {s.payload.occurrences} movimientos</Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <OutlineButton label="Crear regla" onPress={() => openAccept(s)} />
                <OutlineButton label="Descartar" onPress={() => onDismiss(s)} />
              </View>
            </Card>
          ))
        )}

        <MutedText style={styles.footnote}>
          Las sugerencias se recalculan cada día y al entrar a esta pantalla. Lo que descartás no se vuelve a
          sugerir.
        </MutedText>
      </ScrollView>

      <BottomSheet
        visible={!!accepting}
        onClose={() => setAccepting(null)}
        title={isRecurring ? 'Crear movimiento fijo' : 'Crear regla de categoría'}
      >
        {isRecurring ? (
          <>
            <Field label="Nombre">
              <Input value={name} onChangeText={setName} maxLength={100} />
            </Field>
            <Field label="Monto">
              <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
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
                <Input value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" placeholder="1" />
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
          </>
        ) : (
          <Field label="Si la nota contiene">
            <Input value={keyword} onChangeText={setKeyword} maxLength={100} autoCapitalize="none" />
          </Field>
        )}
        <Field label="Categoría">
          <Select
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            placeholder={isRecurring ? 'Sin categoría' : 'Elegí una categoría'}
          />
        </Field>
        <ErrorText>{formError}</ErrorText>
        <PrimaryButton
          label={isRecurring ? 'Crear movimiento fijo' : 'Crear regla'}
          onPress={onAccept}
          busy={busy}
        />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    hint: { marginTop: 2, marginBottom: spacing.sm },
    footnote: { marginTop: spacing.md, textAlign: 'center' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(99,102,241,0.15)',
    },
    iconText: { fontSize: 18 },
    name: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    amount: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    actionsRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  });
}
