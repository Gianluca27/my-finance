import type { BudgetStatus, CategorySummary, DashboardData } from '@myfinance/shared';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { api } from '../api';
import {
  daysUntil,
  formatMoney,
  formatMoneyShort,
  monthName,
  monthProgress,
  shortMonthLabel,
  spacing,
  type ThemeColors,
} from '../theme';
import { useTheme } from '../ThemeContext';

const OTHERS_COLOR = '#5a6472';
const NW_HEIGHT = 120;

/** Paths (línea + área) del gráfico de patrimonio neto, en coordenadas 0..W / 0..H. */
function buildNetWorthPaths(points: { netWorth: number }[], w: number, h: number) {
  const padY = 14;
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => padY + (1 - (v - min) / range) * (h - padY * 2);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.netWorth).toFixed(1)}`).join(' ');
  return { line, area: `${line} L ${w.toFixed(1)} ${h} L 0 ${h} Z` };
}

/** Top 5 categorías + agregado "Otros". */
function topCategories(cats: CategorySummary[]): CategorySummary[] {
  const sorted = [...cats].sort((a, b) => b.total - a.total);
  if (sorted.length <= 6) return sorted;
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((sum, c) => sum + c.total, 0);
  return [...top, { categoryId: 'otros', categoryName: 'Otros', color: OTHERS_COLOR, total: rest }];
}

function Donut({ segments, total }: { segments: CategorySummary[]; total: number }) {
  const { colors } = useTheme();
  const size = 150;
  const stroke = 22;
  const r = size / 2 - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.gridline} strokeWidth={stroke} fill="none" />
          {total > 0 &&
            segments.map((seg) => {
              const len = (seg.total / total) * c;
              const el = (
                <Circle
                  key={seg.categoryId ?? seg.categoryName}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={seg.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 18 }}>
          {formatMoneyShort(total)}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>total</Text>
      </View>
    </View>
  );
}

export function DashboardScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const { width: winWidth } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [barHover, setBarHover] = useState<number | null>(null);

  const load = useCallback(() => {
    return Promise.all([api.dashboard(), api.listBudgets()])
      .then(([d, b]) => {
        setData(d);
        setBudgets(b);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const donut = useMemo(() => (data ? topCategories(data.expensesByCategory) : []), [data]);

  if (error && !data) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.muted}>Cargando resumen…</Text>
      </View>
    );
  }

  const monthLbl = monthName(data.month);
  const savingsRate = data.monthIncome > 0 ? Math.round(((data.monthIncome - data.monthExpense) / data.monthIncome) * 100) : 0;
  const prev = data.insights.previousMonthComparison?.total;
  const balDelta = prev ? prev.current - prev.previous : 0;
  const deltaUp = balDelta > 0;
  const { day, days } = monthProgress();
  const projected = data.insights.projectedMonthTotal;
  const expenseOfProjectedPct = projected && projected > 0 ? Math.round((data.monthExpense / projected) * 100) : 0;
  const maxBar = Math.max(1, ...data.monthlyComparison.map((m) => Math.max(m.income, m.expense)));
  const miniBudgets = [...budgets].sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 4);

  const nwTrend = data.netWorthTrend ?? [];
  const netWorthCurrent = nwTrend.length ? nwTrend[nwTrend.length - 1].netWorth : data.balance;
  const netWorthDelta = nwTrend.length >= 2 ? netWorthCurrent - nwTrend[0].netWorth : null;
  const netWorthUp = (netWorthDelta ?? 0) >= 0;
  const nwPaths = nwTrend.length >= 2 ? buildNetWorthPaths(nwTrend, winWidth - spacing.md * 4, NW_HEIGHT) : null;

  function dueInfo(iso: string) {
    const d = daysUntil(iso);
    if (d < 0) return { text: 'Vencido', color: colors.critical };
    if (d === 0) return { text: 'Vence hoy', color: colors.warning };
    return { text: `En ${d} días`, color: d <= 3 ? colors.warning : colors.textMuted };
  }

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Hero balance */}
      <View style={styles.card}>
        <Text style={styles.tileLabel}>Balance</Text>
        <Text style={[styles.hero, { color: data.balance >= 0 ? colors.deltaGood : colors.critical }]}>
          {formatMoney(data.balance)}
        </Text>
        {prev && (
          <Text style={{ color: deltaUp ? colors.critical : colors.deltaGood, fontSize: 13, marginTop: 2 }}>
            {deltaUp ? '▲' : '▼'} {formatMoney(Math.abs(balDelta))} vs. mes anterior
          </Text>
        )}
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Ingresos · {shortMonthLabel(data.month)}</Text>
            <Text style={[styles.statValue, { color: colors.deltaGood }]}>{formatMoney(data.monthIncome)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Gastos · {shortMonthLabel(data.month)}</Text>
            <Text style={[styles.statValue, { color: colors.expense }]}>{formatMoney(data.monthExpense)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Tasa de ahorro</Text>
            <Text style={styles.statValue}>{savingsRate}%</Text>
          </View>
        </View>
      </View>

      {/* Patrimonio neto */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Patrimonio neto · 12 meses</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Text style={styles.projValue}>{formatMoney(netWorthCurrent)}</Text>
          {netWorthDelta != null && (
            <Text style={{ color: netWorthUp ? colors.deltaGood : colors.critical, fontSize: 13, fontWeight: '600' }}>
              {netWorthUp ? '▲' : '▼'} {formatMoney(Math.abs(netWorthDelta))}
            </Text>
          )}
        </View>
        {nwPaths == null ? (
          <Text style={[styles.muted, { marginTop: spacing.sm }]}>Necesitás más historial para ver la tendencia.</Text>
        ) : (
          <>
            <Svg width={winWidth - spacing.md * 4} height={NW_HEIGHT} style={{ marginTop: spacing.sm }}>
              <Defs>
                <LinearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={nwPaths.area} fill="url(#nwGrad)" />
              <Path
                d={nwPaths.line}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </Svg>
            <View style={styles.nwLabels}>
              {nwTrend.map((p, i) => (
                <Text
                  key={p.month}
                  style={[styles.nwLabel, i === nwTrend.length - 1 && { color: colors.textSecondary, fontWeight: '700' }]}
                >
                  {i % 2 === 0 ? shortMonthLabel(p.month) : ''}
                </Text>
              ))}
            </View>
          </>
        )}
      </View>

      {/* Proyección + anomalías */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Proyección del mes</Text>
        {projected == null ? (
          <Text style={styles.muted}>Necesitás más historial para proyectar.</Text>
        ) : (
          <>
            <Text style={styles.projValue}>{formatMoney(projected)}</Text>
            <Text style={styles.muted}>gasto estimado</Text>
            <View style={styles.meter}>
              <View style={[styles.meterFill, { width: `${Math.round((day / days) * 100)}%`, backgroundColor: colors.accent }]} />
            </View>
            <Text style={styles.caption}>
              Día {day} de {days} · llevás gastado el {expenseOfProjectedPct}% de la proyección
            </Text>
          </>
        )}
        <View style={{ marginTop: spacing.sm, gap: 4 }}>
          {data.insights.anomalies.length === 0 ? (
            <Text style={{ color: colors.deltaGood, fontSize: 13 }}>
              ✅ Todo en orden — tus gastos siguen tu patrón habitual
            </Text>
          ) : (
            data.insights.anomalies.map((a) => (
              <View key={a.categoryId} style={styles.legendRow}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
                  ⚠ <Text style={{ fontWeight: '700' }}>{a.name}</Text> está por encima de tu promedio
                </Text>
                <Text style={{ color: colors.critical, fontWeight: '600', fontSize: 13 }}>
                  +{Math.round(a.percentOfAvg - 100)}%
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Disponible para gastar */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Disponible para gastar</Text>
        <Text style={[styles.hero, { color: data.safeToSpend.available < 0 ? colors.critical : colors.deltaGood }]}>
          {formatMoney(data.safeToSpend.available)}
        </Text>
        <Text style={styles.caption}>
          Balance {formatMoney(data.safeToSpend.balance)} − gastos fijos por venir{' '}
          {formatMoney(data.safeToSpend.committedExpenses)}
        </Text>
      </View>

      {/* Deudas */}
      <Pressable style={styles.card} onPress={() => nav.navigate('Más', { screen: 'Deudas' })}>
        <View style={styles.legendRow}>
          <Text style={styles.cardTitle}>Deudas</Text>
          <Text style={{ color: colors.accent, fontSize: 13 }}>Ver →</Text>
        </View>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Debo</Text>
            <Text style={[styles.statValue, { color: colors.critical }]}>{formatMoney(data.debtsSummary.totalIOwe)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Me deben</Text>
            <Text style={[styles.statValue, { color: colors.deltaGood }]}>{formatMoney(data.debtsSummary.totalOwedToMe)}</Text>
          </View>
        </View>
      </Pressable>

      {/* Donut gastos por categoría */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Gastos por categoría</Text>
        {data.expensesByCategory.length === 0 ? (
          <Text style={styles.muted}>Sin gastos este mes.</Text>
        ) : (
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <Donut segments={donut} total={data.monthExpense} />
            <View style={{ alignSelf: 'stretch', gap: 4 }}>
              {donut.map((seg) => (
                <View key={seg.categoryId ?? seg.categoryName} style={styles.legendRow}>
                  <View style={styles.legendName}>
                    <View style={[styles.dot, { backgroundColor: seg.color }]} />
                    <Text style={styles.legendText}>{seg.categoryName}</Text>
                  </View>
                  <Text style={styles.legendValue}>
                    {formatMoney(seg.total)} · {data.monthExpense > 0 ? Math.round((seg.total / data.monthExpense) * 100) : 0}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Ingresos vs gastos */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ingresos vs. gastos · {data.monthlyComparison.length} meses</Text>
        {barHover != null && data.monthlyComparison[barHover] && (
          <Text style={styles.caption}>
            {shortMonthLabel(data.monthlyComparison[barHover].month)} · ↑{formatMoney(data.monthlyComparison[barHover].income)} ·
            ↓{formatMoney(data.monthlyComparison[barHover].expense)}
          </Text>
        )}
        <View style={styles.barRow}>
          {data.monthlyComparison.map((m, i) => (
            <Pressable key={m.month} style={styles.barCol} onPress={() => setBarHover(i === barHover ? null : i)}>
              <View style={styles.barPair}>
                <View style={[styles.bar, { height: `${(m.income / maxBar) * 100}%`, backgroundColor: colors.income }]} />
                <View style={[styles.bar, { height: `${(m.expense / maxBar) * 100}%`, backgroundColor: colors.expense }]} />
              </View>
              <Text style={[styles.barLabel, i === data.monthlyComparison.length - 1 && { fontWeight: '700' }]}>
                {shortMonthLabel(m.month)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.legendRow, { justifyContent: 'flex-start', gap: spacing.md }]}>
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

      {/* Próximos pagos */}
      <View style={styles.card}>
        <View style={styles.legendRow}>
          <Text style={styles.cardTitle}>Próximos pagos</Text>
          <Text style={{ color: colors.accent, fontSize: 13 }} onPress={() => nav.navigate('Fijos')}>
            Ver todos →
          </Text>
        </View>
        {data.upcomingPayments.length === 0 ? (
          <Text style={styles.muted}>No hay vencimientos en los próximos 14 días.</Text>
        ) : (
          data.upcomingPayments.slice(0, 5).map((item) => {
            const info = dueInfo(item.nextDueDate);
            return (
              <View key={item.id} style={styles.legendRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendText}>
                    {item.category?.icon ?? '💳'} {item.name}
                  </Text>
                  <Text style={{ color: info.color, fontSize: 12 }}>{info.text}</Text>
                </View>
                <Text style={styles.legendValue}>{formatMoney(item.amount)}</Text>
              </View>
            );
          })
        )}
      </View>

      {/* Presupuestos del mes */}
      <View style={styles.card}>
        <View style={styles.legendRow}>
          <Text style={styles.cardTitle}>Presupuestos de {monthLbl}</Text>
          <Text style={{ color: colors.accent, fontSize: 13 }} onPress={() => nav.navigate('Presupuestos')}>
            Gestionar →
          </Text>
        </View>
        {miniBudgets.length === 0 ? (
          <Text style={styles.muted}>Todavía no configuraste presupuestos.</Text>
        ) : (
          miniBudgets.map((b) => {
            const over = b.percentUsed >= 100;
            const near = !over && b.percentUsed >= b.alertThreshold;
            const barColor = over ? colors.critical : near ? colors.warning : colors.accent;
            return (
              <View key={b.id} style={{ marginBottom: spacing.sm }}>
                <View style={styles.legendRow}>
                  <View style={styles.legendName}>
                    <View style={[styles.dot, { backgroundColor: b.category.color }]} />
                    <Text style={styles.legendText}>{b.category.name}</Text>
                  </View>
                  <Text style={styles.legendValue}>
                    {formatMoney(b.spent)} / {formatMoney(b.amount)}
                  </Text>
                </View>
                <View style={styles.meter}>
                  <View style={[styles.meterFill, { width: `${Math.min(100, b.percentUsed)}%`, backgroundColor: barColor }]} />
                </View>
              </View>
            );
          })
        )}
      </View>
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
    tileLabel: { fontSize: 13, color: colors.textMuted },
    hero: { fontSize: 30, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
    projValue: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
    statRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    stat: { flex: 1 },
    statLabel: { fontSize: 12, color: colors.textMuted },
    statValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
    muted: { color: colors.textMuted },
    caption: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
    error: { color: colors.critical, padding: spacing.md },
    legendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    legendName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendText: { color: colors.textSecondary, fontSize: 13 },
    legendValue: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    meter: { height: 6, borderRadius: 3, backgroundColor: colors.gridline, overflow: 'hidden', marginTop: 6 },
    meterFill: { height: '100%', borderRadius: 3 },
    barRow: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4, marginVertical: spacing.sm },
    barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    barPair: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 80 },
    bar: { width: 8, borderRadius: 2, minHeight: 2 },
    barLabel: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
    nwLabels: { flexDirection: 'row', marginTop: 6 },
    nwLabel: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 10 },
  });
}
