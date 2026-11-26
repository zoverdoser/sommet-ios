import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Appearance, Linking, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef, StackActions, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useV3Theme } from './src/theme/v3';
import { ThemeModeProvider, useThemeMode } from './src/theme/ThemeModeContext';
import { useReducedMotion } from './src/theme/motion';
import { ExperimentalProvider } from './src/config/ExperimentalContext';
import MainTabs, { NavigationWatchProvider, type MainTabParams } from './src/navigation/MainTabs';
import { observeSharedGpx, type SharedGpx } from './src/native/SommetDocuments';
import { SyncProgressBanner } from './src/components/SyncProgressBanner';
import type { RouteDetailParams } from './src/screens/RouteDetailScreen';
// Weight/Health - desktop parity (2026-08-26). Both read intervals.icu's wellness feed via
// src/services/WellnessService.ts; see that file for what Android can and cannot reach.
import type { GarminConnectResult } from './src/native/GarminModule';
import type { ActivityRecord } from './src/database/db';
import { t, fmtDate } from './src/i18n';
import { migrateOldStorageKeys } from './src/services/StorageKeyMigration';

// ─── Types de navigation ──────────────────────────────────────────────────────

export type RootStackParamList = {
  Home: NavigatorScreenParams<MainTabParams> | undefined;
  Bryton: undefined;
  Magene: undefined;
  Edge500: undefined;
  Map: { activity: ActivityRecord };
  Settings: { section?: string } | undefined;
  Poi: { watch?: boolean } | undefined;
  RouteImport: {
    incoming?: SharedGpx;
    libraryRoute?: { id: string; name: string };
    send?: { name: string; points: Array<{ lat: number; lon: number; ele?: number | null }> };
  } | undefined;
  // v2.3.2 beta: HomeScreen connects to the Garmin device itself (see its
  // connecting-flow state machine) and hands the already-fetched info over
  // here — neither screen has its own Connect step. Activities sync runs
  // inline from Home (no screen — see GarminActivityService.ts), so there's
  // no "Garmin" route anymore, just these two, mirroring the Ambit Route/Poi
  // screens per André's feedback.
  RouteDetail: RouteDetailParams;
  GarminRoute: { info: GarminConnectResult };
  GarminPoi: { info: GarminConnectResult };
  Backup: { deviceModel?: string } | undefined;
  // Real, 2026-08-08 - Ambit3-only (Kailash's own memory map has no CustomModes region),
  // HomeScreen only routes here for that device type - see SportModesScreen.tsx.
  // overBle: the watch is connected over Bluetooth, so the sport-mode reads/writes must run on
  // the already-open BLE link instead of opening a USB connection (which pops the OTG prompt).
  SportModes: { overBle?: boolean; variant?: string } | undefined;
  Firmware: undefined;
  // Activity-analytics views (2026-08-13, port of desktop TotalsPage/CalendarPage). Both are
  // derived purely from the local activity DB, so they're reachable any time (no device
  // needed) - launched from the Activities screen header, not the device-gated Home shell.
  Totals: undefined;
  Calendar: undefined;
  // Weight/Health (2026-08-26, port of desktop WeightPage/HealthPage). Both read intervals.icu
  // wellness, so like Totals/Calendar they need no connected device and are reachable any time.
  Weight: undefined;
  Health: undefined;
  // Sleep & Recovery (2026-09-04): overnight HRV + resting-HR trend from a Polar Verity Sense
  // recorded offline (sleepStage.ts on-device; twin of tools/sleep_stage.py). No watch needed.
  Sleep: undefined;
  // Coach readiness (2026-08-26): intervals.icu training load, no device needed.
  Coach: undefined;
  // Ember recap - hidden until the Settings easter egg unlocks it (EmberUnlock.ts).
  Ember: undefined;
  // Experimental (2026-08-14) - gated behind the Experimental flag (see ExperimentalContext),
  // reached from the Settings > Experimental section. App-Zone + Intervals write flash and are
  // unproven on Android hardware; Smart Sensor is a separate BLE peripheral (the HR belt).
  SmartSensor: undefined;
  AppZone: undefined;
  Apps: undefined;
  WatchSettings: { sportModes?: RootStackParamList['SportModes'] } | undefined;
  Intervals: undefined;
  // The Calendar feature (2026-08-21) - dated native guided workouts in the WORKOUT menu,
  // named "dd/mm_name". "WorkoutCalendar" (not "Calendar") deliberately - that route name is
  // already the activity-history month grid above; this is a different feature entirely.
  // Optional: which devices the plan can create for / send to (Home passes what's connected).
  WorkoutCalendar: { watch?: boolean; bryton?: boolean; magene?: string | null } | undefined;
  // Gear tracker (v3): bikes/shoes + components (parts) + service reminders, local-first and
  // mirrored two-way to intervals.icu. Derived from the local gear DB, no device needed.
  Gear: undefined;
  // Weather along a route (2026-08-29, port of the desktop Plan page's Weather panel —
  // weather_route.py + astro.py, both verified equal in TS). Sun/moon + Open-Meteo forecast at
  // each point's ETA, temp-coloured profile + verdict. `route` optional (a demo route is used
  // when none is passed); no watch needed.
  RouteWeather: { route?: Array<{ lat: number; lon: number; ele?: number | null }>; name?: string } | undefined;
  RacePlan: undefined;
  // Offline maps (2026-08-30): download any map area of the world (OruxMaps-style) for use with
  // no signal, plus a saved-areas manager. Reachable any time, no device needed.
  OfflineMaps: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Handler deep link OAuth2 ─────────────────────────────────────────────────

const STRAVA_OAUTH_PREFIX      = 'opensportsync://oauth/strava';

async function processOAuthUrl(url: string | null) {
  if (!url?.startsWith(STRAVA_OAUTH_PREFIX)) return;
  try {
    const code = new URL(url).searchParams.get('code');
    if (!code) throw new Error(t.oauthMissingCode);

    const { handleOAuthCallback } = require('./src/services/ApiStrava');
    await handleOAuthCallback(code);
    Alert.alert('Strava', t.stravaConnected);
  } catch (e: any) {
    Alert.alert(t.error, e?.message);
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [keysReady, setKeysReady] = useState(false);
  const dark = useColorScheme() === 'dark';
  useEffect(() => { migrateOldStorageKeys().finally(() => setKeysReady(true)); }, []);
  if (!keysReady) {
    return (
      <View style={[startup.screen, { backgroundColor: dark ? '#000' : '#FFF' }]}>
        <Text accessibilityRole="header" style={[startup.title, { color: dark ? '#FFF' : '#000' }]}>Sommet</Text>
      </View>
    );
  }
  return (
    <ThemeModeProvider>
      <ExperimentalProvider>
        <AppShell />
      </ExperimentalProvider>
    </ThemeModeProvider>
  );
}

const startup = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700' },
});

function AppShell() {
  const { isDark, mode } = useThemeMode();
  const theme = useV3Theme();

  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  useEffect(() => {
    // App ouverte depuis un deep link (app déjà lancée)
    const sub = Linking.addEventListener('url', ({ url }) => processOAuthUrl(url));
    // App lancée via le deep link (app froide)
    Linking.getInitialURL().then(processOAuthUrl);
    return () => sub.remove();
  }, []);

  // Pull from (and push to) the user's Sommet Sync store on opening and on coming back to the
  // front, like the desktop does on launch. No-op when Sommet Sync isn't set up.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        stop = require('./src/services/SommetSyncOnOpen').startSommetSyncOnOpen();
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      stop?.();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.background}
      />
      <NavigationWatchProvider>
        <AppNav />
      </NavigationWatchProvider>
    </SafeAreaProvider>
  );
}

function AppNav() {
  const theme = useV3Theme();
  const reducedMotion = useReducedMotion();
  const { isDark } = useThemeMode();
  const navTheme = useMemo(() => {
    const systemTheme = isDark ? DarkTheme : DefaultTheme;
    return {
      ...systemTheme,
      colors: {
        ...systemTheme.colors,
        primary: theme.primary,
        background: theme.background,
        card: theme.background,
        text: theme.text,
        border: theme.border,
        notification: theme.error,
      },
    };
  }, [isDark, theme]);
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    return observeSharedGpx(incoming => navRef.dispatch(StackActions.push('RouteImport', { incoming })));
  }, [navRef, ready]);

  return (
    <NavigationContainer theme={navTheme} ref={navRef} onReady={() => setReady(true)}>
      <SyncProgressBanner />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerLargeStyle: { backgroundColor: theme.background },
          headerBackButtonDisplayMode: 'minimal',
          fullScreenGestureEnabled: false,
          animation: reducedMotion ? 'none' : 'default',
          headerTintColor: theme.text,
          headerTitleStyle: { color: theme.text, fontWeight: '600' },
          headerLargeTitleStyle: { color: theme.text, fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen
          name="Home"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Map"
          getComponent={() => require('./src/screens/MapScreen').default}
          // Sport and day, once (André, 2026-10-03: "The activity page shows the date three
          // times. Fix it") - the page itself no longer repeats either. Day-first like every
          // other date in the app.
          options={({ route }) => ({
            title: [route.params.activity.activity_type, fmtDate(route.params.activity.date)]
              .filter(Boolean).join(' · ') || t.mapFallback,
          })}
        />
        <Stack.Screen
          name="Settings"
          getComponent={() => require('./src/screens/SettingsScreen').default}
          options={({ route }) => ({
            title: route.params?.section ? t.settingsTitle : '',
            headerLargeTitleEnabled: false,
          })}
        />
        <Stack.Screen
          name="Poi"
          getComponent={() => require('./src/screens/PoiScreen').default}
          options={{ title: t.poiScreenTitle, headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="RouteImport"
          getComponent={() => require('./src/screens/RouteScreen').RouteImportScreen}
          options={{ title: t.routeImportTitle }}
        />
        <Stack.Screen
          name="RouteDetail"
          getComponent={() => require('./src/screens/RouteDetailScreen').default}
          options={({ route }) => ({ title: route.params.name })}
        />
        <Stack.Screen
          name="GarminRoute"
          getComponent={() => require('./src/screens/GarminRouteScreen').default}
          options={{ title: t.garminRouteScreenTitle, headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="GarminPoi"
          getComponent={() => require('./src/screens/GarminPoiScreen').default}
          options={{ title: t.garminPoiScreenTitle, headerLargeTitleEnabled: true }}
        />
        <Stack.Screen
          name="Backup"
          getComponent={() => require('./src/screens/BackupScreen').default}
          options={{ title: t.backupScreenTitle }}
        />
        <Stack.Screen
          name="SportModes"
          getComponent={() => require('./src/screens/SportModesScreen').default}
          options={{ title: t.sportModesScreenTitle }}
        />
        <Stack.Screen
          name="Firmware"
          getComponent={() => require('./src/screens/FirmwareScreen').default}
          options={{ title: 'Firmware' }}
        />
        <Stack.Screen
          name="Totals"
          getComponent={() => require('./src/screens/TotalsScreen').default}
          options={{ title: t.totalsScreenTitle }}
        />
        <Stack.Screen
          name="Weight"
          getComponent={() => require('./src/screens/WeightScreen').default}
          options={{ title: 'Weight' }}
        />
        <Stack.Screen
          name="Health"
          getComponent={() => require('./src/screens/HealthScreen').default}
          options={{ title: 'Health' }}
        />
        <Stack.Screen
          name="Sleep"
          getComponent={() => require('./src/screens/SleepScreen').default}
          options={{ title: 'Sleep & Recovery' }}
        />
        <Stack.Screen
          name="Coach"
          getComponent={() => require('./src/screens/CoachScreen').default}
          options={{ title: 'Coach' }}
        />
        <Stack.Screen
          name="Ember"
          getComponent={() => require('./src/screens/EmberScreen').default}
          options={{ title: 'Ember' }}
        />
        <Stack.Screen
          name="RouteWeather"
          getComponent={() => require('./src/screens/RouteWeatherScreen').default}
          options={{ title: 'Weather along route' }}
        />
        <Stack.Screen
          name="RacePlan"
          getComponent={() => require('./src/screens/RacePlanScreen').default}
          options={{ title: 'Race Plan' }}
        />
        <Stack.Screen
          name="OfflineMaps"
          getComponent={() => require('./src/screens/OfflineMapsScreen').default}
          options={{ title: 'Offline maps' }}
        />
        <Stack.Screen
          name="Calendar"
          getComponent={() => require('./src/screens/CalendarScreen').default}
          options={{ title: t.calendarScreenTitle }}
        />
        <Stack.Screen
          name="SmartSensor"
          getComponent={() => require('./src/screens/SmartSensorScreen').default}
          options={{ title: t.smartSensorScreenTitle }}
        />
        <Stack.Screen
          name="AppZone"
          getComponent={() => require('./src/screens/AppZoneScreen').default}
          options={{ title: t.appZoneScreenTitle }}
        />
        <Stack.Screen
          name="Apps"
          getComponent={() => require('./src/screens/AppsScreen').default}
          options={{ title: 'Apps' }}
        />
        <Stack.Screen
          name="WatchSettings"
          getComponent={() => require('./src/screens/WatchSettingsScreen').default}
          options={{ title: 'Watch settings' }}
        />
        <Stack.Screen
          name="Intervals"
          getComponent={() => require('./src/screens/IntervalsScreen').default}
          options={{ title: t.intervalsScreenTitle }}
        />
        <Stack.Screen
          name="WorkoutCalendar"
          getComponent={() => require('./src/screens/WorkoutCalendarScreen').default}
          options={{ title: t.experimentalWorkoutCalendar }}
        />
        <Stack.Screen
          name="Bryton"
          getComponent={() => require('./src/screens/BrytonScreen').default}
          options={{ title: 'Bryton Aero 60 settings' }}
        />
        <Stack.Screen
          name="Magene"
          getComponent={() => require('./src/screens/MageneScreen').default}
          options={{ title: 'Magene C406' }}
        />
        <Stack.Screen
          name="Edge500"
          getComponent={() => require('./src/screens/Edge500Screen').default}
          options={{ title: 'Garmin Edge 500 settings' }}
        />
        <Stack.Screen
          name="Gear"
          getComponent={() => require('./src/screens/GearScreen').default}
          options={{ title: t.gearScreenTitle }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
