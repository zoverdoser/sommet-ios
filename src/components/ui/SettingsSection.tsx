import React, { useLayoutEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Icon, { IconName } from './Icon';
import { useV3Theme } from '../../theme/v3';

const iconColors: Partial<Record<IconName, string>> = {
  sync: '#315ECC', auto: '#52546B', list: '#5863B0', backup: '#337864',
  health: '#AD3555', map: '#337864', sun: '#946019', watch: '#5045AB',
  activity: '#396C35', info: '#52546B',
};

export function SettingsSection({ title, summary, icon = 'settings', visible, open, onToggle, onDetailTitle, last, children }: {
  title: string;
  summary?: string;
  icon?: IconName;
  visible: boolean;
  open: boolean;
  onToggle: () => void;
  onDetailTitle: (title: string) => void;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const t = useV3Theme();
  const { fontScale } = useWindowDimensions();
  useLayoutEffect(() => {
    if (open && visible) onDetailTitle(title);
  }, [open, visible, title, onDetailTitle]);
  if (!visible) return null;
  if (open) return <View style={styles.detail}>{children}</View>;

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityValue={summary ? { text: summary } : undefined}
        onPress={onToggle} style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.cardNested }]}>
        <View style={[styles.icon, { backgroundColor: iconColors[icon] ?? '#475778' }]}>
          <Icon name={icon} size={17} color="#FFFFFF" />
        </View>
        <View style={[styles.labels, fontScale >= 1.4 && styles.labelsStacked]}>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {!!summary && <Text numberOfLines={1} style={[styles.summary, fontScale < 1.4 && styles.summaryInline, { color: t.mutedText }]}>{summary}</Text>}
        </View>
        <Icon name="chevronRight" size={13} color={t.mutedText} />
      </Pressable>
      {!last && <View style={[styles.divider, { backgroundColor: t.border }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 51, paddingVertical: 8, paddingHorizontal: 12 },
  icon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelsStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  title: { fontSize: 16, fontWeight: '500', flexShrink: 1 },
  summary: { fontSize: 14, flexShrink: 1 },
  summaryInline: { marginLeft: 'auto', maxWidth: '50%' },
  divider: { marginLeft: 52, height: StyleSheet.hairlineWidth },
  detail: { padding: 14, gap: 5 },
});
