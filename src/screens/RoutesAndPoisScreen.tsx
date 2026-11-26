import React, { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import Icon from '../components/ui/Icon';
import { Button, SegmentedControl } from '../components/ui/primitives';
import { useNavigationWatch } from '../navigation/MainTabs';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';
import RouteScreen from './RouteScreen';

export default function RoutesAndPoisScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useV3Theme();
  const [section, setSection] = useState(0);
  const [openedPois, setOpenedPois] = useState(false);
  const changeSection = (next: number) => {
    if (next === 1) setOpenedPois(true);
    setSection(next);
  };
  const watch = useNavigationWatch();
  const isRoutes = section === 0;

  useLayoutEffect(() => {
    if (!isRoutes) return;
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={t.routeImportTitle} style={styles.headerButton}
          onPress={() => navigation.navigate('RouteImport')}>
          <Icon name="routeAddStop" size={26} color={theme.text} />
        </Pressable>
      ),
    });
  }, [isRoutes, navigation, theme.text]);

  function openGarmin() {
    if (!watch.garmin) return;
    navigation.navigate(isRoutes ? 'GarminRoute' : 'GarminPoi', { info: watch.garmin });
  }

  const PoiScreen = !openedPois ? null : require('./PoiScreen').default;
  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <SegmentedControl tabs options={[t.routeScreenTitle, 'POIs']} index={section} onChange={changeSection} style={styles.segment} />
        {watch.garmin && (
          <Button label={isRoutes ? 'Garmin routes' : 'Garmin POIs'} icon="watch" variant="outline" onPress={openGarmin} />
        )}
      </View>
      <View style={[styles.root, !isRoutes && styles.hidden]}>
        <RouteScreen active={isRoutes} />
      </View>
      {PoiScreen && (
        <View style={[styles.root, isRoutes && styles.hidden]}>
          <PoiScreen watch={watch.watch} active={!isRoutes} embedded />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: 'none' },
  controls: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 12, paddingTop: 4, gap: 6 },
  segment: { width: '100%', alignSelf: 'stretch' },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
