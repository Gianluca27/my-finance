import type { Category, CategoryRule, TransactionType } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { COLOR_PALETTE, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  Card,
  ColorSwatchRow,
  Dot,
  EmptyState,
  ErrorText,
  FAB,
  Field,
  IconButton,
  Input,
  MutedText,
  type Option,
  PrimaryButton,
  SectionTitle,
  Segmented,
  Select,
} from '../components/ui';

/**
 * Categorías: alta/baja de categorías (ingreso/gasto) y reglas de
 * categorización automática. Porteo de la CategoriesPage de la web.
 */
export function CategoriesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formulario "Nueva categoría".
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  // Formulario "Nueva regla".
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([api.listCategories(), api.listCategoryRules()])
      .then(([cats, rls]) => {
        setCategories(cats);
        setRules(rls);
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreate() {
    if (!name.trim()) {
      setError('Ingresá un nombre para la categoría.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.createCategory({ name: name.trim(), type, color, icon: icon || null });
      setName('');
      setIcon('');
      setType('EXPENSE');
      setColor(COLOR_PALETTE[0]);
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  function onDeleteCategory(category: Category) {
    Alert.alert(
      'Eliminar categoría',
      `¿Eliminar la categoría "${category.name}"? Sus transacciones quedarán sin categoría.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            api
              .deleteCategory(category.id)
              .then(load)
              .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado')),
        },
      ],
    );
  }

  async function onAddRule() {
    if (!ruleKeyword.trim() || !ruleCategoryId) return;
    setError(null);
    setRuleBusy(true);
    try {
      await api.createCategoryRule({ keyword: ruleKeyword.trim(), categoryId: ruleCategoryId });
      setRuleKeyword('');
      setRuleCategoryId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setRuleBusy(false);
    }
  }

  function onDeleteRule(rule: CategoryRule) {
    api
      .deleteCategoryRule(rule.id)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }

  const incomeCategories = categories.filter((c) => c.type === 'INCOME');
  const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');

  const categoryOptions: Option[] = categories.map((c) => ({
    label: `${c.name} (${c.type === 'INCOME' ? 'ingreso' : 'gasto'})`,
    value: c.id,
    color: c.color,
    icon: c.icon,
  }));

  function renderCategories(list: Category[], emptyText: string) {
    if (loaded && list.length === 0) {
      return <EmptyState text={emptyText} />;
    }
    return (
      <View style={styles.grid}>
        {list.map((c) => (
          <View key={c.id} style={styles.catCard}>
            <View style={styles.catCardHeader}>
              <Dot color={c.color} />
              <IconButton icon="🗑" color={colors.critical} onPress={() => onDeleteCategory(c)} />
            </View>
            <View style={[styles.catIcon, { backgroundColor: `${c.color}26` }]}>
              <Text style={styles.catIconText}>{c.icon || '🏷️'}</Text>
            </View>
            <Text style={styles.catName} numberOfLines={1}>
              {c.name}
            </Text>
            <MutedText style={{ fontSize: 12 }}>{c.transactionCount} movimientos</MutedText>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <ErrorText>{error}</ErrorText>

        <SectionTitle>Ingresos</SectionTitle>
        {renderCategories(incomeCategories, 'Sin categorías de ingreso.')}

        <View style={{ height: spacing.lg }} />

        <SectionTitle>Gastos</SectionTitle>
        {renderCategories(expenseCategories, 'Sin categorías de gasto.')}

        <Card style={{ marginTop: spacing.lg }}>
          <SectionTitle>Reglas de categorización automática</SectionTitle>
          <MutedText style={{ fontSize: 12.5, marginBottom: spacing.md }}>
            Cuando un movimiento nuevo (o importado) no tiene categoría, se le asigna la primera
            regla cuya palabra aparezca en la nota. La palabra más específica gana.
          </MutedText>

          <View style={{ gap: spacing.sm }}>
            <Field label="Si la nota contiene…">
              <Input
                value={ruleKeyword}
                onChangeText={setRuleKeyword}
                maxLength={100}
                placeholder="Ej: Uber, Netflix, Sueldo…"
              />
            </Field>
            <Field label="Asignar categoría">
              <Select
                value={ruleCategoryId}
                options={categoryOptions}
                onChange={setRuleCategoryId}
                placeholder="Elegir…"
              />
            </Field>
            <PrimaryButton
              label="Agregar regla"
              busy={ruleBusy}
              disabled={!ruleKeyword.trim() || !ruleCategoryId}
              onPress={onAddRule}
            />
          </View>

          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {rules.length === 0 ? (
              <MutedText>Todavía no definiste reglas.</MutedText>
            ) : (
              rules.map((rule) => (
                <View key={rule.id} style={styles.ruleRow}>
                  <View style={styles.ruleInfo}>
                    <Text style={styles.ruleKeyword} numberOfLines={1}>
                      “{rule.keyword}”
                    </Text>
                    <MutedText> → </MutedText>
                    <Dot color={rule.category.color} />
                    <Text style={styles.ruleCat} numberOfLines={1}>
                      {rule.category.icon ? `${rule.category.icon} ` : ''}
                      {rule.category.name}
                    </Text>
                  </View>
                  <IconButton icon="🗑" color={colors.critical} onPress={() => onDeleteRule(rule)} />
                </View>
              ))
            )}
          </View>
        </Card>
      </ScrollView>

      <FAB onPress={() => setFormOpen(true)} />

      <BottomSheet visible={formOpen} onClose={() => setFormOpen(false)} title="Nueva categoría">
        <ErrorText>{error}</ErrorText>
        <Field label="Nombre">
          <Input value={name} onChangeText={setName} maxLength={50} placeholder="Ej: Supermercado" />
        </Field>
        <Field label="Tipo">
          <Segmented
            options={[
              { label: 'Gasto', value: 'EXPENSE' },
              { label: 'Ingreso', value: 'INCOME' },
            ]}
            value={type}
            onChange={(v) => setType(v as TransactionType)}
          />
        </Field>
        <Field label="Color">
          <ColorSwatchRow value={color} onChange={setColor} palette={COLOR_PALETTE} />
        </Field>
        <Field label="Emoji (opcional)">
          <Input value={icon} onChangeText={setIcon} maxLength={4} placeholder="🛒" />
        </Field>
        <PrimaryButton label="Agregar" busy={busy} onPress={onCreate} />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.page },
    content: { padding: spacing.md, paddingBottom: 96 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    catCard: {
      flexGrow: 1,
      flexBasis: '46%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: 6,
    },
    catCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    catIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    catIconText: { fontSize: 20 },
    catName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    ruleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingLeft: spacing.sm,
      paddingRight: 2,
      paddingVertical: 4,
    },
    ruleInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
    ruleKeyword: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    ruleCat: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  });
}
