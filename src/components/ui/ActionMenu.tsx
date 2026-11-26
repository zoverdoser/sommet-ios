import React from 'react';
import { Pressable, ScrollView, Text, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useV3Theme, v3Radius } from '../../theme/v3';
import { t } from '../../i18n';
import { AdaptiveModal } from './AdaptiveModal';
import Icon from './Icon';

export interface ActionMenuItem {
  label: string;
  onPress: () => void;
  visible?: boolean;
  tone?: 'default' | 'alert';
  disabled?: boolean;
}

export function ActionMenu({ visible, title, items, onClose, onDismiss }: {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const theme = useV3Theme();
  const insets = useSafeAreaInsets();
  const shown = items.filter(item => item.visible !== false);

  return (
    <AdaptiveModal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 14), paddingTop: insets.top + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}
          accessibilityRole="button" accessibilityLabel={t.close} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.header}>
            {!!title && <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{title}</Text>}
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t.close}
              style={[styles.close, { backgroundColor: theme.cardNested }]}>
              <Icon name="close" color={theme.text} size={18} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.actions}>
            {shown.map((item, index) => (
              <Pressable key={item.label + index} disabled={item.disabled} accessibilityRole="button"
                accessibilityState={{ disabled: !!item.disabled }}
                style={({ pressed }) => [styles.row, {
                  backgroundColor: pressed ? theme.cardNested : 'transparent',
                  borderTopColor: theme.border,
                }]}
                onPress={() => { onClose(); item.onPress(); }}>
                <Text style={[styles.rowText, { color: item.disabled ? theme.mutedText : item.tone === 'alert' ? theme.error : theme.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </AdaptiveModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#11132070', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 14 },
  card: { width: '100%', maxWidth: 540, maxHeight: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: v3Radius.sheet, borderCurve: 'continuous', overflow: 'hidden', paddingBottom: 6 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 15, paddingVertical: 5 },
  heading: { flex: 1, fontSize: 19, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  actions: { flexGrow: 0 },
  row: { minHeight: 46, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { fontSize: 16 },
});
