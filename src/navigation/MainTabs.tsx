import React, { createContext, useContext, useState } from 'react';
import {
  createNavigatorFactory, TabActions, TabRouter, useNavigationBuilder,
  type DefaultNavigatorOptions, type ParamListBase, type TabNavigationState, type TabRouterOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Tabs } from 'react-native-screens';
import type { GarminConnectResult } from '../native/GarminModule';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';

export type MainTabParams = { Dashboard: undefined; LogList: undefined; Route: undefined };

export type NavigationWatch = {
  watch: boolean;
  pins: boolean;
  legacy: boolean;
  garmin?: GarminConnectResult;
};

const disconnected: NavigationWatch = { watch: false, pins: false, legacy: false };
const NavigationWatchContext = createContext(disconnected);
const SetNavigationWatchContext = createContext<React.Dispatch<React.SetStateAction<NavigationWatch>>>(() => {});

export function NavigationWatchProvider({ children }: { children: React.ReactNode }) {
  const [watch, setWatch] = useState(disconnected);
  return (
    <SetNavigationWatchContext.Provider value={setWatch}>
      <NavigationWatchContext.Provider value={watch}>{children}</NavigationWatchContext.Provider>
    </SetNavigationWatchContext.Provider>
  );
}

export const useNavigationWatch = () => useContext(NavigationWatchContext);
export const useSetNavigationWatch = () => useContext(SetNavigationWatchContext);

type TabOptions = { title: string; symbol: string };
type NavigatorProps = DefaultNavigatorOptions<
  ParamListBase, string | undefined, TabNavigationState<ParamListBase>, TabOptions, any, any
> & TabRouterOptions;

function NativeTabs({ children, initialRouteName, screenOptions }: NavigatorProps) {
  const theme = useV3Theme();
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(TabRouter, {
    children, initialRouteName, screenOptions,
  });
  const selected = state.routes[state.index].key;
  const [visited, setVisited] = useState<string[]>([selected]);
  if (!visited.includes(selected)) setVisited(current => [...current, selected]);

  return (
    <NavigationContent>
      <Tabs.Host
        experimentalControlNavigationStateInJS
        onNativeFocusChange={({ nativeEvent }) => {
          const route = state.routes.find(item => item.key === nativeEvent.tabKey);
          if (route && route.key !== selected) navigation.dispatch({ ...TabActions.jumpTo(route.name), target: state.key });
        }}
        nativeContainerStyle={{ backgroundColor: theme.background }}
        tabBarTintColor={theme.primary}
        tabBarControllerMode="tabBar"
        tabBarMinimizeBehavior="never"
      >
        {state.routes.map(route => {
          const descriptor = descriptors[route.key];
          return (
            <Tabs.Screen key={route.key} tabKey={route.key} isFocused={route.key === selected}
              title={descriptor.options.title}
              icon={{ ios: { type: 'sfSymbol', name: descriptor.options.symbol } }}>
              {(route.key === selected || visited.includes(route.key)) && (
                <SafeAreaProvider>{descriptor.render()}</SafeAreaProvider>
              )}
            </Tabs.Screen>
          );
        })}
      </Tabs.Host>
    </NavigationContent>
  );
}

const MainTab = createNavigatorFactory(NativeTabs)();
const ActivitiesStack = createNativeStackNavigator();
const RoutesStack = createNativeStackNavigator();

function useRootHeader() {
  const theme = useV3Theme();
  return {
    headerBackVisible: false,
    headerShadowVisible: false,
    headerTintColor: theme.text,
    headerStyle: { backgroundColor: theme.background },
    contentStyle: { backgroundColor: theme.background },
    headerLargeTitleEnabled: false,
  };
}

function ActivitiesTab() {
  return (
    <ActivitiesStack.Navigator screenOptions={useRootHeader()}>
      <ActivitiesStack.Screen name="ActivityList" getComponent={() => require('../screens/LogListScreen').default}
        options={{ title: t.logListTitle }} />
    </ActivitiesStack.Navigator>
  );
}

function RoutesTab() {
  return (
    <RoutesStack.Navigator screenOptions={useRootHeader()}>
      <RoutesStack.Screen name="RoutesAndPois" getComponent={() => require('../screens/RoutesAndPoisScreen').default}
        options={{ title: t.routesAndPoisTitle }} />
    </RoutesStack.Navigator>
  );
}

export default function MainTabs() {
  return (
    <MainTab.Navigator initialRouteName="Dashboard">
      <MainTab.Screen name="Dashboard" getComponent={() => require('../screens/HomeScreen').default}
        options={{ title: t.homeNavHome, symbol: 'house' }} />
      <MainTab.Screen name="LogList" component={ActivitiesTab}
        options={{ title: t.viewActivities, symbol: 'list.bullet' }} />
      <MainTab.Screen name="Route" component={RoutesTab}
        options={{ title: t.routesAndPoisTitle, symbol: 'point.topleft.down.to.point.bottomright.curvepath' }} />
    </MainTab.Navigator>
  );
}
