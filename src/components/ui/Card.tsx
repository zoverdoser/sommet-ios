import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useV3Theme } from '../../theme/v3';

export function Card({
  children,
  padding = 12,
  style,
}: {
  children: React.ReactNode;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.card, borderRadius: 15, borderColor: t.border, padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: 'continuous',
    borderWidth: 0,
  },
});
