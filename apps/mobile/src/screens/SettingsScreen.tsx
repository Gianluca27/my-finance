import type { DigestFrequency } from '@myfinance/shared';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import { Card, ErrorText, SectionTitle, Segmented, type Option } from '../components/ui';

const DIGEST_OPTIONS: Option[] = [
  { label: 'Ninguno', value: 'NONE' },
  { label: 'Semanal', value: 'WEEKLY' },
  { label: 'Mensual', value: 'MONTHLY' },
  { label: 'Ambos', value: 'BOTH' },
];

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [emailAlerts, setEmailAlerts] = useState(user?.emailAlerts ?? true);
  const [pushAlerts, setPushAlerts] = useState(user?.pushAlerts ?? false);
  const [digestFrequency, setDigestFrequency] = useState<DigestFrequency>(
    user?.digestFrequency ?? 'MONTHLY',
  );
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: 'emailAlerts' | 'pushAlerts', next: boolean) {
    setError(null);
    if (key === 'emailAlerts') setEmailAlerts(next);
    else setPushAlerts(next);
    try {
      await api.updateAlertPreferences({ [key]: next });
    } catch (err) {
      // revertir ante error
      if (key === 'emailAlerts') setEmailAlerts(!next);
      else setPushAlerts(!next);
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    }
  }

  async function changeDigest(next: DigestFrequency) {
    const prev = digestFrequency;
    setError(null);
    setDigestFrequency(next);
    try {
      await api.updateAlertPreferences({ digestFrequency: next });
    } catch (err) {
      setDigestFrequency(prev);
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    }
  }

  const initial = (user?.name?.[0] ?? '?').toUpperCase();

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <ErrorText>{error}</ErrorText>

      <Card>
        <SectionTitle>Alertas</SectionTitle>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Alertas por email</Text>
            <Text style={styles.toggleHint}>
              Avisos de gastos fijos próximos a vencer y presupuestos excedidos.
            </Text>
          </View>
          <Switch
            value={emailAlerts}
            onValueChange={(v) => toggle('emailAlerts', v)}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Notificaciones push</Text>
            <Text style={styles.toggleHint}>
              Recordatorios en el celular antes de cada vencimiento.
            </Text>
          </View>
          <Switch
            value={pushAlerts}
            onValueChange={(v) => toggle('pushAlerts', v)}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <View style={styles.digestBlock}>
          <Text style={styles.toggleLabel}>Resumen periódico</Text>
          <Text style={styles.toggleHint}>
            Email con tus ingresos, gastos y categorías del período. Independiente de las alertas.
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <Segmented
              options={DIGEST_OPTIONS}
              value={digestFrequency}
              onChange={(v) => changeDigest(v as DigestFrequency)}
            />
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle>Cuenta</SectionTitle>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userEmail}>{user?.email}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    toggleLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    toggleHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    digestBlock: { paddingTop: spacing.sm + 2, borderTopWidth: 1, borderTopColor: colors.border },
    userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.onAccent, fontWeight: '700', fontSize: 18 },
    userName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    userEmail: { color: colors.textMuted, fontSize: 13 },
    logoutBtn: {
      borderWidth: 1,
      borderColor: colors.critical,
      borderRadius: 8,
      padding: 12,
      alignItems: 'center',
    },
    logoutText: { color: colors.critical, fontWeight: '600' },
  });
}
