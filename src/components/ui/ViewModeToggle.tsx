import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useV3Theme } from '../../theme/v3';
import Icon from './Icon';
import { ViewMode } from '../../services/ListViewPrefs';
import { t } from '../../i18n';

const modes: ViewMode[] = ['map', 'list'];

export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const theme = useV3Theme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.track, { backgroundColor: theme.cardNested }]}>
      {modes.map(item => {
        const selected = mode === item;
        return (
          <Pressable key={item}
            accessibilityRole="radio" accessibilityState={{ checked: selected }}
            accessibilityLabel={item === 'map' ? t.viewMap : t.viewList}
            onPress={() => { if (!selected) onChange(item); }}
            style={({ pressed }) => [styles.option, {
              backgroundColor: selected ? theme.card : pressed ? theme.primary + '15' : 'transparent',
            }]}
          >
            <Icon name={item === 'map' ? 'map' : 'list'} size={19} color={selected ? theme.primary : theme.mutedText} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: 12 },
  option: { borderRadius: 9, minWidth: 44, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
});
