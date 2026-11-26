import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TextInputProps, Pressable, Switch, StyleSheet, TouchableOpacity, ActivityIndicator, ViewStyle,
  useWindowDimensions, ScrollView, Animated, Easing, StyleProp,
} from 'react-native';
import { AdaptiveModal as Modal } from './AdaptiveModal';
import { useV3Theme, v3Radius, v3Spacing, v3Type } from '../../theme/v3';
import { Card } from './Card';
import Icon, { IconName } from './Icon';
import { useReducedMotion, useVisibilityMotion } from '../../theme/motion';

// ── Section — a Card with an optional title/description ────────────────────
export function Section({
  title, description, children, style,
}: { title?: string; description?: string; children?: React.ReactNode; style?: ViewStyle }) {
  const t = useV3Theme();
  return (
    <Card style={[{ marginBottom: v3Spacing.medium }, style]}>
      {!!title && (
        <Text accessibilityRole="header" style={{ fontSize: v3Type.heading, fontWeight: '700', color: t.text, marginBottom: description ? 6 : 8 }}>
          {title}
        </Text>
      )}
      {!!description && (
        <Text style={{ fontSize: v3Type.body, color: t.mutedText, marginBottom: 8 }}>
          {description}
        </Text>
      )}
      {children}
    </Card>
  );
}

// ── Button — filled (primary) / outline (secondary) / text (tertiary) ─────
type ButtonVariant = 'filled' | 'outline' | 'text';
export function Button({
  label, onPress, disabled, loading, busy, danger, accent, icon, variant = 'filled', tone = 'default', grow = true, style,
}: {
  label: string; onPress: () => void; disabled?: boolean;
  // Working (André, 2026-11-02, desktop picks #5, RoundedButton.busy): the label stays, so the
  // button keeps its name, three dots pulse after it, and taps are ignored until it's done.
  // `loading` is the older name for the same thing. Use it instead of swapping the label to
  // "Saving…".
  loading?: boolean; busy?: boolean;
  // Delete / Remove / Forget (desktop picks #5, RoundedButton.danger): a calm red - 10% red
  // fill, red hairline, bold red label. tone='alert' is the older name for the same thing.
  danger?: boolean;
  // The one main action, filled green (RoundedButton.accent), e.g. an empty page's button.
  accent?: boolean;
  icon?: IconName; variant?: ButtonVariant; tone?: 'default' | 'alert'; grow?: boolean; style?: ViewStyle;
}) {
  const t = useV3Theme();
  const isBusy = !!(busy || loading);
  const isDanger = !!danger || tone === 'alert';
  const isText = variant === 'text';
  const isAccent = !!accent && !isDanger && !isText;
  const inactive = !!disabled || isBusy;
  const fg = isDanger ? t.error : isAccent ? t.card : t.primary;
  const bg = isText ? 'transparent'
    : isDanger ? t.error + '14'
    : isAccent ? t.primary
    : variant === 'filled' ? t.primary + '13' : t.cardNested;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled && !isBusy, busy: isBusy }}
      style={({ pressed }) => [
        {
          minHeight: 44, flexGrow: grow ? 1 : 0, flexShrink: 1,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          paddingVertical: 10, paddingHorizontal: v3Spacing.medium, borderRadius: v3Radius.small,
          backgroundColor: bg, opacity: disabled && !isBusy ? 0.48 : pressed ? 0.72 : 1,
        },
        style,
      ]}
    >
      {!!icon && !isBusy && <Icon name={icon} size={18} color={fg} />}
      {isBusy && <ActivityIndicator size="small" color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: v3Type.body, flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useV3Theme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: t.borderStrong, true: t.primary }}
      ios_backgroundColor={t.borderStrong}
    />
  );
}

// ── Dropdown — a value picker matching desktop's RoundedComboBox.qml ───────
// 2026-08-16 (André: "on desktop we have dropdown menus"). SuuntoLink (and desktop, off the
// same tools/settings_write.py AMBIT3_DISPLAY table) shows a settings field with a long list
// of choices - Language, GPS position format, Backlight mode - as a dropdown, not the chip
// row Android was rendering for every enum. Styled after RoundedComboBox.qml: a card-surfaced
// box with a 1px Theme.mutedText border, the current label + a chevron, opening a bordered
// card menu whose selected row is tinted 12% Theme.primary (the popup highlight desktop uses,
// Qt.alpha(Theme.primary, 0.12); '1F' is 12% in React Native's #RRGGBBAA).
export function Dropdown({
  value, choices, onSelect, disabled,
}: {
  value: number;
  choices: { value: number; label: string }[];
  onSelect: (v: number) => void;
  disabled?: boolean;
}) {
  const t = useV3Theme();
  const [open, setOpen] = useState(false);
  const current = choices.find(c => c.value === value)?.label ?? String(value);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        disabled={disabled}
        activeOpacity={0.75}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          minWidth: 130, maxWidth: 210, flexShrink: 1,
          backgroundColor: t.cardNested, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth,
          borderRadius: v3Radius.card, paddingLeft: v3Spacing.medium, paddingRight: 10, minHeight: 44,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text numberOfLines={1} style={{ color: t.text, fontSize: v3Type.body, flexShrink: 1 }}>{current}</Text>
        {/* No down-chevron glyph in the icon font; chevronRight rotated 90° points down. */}
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chevronRight" size={18} color={t.mutedText} />
        </View>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 28 }}
        >
          {/* The open list floats with no shadow: the stronger hairline, like the desktop's
              menus and dialogs (the grey-text colour drew a heavy outline, 2026-11-03). */}
          <View style={{
            backgroundColor: t.card, borderColor: t.borderStrong, borderWidth: 1,
            borderRadius: v3Radius.card, maxHeight: '70%', overflow: 'hidden',
          }}>
            <ScrollView>
              {choices.map(c => {
                const sel = c.value === value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => { onSelect(c.value); setOpen(false); }}
                    style={{
                      paddingVertical: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: v3Spacing.medium,
                      backgroundColor: sel ? t.primary + '1F' : 'transparent',
                    }}
                  >
                    <Text style={{ color: t.text, fontSize: v3Type.body, fontWeight: sel ? '700' : '400' }}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── StatusLine — replaces the old colored dot + text pattern ──────────────
export function StatusLine({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'alert' }) {
  const t = useV3Theme();
  const color = tone === 'alert' ? t.error : t.mutedText;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, flexShrink: 0 }} />
      <Text style={{ fontSize: v3Type.label, fontWeight: '600', color, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

// ── WarningNote — neutral surface, warning-colored icon ────────────────────
export function WarningNote({ children }: { children: React.ReactNode }) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: t.warning + '14', borderRadius: v3Radius.small, padding: 12, marginTop: 8,
    }}>
      <Icon name="warning" size={17} color={t.warning} />
      <Text style={{ flex: 1, fontSize: v3Type.label, color: t.text }}>{children}</Text>
    </View>
  );
}

// ── Chip — small filled pill, e.g. "Connected" - tinted with the primary
// color (a real status pill, not a neutral bordered box) ───────────────────
export function Chip({ label, icon }: { label: string; icon?: IconName }) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
      backgroundColor: t.primary + '1F', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, marginTop: 8,
    }}>
      {!!icon && <Icon name={icon} size={12} color={t.primary} />}
      <Text style={{ fontSize: v3Type.label, fontWeight: '600', color: t.primary }}>{label}</Text>
    </View>
  );
}

// ── Badge — tiny neutral label pill, e.g. "v2.5.15" ─────────────────────────
export function Badge({ label }: { label: string }) {
  const t = useV3Theme();
  return (
    <Text style={{
      fontSize: v3Type.tiny, fontWeight: '700', letterSpacing: 0.3, color: t.mutedText,
      backgroundColor: t.mutedText + '1A',
      borderRadius: v3Radius.small - 2, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden',
    }}>
      {label}
    </Text>
  );
}

// ── IconBadge — circular icon container, e.g. card headers ─────────────────
export function IconBadge({ icon, size = 34 }: { icon: IconName; size?: number }) {
  const t = useV3Theme();
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.32),
      backgroundColor: t.primary + '1A',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={size * 0.5} color={t.primary} />
    </View>
  );
}

// ── FieldRow — icon-prefixed text input ─────────────────────────────────────
export function FieldRow({ icon, style, ...inputProps }: { icon: IconName } & TextInputProps) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      minHeight: 44, backgroundColor: t.cardNested, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth,
      borderRadius: v3Radius.small, paddingHorizontal: 12, marginTop: 10,
    }}>
      <Icon name={icon} size={15} color={t.mutedText} />
      <TextInput
        placeholderTextColor={t.mutedText}
        style={[{ flex: 1, color: t.text, fontSize: v3Type.bodyLarge, paddingVertical: 10 }, style]}
        {...inputProps}
      />
    </View>
  );
}

// ── ActionTile — Card-surfaced square used on Home's action grid ───────────
export function ActionTile({
  icon, label, progress, onPress, onLongPress, disabled, busy, basis, grow, primary,
}: {
  icon: IconName; label: string; progress?: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; busy?: boolean;
  // Column width as a flex-basis. When omitted it adapts to the screen: two columns on
  // phones, three on roomy/landscape/tablet widths. flexGrow 0 keeps a lone trailing tile
  // at its column width (centered by the row) rather than stretching full-width. The row
  // is width-capped upstream, so this stays clean from phones to tablets.
  basis?: ViewStyle['flexBasis'];
  // Real, 2026-08-09 ("enlarge the synced and gps buttons to match together the width of
  // either [card]") - Home's own 2-tile sync/GPS row left a big gap on either side of a
  // fixed-percentage-width pair inside the same width-capped row the weather/device cards
  // fill completely. flexGrow:1 + flexBasis:0 (standard "share the row evenly" flex, not a
  // fixed percentage) makes the pair always fill that row exactly, whatever its cap is.
  grow?: boolean;
  primary?: boolean;
}) {
  const t = useV3Theme();
  const { width, height } = useWindowDimensions();
  // Column count adapts to the screen (row is width-capped upstream: ~560 portrait,
  // ~960 landscape), targeting ~170 px tiles:
  //   landscape/roomy → ~5 across   ·   portrait tablet → 3 across   ·   phone → 2.
  // Orientation-based (not width-only) so a portrait tablet — wide but tall — stays a
  // 3-column column layout, matching the pre-landscape look.
  const roomy = width > height && width >= 700;
  const effectiveBasis = basis ?? (roomy ? '18%' : width < 480 ? '48%' : '30%');
  if (primary) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled}
        accessibilityRole="button" accessibilityState={{ disabled: !!disabled && !busy, busy: !!busy }}
        accessibilityLabel={progress ? `${label}, ${progress}` : label}
        style={({ pressed }) => ({
          backgroundColor: t.primary, borderRadius: v3Radius.small, minHeight: 52, padding: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: pressed || (disabled && !busy) ? 0.65 : 1,
        })}>
        {busy ? <ActivityIndicator size="small" color={t.card} /> : <Icon name={icon} size={19} color={t.card} />}
        <Text style={{ fontSize: v3Type.bodyLarge, color: t.card, fontWeight: '700', flexShrink: 1 }}>{label}</Text>
        {!!progress && <Text style={{ fontVariant: ['tabular-nums'], color: t.card, fontSize: v3Type.caption }}>{progress}</Text>}
      </Pressable>
    );
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={{
        flexBasis: grow ? 0 : effectiveBasis, flexGrow: grow ? 1 : 0, minWidth: 84,
        // No shadows (André, 2026-08-25: "all app, desktop android, same for previous rules") -
        // dropped the RN shadow/elevation this tile leaned on for definition; a hairline border
        // in the idle state does that job now instead (was transparent - shadow-only before).
        backgroundColor: t.card, borderColor: busy ? t.primary : t.border, borderWidth: busy ? 1 : StyleSheet.hairlineWidth,
        borderRadius: v3Radius.card, minHeight: 76, paddingVertical: 12, paddingHorizontal: 12,
        alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy
        ? <View style={{ height: 20, justifyContent: 'center' }}><PulseDots /></View>
        : <Icon name={icon} size={22} color={t.primary} />}
      <Text style={{ fontSize: v3Type.label, fontWeight: '600', color: t.text, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
      {!!progress && <Text style={{ fontSize: v3Type.caption, color: t.mutedText, fontVariant: ['tabular-nums'] }}>{progress}</Text>}
    </TouchableOpacity>
  );
}

// ── Logo — mountain mark + optional "Sommet" wordmark ────────────────────
export function Logo({ size = 64, wordmark = true }: { size?: number; wordmark?: boolean }) {
  const t = useV3Theme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Icon name="mountain" size={size} color={t.primary} />
      {wordmark && (
        <Text style={{ marginTop: 3, fontSize: Math.round(size * 0.26), fontWeight: '800', color: t.text, letterSpacing: 0.4 }}>
          Sommet
        </Text>
      )}
    </View>
  );
}

// ── ExportedFileRow — filename + a share link, used by the Garmin screens ──
export function ExportedFileRow({
  fileName, onShare, shareLabel,
}: { fileName: string; onShare: () => void; shareLabel: string }) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.mutedText + '22',
    }}>
      <Text style={{ color: t.mutedText, fontSize: v3Type.label, flex: 1, marginRight: 10 }} numberOfLines={1}>
        {fileName}
      </Text>
      <TouchableOpacity onPress={onShare}>
        <Text style={{ color: t.primary, fontSize: v3Type.label, fontWeight: '700' }}>{shareLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ═══ André's 2026-11-02 picks, ported from the desktop components of the same name ═════════
// (desktop/qml/components/PulseDots, StatusChip, StatusNote, SearchField, EmptyState, StatTile,
// SegmentedControl, SkeletonList, RoundedCheckBox). Same sizes, colours and wording as desktop.

export type StatusTone = 'success' | 'warning' | 'error' | 'primary' | 'neutral';
function toneColor(t: ReturnType<typeof useV3Theme>, tone: string): string {
  return tone === 'success' ? t.success
    : tone === 'warning' ? t.warning
    : tone === 'error' ? t.error
    : tone === 'primary' || tone === 'working' ? t.primary
    : t.mutedText;
}

// ── PulseDots — Sommet's "working" mark: three dots that pulse in turn (160 ms apart) ──────
export function PulseDots({
  color, size = 6, gap = 4, running = true,
}: { color?: string; size?: number; gap?: number; running?: boolean }) {
  const t = useV3Theme();
  const reduced = useReducedMotion();
  const c = color ?? t.primary;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.42))).current;
  useEffect(() => {
    if (!running || reduced) {
      dots.forEach(d => d.setValue(0.75));
      return;
    }
    const loops = dots.map((d, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 120),
      Animated.timing(d, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), isInteraction: false, useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.42, duration: 300, easing: Easing.inOut(Easing.quad), isInteraction: false, useNativeDriver: true }),
      Animated.delay((2 - i) * 120),
    ])));
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [running, reduced, dots]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }} accessible accessibilityRole="progressbar" accessibilityLabel="Working">
      {dots.map((opacity, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, opacity }} />
      ))}
    </View>
  );
}

// ── StatusChip — one small status tag: Connected, Experimental, Soon, Due, Not set up ──────
// A light tint, a thin border and the text, all in the tone's colour (desktop picks #6).
export function StatusChip({
  label, tone = 'neutral', style,
}: { label: string; tone?: StatusTone; style?: StyleProp<ViewStyle> }) {
  const t = useV3Theme();
  const c = toneColor(t, tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[{
        alignSelf: 'flex-start', borderRadius: 999,
        backgroundColor: c + (tone === 'neutral' ? '14' : '1A'), paddingHorizontal: 6, paddingVertical: 2,
      }, style]}
    >
      <Text style={{ color: c, fontSize: v3Type.caption }}>{label}</Text>
    </View>
  );
}

// ── StatusNote — the result of an action, under the button that caused it (picks #7) ──────
// A card with a thin coloured bar on the left, an icon, the text, and a × to close it. Hidden
// while `text` is empty; a new text shows it again after a close. tone 'working' is a step still
// running: pulsing dots and no ×.
export function StatusNote({
  text, tone = 'success', closable, style,
}: {
  text?: string | null; tone?: 'success' | 'warning' | 'error' | 'working';
  closable?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  const [closed, setClosed] = useState(false);
  useEffect(() => { setClosed(false); }, [text]);
  if (!text || closed) return null;
  const c = toneColor(t, tone);
  const canClose = closable ?? tone !== 'working';
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[{
        flexDirection: 'row', alignItems: 'flex-start', marginTop: 10,
        backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: v3Radius.small,
        paddingVertical: 8, paddingLeft: 14, paddingRight: canClose ? 4 : 12, minHeight: 34,
      }, style]}
    >
      <View style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 3, borderRadius: 1.5, backgroundColor: c }} />
      <View style={{ width: 16, minHeight: 17, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
        {tone === 'working'
          ? <PulseDots color={c} size={5} gap={2} />
          : <Icon name={tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'check'} size={16} color={c} />}
      </View>
      <Text style={{ flex: 1, color: t.text, fontSize: v3Type.label, lineHeight: 17 }}>{text}</Text>
      {canClose && (
        <TouchableOpacity
          onPress={() => setClosed(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ width: 24, height: 24, marginTop: -3, marginLeft: 6, alignItems: 'center', justifyContent: 'center', borderRadius: v3Radius.small }}
        >
          <Icon name="close" size={16} color={t.mutedText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── SearchField — magnifier on the left, a × to clear once there's text (picks #9) ─────────
// Same field look as desktop's RoundedTextField: cardNested, hairline, 2px green border when
// focused, round corners.
export function SearchField({
  value, onChangeText, placeholder = 'Search', style, ...rest
}: TextInputProps & { value: string; onChangeText: (s: string) => void }) {
  const t = useV3Theme();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', minHeight: 46,
      backgroundColor: t.cardNested, borderRadius: v3Radius.small,
      borderWidth: focused ? 2 : 1, borderColor: focused ? t.primary : t.border,
      paddingLeft: focused ? 9 : 10, paddingRight: focused ? 3 : 4,
    }, style as ViewStyle]}>
      <Icon name="search" size={16} color={t.mutedText} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.mutedText}
        returnKeyType="search"
        {...rest}
        onFocus={e => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={e => { setFocused(false); rest.onBlur?.(e); }}
        style={{ flex: 1, color: t.text, fontSize: v3Type.body, paddingVertical: 8, paddingHorizontal: 8 }}
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={() => { onChangeText(''); inputRef.current?.focus(); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear"
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: v3Radius.small }}
        >
          <Icon name="close" size={16} color={t.mutedText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── EmptyState — what an empty page says (picks #11) ─────────────────────────────────────
// An icon, a title, one sentence on what to do, and optionally one button that does it.
export function EmptyState({
  icon, title, text, actionLabel, onAction, style,
}: {
  icon?: IconName; title: string; text?: string; actionLabel?: string; onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: v3Spacing.large, paddingHorizontal: v3Spacing.medium, gap: v3Spacing.small }, style]}>
      {!!icon && (
        <View style={{ width: 62, height: 62, borderRadius: 20, backgroundColor: t.primary + '16', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={24} color={t.primary} />
        </View>
      )}
      <Text style={{ color: t.text, fontSize: v3Type.title, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      {!!text && <Text style={{ color: t.mutedText, fontSize: v3Type.body, textAlign: 'center', lineHeight: 22 }}>{text}</Text>}
      {!!actionLabel && !!onAction && (
        <View style={{ marginTop: 2 }}>
          <Button label={actionLabel} onPress={onAction} accent grow={false} />
        </View>
      )}
    </View>
  );
}

// ── StatTile — one number in a tile (picks #12) ──────────────────────────────────────────
// A label (with an optional small tag such as "3 days old"), the value with its unit, and a
// short caption under it such as "▲ 4 vs 7-day average".
export function StatTile({
  label, value, unit, caption, badge, valueColor, style,
}: {
  label: string; value: string; unit?: string; caption?: string; badge?: string;
  valueColor?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ' ' + unit : ''}${caption ? ', ' + caption : ''}`}
      style={[{ backgroundColor: t.cardNested, borderRadius: v3Radius.small, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text style={{ color: t.mutedText, fontSize: v3Type.caption }}>{label}</Text>
        {!!badge && (
          <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: 6, paddingHorizontal: 4 }}>
            <Text style={{ color: t.mutedText, fontSize: v3Type.tiny }}>{badge}</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={{ color: valueColor ?? t.text, fontSize: v3Type.largeTitle, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 }}>{value}</Text>
        {!!unit && <Text style={{ color: t.mutedText, fontSize: v3Type.label }}>{unit}</Text>}
      </View>
      {!!caption && <Text style={{ color: t.mutedText, fontSize: v3Type.caption }}>{caption}</Text>}
    </View>
  );
}

// ── SegmentedControl — one switch for two or three choices (picks #14) ───────────────────
// A track, and the chosen part as a card with bold text. Each part is as wide as its bold
// label, so the switch doesn't change width with the choice.
export function SegmentedControl({
  options, index, onChange, disabled, style, tabs,
}: {
  tabs?: boolean; options: string[]; index: number; onChange: (i: number) => void; disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  return (
    <View accessibilityRole={tabs ? "tablist" : "radiogroup"} style={[{
      flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%', gap: 3, padding: 3,
      backgroundColor: t.cardNested, borderRadius: v3Radius.small,
      opacity: disabled ? 0.5 : 1,
    }, style]}>
      {options.map((label, i) => {
        const chosen = i === index;
        return (
          <Pressable
            key={label + i}
            disabled={disabled}
            onPress={() => { if (!chosen) onChange(i); }}
            accessible={tabs}
            accessibilityRole={tabs ? 'button' : 'radio'}
            accessibilityLabel={label}
            accessibilityState={tabs ? { selected: chosen, disabled: !!disabled } : { checked: chosen, disabled: !!disabled }}
            style={({ pressed }) => ({
              flexShrink: 1, flexGrow: 1, minHeight: 42, paddingHorizontal: 12, paddingVertical: 7,
              justifyContent: 'center', borderRadius: v3Radius.small - 3,
              backgroundColor: chosen ? t.card : pressed ? t.primary + '13' : 'transparent',
            })}
          >
            <Text style={{ textAlign: 'center', fontSize: v3Type.label, fontWeight: '600', color: chosen ? t.primary : t.mutedText }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── SkeletonList — grey rows shaped like the list to come, while a long read runs (#13) ───
// The rows pulse between full and half strength every 1.2 s. Show it only while the list is
// empty and loading.
export function SkeletonList({ count = 6, rowHeight = 56 }: { count?: number; rowHeight?: number }) {
  const t = useV3Theme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.5, duration: 700, isInteraction: false, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, isInteraction: false, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View style={{ opacity: pulse, gap: v3Spacing.small }} accessible accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{
          height: rowHeight, borderRadius: v3Radius.small, backgroundColor: t.card,
          borderWidth: 1, borderColor: t.border, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, gap: 12,
        }}>
          <View style={{ width: 34, height: 34, borderRadius: v3Radius.small, backgroundColor: t.cardNested }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ width: '55%', height: 9, borderRadius: 4.5, backgroundColor: t.cardNested }} />
            <View style={{ width: '30%', height: 9, borderRadius: 4.5, backgroundColor: t.cardNested }} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

// ── Checkbox — RoundedCheckBox with the drawn tick (picks #15) ───────────────────────────
// The icon font has no bare checkmark and the circle-tick read as a circle inside a square:
// two rounded bars in an L, turned 45°, popping in over 120 ms.
export function Checkbox({
  value, onValueChange, label, disabled, labelSize = v3Type.body, gap = 8, size = 22,
}: {
  value: boolean; onValueChange: (v: boolean) => void; label?: string; disabled?: boolean;
  labelSize?: number; gap?: number; size?: number;
}) {
  const t = useV3Theme();
  const anim = useVisibilityMotion(value);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.4 * size / 22, size / 22] });
  return (
    <TouchableOpacity
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap, paddingVertical: 4, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{
        width: size, height: size, borderRadius: Math.round(size * 6 / 22), borderWidth: 1,
        backgroundColor: value ? t.primary : t.card, borderColor: value ? t.primary : t.mutedText,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Animated.View style={{ width: 6, height: 11, marginTop: -2, opacity: anim, transform: [{ rotate: '45deg' }, { scale }] }}>
          <View style={{ position: 'absolute', right: 0, top: 0, width: 2.4, height: 11, borderRadius: 1.2, backgroundColor: t.card }} />
          <View style={{ position: 'absolute', left: 0, bottom: 0, width: 6, height: 2.4, borderRadius: 1.2, backgroundColor: t.card }} />
        </Animated.View>
      </View>
      {!!label && <Text style={{ flexShrink: 1, color: t.text, fontSize: labelSize }}>{label}</Text>}
    </TouchableOpacity>
  );
}
