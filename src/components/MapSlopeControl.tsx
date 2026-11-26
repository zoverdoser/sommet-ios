import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useV3Theme } from '../theme/v3';
import { Checkbox } from './ui/primitives';

export function MapSlopeControl({ value, onValueChange }: {
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useV3Theme();
  return <View style={[styles.control, { backgroundColor: theme.card, borderColor: theme.border }]}>
    <Checkbox label="Slope" value={value} onValueChange={onValueChange} size={15} labelSize={11} gap={5} />
  </View>;
}

const styles = StyleSheet.create({
  control: {
    position: 'absolute', left: 8, bottom: 24, paddingHorizontal: 7,
    borderRadius: 6, borderWidth: StyleSheet.hairlineWidth,
  },
});
