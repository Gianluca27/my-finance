import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { fonts, radius, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import { IcoPlus } from './icons';

/**
 * Kit de UI compartido para todas las pantallas del móvil. Cada componente se
 * auto-tematiza vía useTheme(); las pantallas solo componen estas piezas.
 */

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export function MutedText({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return <Text style={[{ color: colors.textMuted, fontSize: 13 }, style]}>{children}</Text>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  if (!children) return null;
  return <Text style={{ color: colors.critical, fontSize: 14 }}>{children}</Text>;
}

export function EmptyState({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg }}>
      {text}
    </Text>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'income' | 'expense' | 'good' | 'critical';
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  const toneColor =
    tone === 'income' || tone === 'good'
      ? colors.deltaGood
      : tone === 'expense'
        ? colors.expense
        : tone === 'critical'
          ? colors.critical
          : colors.textPrimary;
  return (
    <View style={[s.card, { flex: 1 }]}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, { color: toneColor }]}>{value}</Text>
    </View>
  );
}

export function Meter({
  percent,
  color,
  height = 8,
}: {
  percent: number;
  color?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const width = `${Math.max(0, Math.min(100, percent))}%` as const;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: colors.gridline, overflow: 'hidden' }}>
      <View style={{ height: '100%', borderRadius: height / 2, width, backgroundColor: color ?? colors.accent }} />
    </View>
  );
}

export type Option = { label: string; value: string; color?: string; icon?: string | null };

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.segmentItem, active && { backgroundColor: colors.accent }]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[s.segmentText, active && { color: colors.onAccent }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[s.chip, active && { borderColor: colors.accent, backgroundColor: colors.chipActiveBg }]}
      onPress={onPress}
    >
      {color ? <Dot color={color} /> : null}
      <Text style={[s.chipText, active && { color: colors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      {children}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return <TextInput placeholderTextColor={colors.textMuted} {...props} style={[s.input, props.style]} />;
}

/** Selector estilo <select>: muestra el valor actual y abre un bottom-sheet con las opciones. */
export function Select({
  value,
  options,
  onChange,
  placeholder = 'Seleccionar…',
}: {
  value: string | null;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <TouchableOpacity style={s.select} onPress={() => setOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          {selected?.color ? <Dot color={selected.color} /> : null}
          <Text style={{ color: selected ? colors.textPrimary : colors.textMuted, fontSize: 15 }} numberOfLines={1}>
            {selected ? `${selected.icon ? `${selected.icon} ` : ''}${selected.label}` : placeholder}
          </Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>▼</Text>
      </TouchableOpacity>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={placeholder}>
        <ScrollView style={{ maxHeight: 360 }}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <TouchableOpacity
                key={o.value}
                style={s.selectRow}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.color ? <Dot color={o.color} /> : null}
                <Text style={{ color: active ? colors.accent : colors.textPrimary, fontSize: 15, flex: 1 }}>
                  {o.icon ? `${o.icon} ` : ''}
                  {o.label}
                </Text>
                {active ? <Text style={{ color: colors.accent }}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

export function ColorSwatchRow({
  value,
  onChange,
  palette,
}: {
  value: string;
  onChange: (c: string) => void;
  palette: string[];
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {palette.map((c) => (
        <TouchableOpacity
          key={c}
          onPress={() => onChange(c)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: c,
            borderWidth: value === c ? 3 : 1,
            borderColor: value === c ? colors.textPrimary : colors.border,
          }}
        />
      ))}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[s.primaryBtn, (disabled || busy) && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={disabled || busy}
    >
      {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.primaryBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function GhostButton({
  label,
  onPress,
  tone = 'muted',
}: {
  label: string;
  onPress: () => void;
  tone?: 'muted' | 'accent' | 'critical';
}) {
  const { colors } = useTheme();
  const color = tone === 'accent' ? colors.accent : tone === 'critical' ? colors.critical : colors.textMuted;
  return (
    <TouchableOpacity onPress={onPress} style={{ padding: 10, alignItems: 'center' }}>
      <Text style={{ color, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Botón chico contorneado, para acciones por-fila (Pagar, Predeterminar, etc.). */
export function OutlineButton({
  label,
  onPress,
  tone = 'accent',
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'critical';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const color = tone === 'critical' ? colors.critical : colors.accent;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Botón de ícono (emoji/glyph). */
export function IconButton({
  icon,
  onPress,
  color,
  disabled,
}: {
  icon: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ padding: 6, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ fontSize: 16, color: color ?? colors.textSecondary }}>{icon}</Text>
    </TouchableOpacity>
  );
}

export function FAB({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={{
        position: 'absolute',
        right: 20,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
      }}
      onPress={onPress}
    >
      <IcoPlus color={colors.onAccent} size={26} />
    </TouchableOpacity>
  );
}

/** Modal deslizante desde abajo, con título y contenido desplazable. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.sheetBackdrop} onPress={onClose} />
      <View style={s.sheetCard}>
        <View style={s.sheetHandle} />
        <Text style={s.sheetTitle}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm + 2 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function baseStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    sectionTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.textPrimary, marginBottom: spacing.sm },
    tileLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.textMuted },
    tileValue: { fontSize: 22, fontFamily: fonts.mono, color: colors.textPrimary, marginTop: 2 },
    segment: {
      flexDirection: 'row',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    segmentItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segmentText: { color: colors.textSecondary, fontFamily: fonts.medium },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: 12,
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textPrimary,
      backgroundColor: colors.surface2,
    },
    select: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: 12,
      backgroundColor: colors.surface2,
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    primaryBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, padding: 13, alignItems: 'center' },
    primaryBtnText: { color: colors.onAccent, fontFamily: fonts.semibold, fontSize: 15 },
    sheetBackdrop: { flex: 1, backgroundColor: colors.overlay },
    sheetCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.md,
      borderTopRightRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.sm + 2,
      maxHeight: '88%',
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.sm,
    },
    sheetTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  });
}
