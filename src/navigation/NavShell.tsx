import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/ui/Icon';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';

export function NavShell({ openSettings, children }: {
  openSettings: () => void;
  children: React.ReactNode;
}) {
  const theme = useV3Theme();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.appBar, {
        paddingTop: insets.top + 3,
        paddingLeft: insets.left + 20,
        paddingRight: insets.right + 20,
        backgroundColor: theme.background,
      }]}>
        <View style={[styles.mark, { backgroundColor: theme.primary }]}>
          <Icon name="mountain" size={19} color={theme.card} />
        </View>
        <Text accessibilityRole="header" style={[styles.brand, { color: theme.text }]}>Sommet</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.settingsTitle} onPress={openSettings}
          style={({ pressed }) => [styles.settings, pressed && { opacity: 0.55 }]}>
          <Icon name="gearOutline" size={24} color={theme.text} />
        </Pressable>
      </View>
      <View style={styles.root}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8 },
  mark: { width: 33, height: 33, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: -0.8 },
  settings: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
