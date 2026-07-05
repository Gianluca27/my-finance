import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth';
import { Field, Input, PrimaryButton } from '../components/ui';
import { LogoMark } from '../components/icons';
import { fonts, radius, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

/**
 * Login con la misma estética que la web en pantallas angostas (el hero de la
 * web se oculta <720px, así que en teléfono se muestra solo el formulario).
 */
export function LoginScreen() {
  const { login, register } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Bienvenido de nuevo' : 'Creá tu cuenta';
  const subtitle =
    mode === 'login'
      ? 'Ingresá para ver tu panel financiero.'
      : 'Empezá a organizar tus finanzas hoy.';
  const cta = mode === 'login' ? 'Ingresar' : 'Crear cuenta';

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <LogoMark size={19} color={colors.onAccent} />
            </View>
            <Text style={styles.brandName}>MyFinance</Text>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {mode === 'register' && (
            <Field label="Nombre">
              <Input value={name} onChangeText={setName} maxLength={100} />
            </Field>
          )}
          <Field label="Email">
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </Field>
          <Field label="Contraseña">
            <Input value={password} onChangeText={setPassword} secureTextEntry />
          </Field>

          <View style={{ marginTop: spacing.xs }}>
            <PrimaryButton label={cta} onPress={onSubmit} busy={busy} />
          </View>

          <Text style={styles.switchText} onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? (
              <>
                ¿No tenés cuenta? <Text style={styles.switchLink}>Registrate</Text>
              </>
            ) : (
              <>
                ¿Ya tenés cuenta? <Text style={styles.switchLink}>Ingresá</Text>
              </>
            )}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
    form: { gap: spacing.sm + 4, maxWidth: 400, width: '100%', alignSelf: 'center' },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: spacing.sm },
    brandMark: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    title: { fontSize: 26, fontFamily: fonts.bold, color: colors.textPrimary, letterSpacing: -0.4 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.regular, marginBottom: spacing.xs },
    errorBanner: {
      backgroundColor: 'rgba(244,123,116,0.13)',
      borderRadius: radius.sm,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    errorText: { color: colors.critical, fontSize: 14, fontFamily: fonts.medium },
    switchText: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      textAlign: 'center',
      marginTop: spacing.sm,
      fontSize: 13.5,
    },
    switchLink: { color: colors.accent, fontFamily: fonts.semibold },
  });
}
