import { useNavigation } from '@react-navigation/native';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fonts, radius, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  IcoDebt,
  IcoDoc,
  IcoSettings,
  IcoTag,
  IcoTarget,
  IcoWallet,
  type IconProps,
} from '../components/icons';

const ITEMS: { route: string; label: string; icon: (p: IconProps) => React.ReactElement; hint: string }[] = [
  { route: 'Cuentas', label: 'Cuentas', icon: IcoWallet, hint: 'Saldos, patrimonio y transferencias' },
  { route: 'Deudas', label: 'Deudas', icon: IcoDebt, hint: 'Lo que debés y te deben' },
  { route: 'Metas', label: 'Metas', icon: IcoTarget, hint: 'Ahorro por objetivos' },
  { route: 'Categorias', label: 'Categorías', icon: IcoTag, hint: 'Categorías y reglas automáticas' },
  { route: 'Reportes', label: 'Reportes', icon: IcoDoc, hint: 'Exportar e importar CSV/PDF' },
  { route: 'Preferencias', label: 'Preferencias', icon: IcoSettings, hint: 'Alertas y cuenta' },
];

export function MoreMenuScreen() {
  const nav = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      {ITEMS.map((it) => (
        <TouchableOpacity key={it.route} style={styles.row} onPress={() => nav.navigate(it.route)}>
          <View style={styles.iconWrap}>
            <it.icon color={colors.accent} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{it.label}</Text>
            <Text style={styles.hint}>{it.hint}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: radius.sm,
      backgroundColor: colors.chipActiveBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
    hint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
    chevron: { color: colors.textMuted, fontSize: 22 },
  });
}
