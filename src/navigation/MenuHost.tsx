import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, TouchableOpacity, StyleSheet, ScrollView, Animated, BackHandler, Keyboard, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainerRefWithCurrent, StackActions } from '@react-navigation/native';
import Icon from '../components/ui/Icon';
import { useV3Theme, v3Radius } from '../theme/v3';
import { useVisibilityMotion } from '../theme/motion';
import { AdaptiveModal } from '../components/ui/AdaptiveModal';
import { t as tr } from '../i18n';
import { useNavMenu, MenuItem } from './MenuContext';
import { MenuStyle, FAN_SLOTS, FAN_MAX, BAR_MAX, shownFavourites, navIdForRoute } from './menuModel';

const FAB = 54;
const EDGE = 16;
const BUBBLE = 48;
const RAIL_W = 244;

export function menuBottomRoom(style: MenuStyle): number {
  return style === 'list' || style === 'fan' ? EDGE + FAB + 8 : 0;
}

function Burger({ color }: { color: string }) {
  return (
    <View>
      <View style={[s.line, { backgroundColor: color }]} />
      <View style={[s.line, { backgroundColor: color, marginVertical: 4 }]} />
      <View style={[s.line, { backgroundColor: color }]} />
    </View>
  );
}

// The ☰ that folds the tablet's side menu: in Home's top bar and next to every page's back arrow.
export function MenuBurger() {
  const th = useV3Theme();
  const m = useNavMenu();
  return (
    <TouchableOpacity onPress={m.toggleRail} style={s.burgerBtn} accessibilityLabel={tr.menuButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Burger color={th.text} />
    </TouchableOpacity>
  );
}

export function MenuHost({ navRef, routeName, children }: {
  navRef: NavigationContainerRefWithCurrent<any>;
  routeName: string;
  children: React.ReactNode;
}) {
  const th = useV3Theme();
  const m = useNavMenu();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);       // the list, or the fan
  const [sheet, setSheet] = useState(false);     // every place, from More
  const [keyboard, setKeyboard] = useState(false);
  const pop = useVisibilityMotion(open);
  const shaded = useRef(pop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.34] })).current;

  function closeAll() { setOpen(false); setSheet(false); }

  // A new page or a new style starts with the menu closed.
  useEffect(() => { closeAll(); }, [routeName, m.style]);

  // Out of the way while typing (the Coach chat, names, search boxes).
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // The phone's Back closes an open menu before it leaves the page.
  useEffect(() => {
    if (!open && !sheet) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeAll(); return true; });
    return () => sub.remove();
  }, [open, sheet]);

  const presentIds = m.items.map(i => i.id);
  const selectedId = navIdForRoute(routeName, presentIds);
  const activeTab = routeName === 'Map' ? 'activities' : routeName === 'SettingsDetail' ? 'settings' : selectedId;
  const byId = (id: string) => m.items.find(i => i.id === id);

  function go(id: string) {
    closeAll();
    if (id === selectedId) return;                        // already there
    const item = m.itemsRef.current.find(i => i.id === id);
    if (!item) return;
    // Every jump starts from Home, so Back always leads to Home, not through a chain of pages.
    if (navRef.isReady() && navRef.getCurrentRoute()?.name !== 'Home') navRef.dispatch(StackActions.popToTop());
    item.onPress();
  }

  function Row({ item, onPress }: { item: MenuItem; onPress: () => void }) {
    const selected = item.id === selectedId;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [s.row, { backgroundColor: pressed || selected ? th.primary + '15' : 'transparent' }]}
      >
        <View style={[s.rowIcon, { backgroundColor: th.primary + '15' }]}>
          <Icon name={item.icon} size={18} color={th.primary} />
        </View>
        <Text style={[s.rowLabel, { color: th.text }]}>{item.label}</Text>
        <Icon name={selected ? 'check' : 'chevronRight'} size={16} color={selected ? th.primary : th.mutedText} />
      </Pressable>
    );
  }

  // ── Tablet: the side menu, on every page ──
  // The pages always sit in the same place in this tree, whatever the style: switching style then
  // only adds or removes the menu. (A different tree around the pages made React rebuild every page,
  // so Home started over and reconnected to the watch - found on the tablet, 02/11.)
  const side = m.style === 'side';
  const home = byId('home');
  const rest = m.items.filter(i => i.id !== 'home');
  const rail = side ? (
    <View style={[s.rail, {
      width: m.railOpen ? RAIL_W : 0,
      backgroundColor: th.card,
      borderRightColor: m.railOpen ? th.border : 'transparent',
    }]}>
      {/* fixed width inside, so nothing reflows while the side menu folds */}
      <View style={{ width: RAIL_W, flex: 1, paddingTop: insets.top }}>
        {home && <View style={s.pin}><Row item={home} onPress={() => go('home')} /></View>}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, paddingBottom: 8 + insets.bottom }}
          showsVerticalScrollIndicator={false}>
          {rest.map(it => <Row key={it.id} item={it} onPress={() => go(it.id)} />)}
        </ScrollView>
      </View>
    </View>
  ) : null;

  // ── The pop-up list, the fan-out and the floating bar, over the bottom of every page ──
  const show = !side && !keyboard && m.items.length > 0;
  const fabRight = EDGE + insets.right;
  const fabBottom = EDGE + insets.bottom;
  const cx = fabRight + FAB / 2;                 // the round ☰'s centre, from the right edge
  const cy = fabBottom + FAB / 2;                // ... and from the bottom edge

  const fanIds = [...shownFavourites(m.favourites.fan, presentIds, FAN_MAX), 'more'];
  const barIds = shownFavourites(m.favourites.bar, presentIds, BAR_MAX);
  const more = () => { setOpen(false); setSheet(true); };
  const groups = [
    { title: tr.menuGeneralGroup, items: m.items.filter(item => ['home', 'settings'].includes(item.id)) },
    { title: tr.menuTrainingGroup, items: m.items.filter(item => item.group === 'training' || ['totals', 'calendar'].includes(item.id)) },
    { title: tr.menuWatchGroup, items: m.items.filter(item => item.group === 'watch') },
    { title: tr.menuExploreGroup, items: m.items.filter(item => item.group === 'adv' ||
      (!item.group && !['home', 'settings', 'totals', 'calendar'].includes(item.id))) },
  ];

  return (
    <View style={[s.rowRoot, { backgroundColor: th.background }]}>
      {rail}
      <View style={s.colRoot}>
      {children}

      {show && (
        <>
          <Animated.View accessibilityElementsHidden={!open} pointerEvents={open ? 'auto' : 'none'} style={[s.scrim, { opacity: shaded }]}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeAll} accessibilityLabel={tr.menuClose} />
          </Animated.View>

          {m.style === 'list' && (
            <Animated.View
              pointerEvents={open ? 'auto' : 'none'}
              accessibilityElementsHidden={!open}
              style={[s.pop, {
                right: fabRight, bottom: fabBottom + FAB + 10,
                maxHeight: height - insets.top - fabBottom - FAB - 40,
                backgroundColor: th.card, borderColor: th.border, opacity: pop,
                transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
                transformOrigin: 'bottom right',
              }]}
            >
              <ScrollView contentContainerStyle={{ padding: 6 }} showsVerticalScrollIndicator={false}>
                {m.items.map(it => <Row key={it.id} item={it} onPress={() => go(it.id)} />)}
              </ScrollView>
            </Animated.View>
          )}

          {m.style === 'fan' && fanIds.map((id, i) => {
            const [left, up] = FAN_SLOTS[i];
            const isMore = id === 'more';
            const it = byId(id);
            const label = isMore ? tr.menuMore : it?.label ?? '';
            const sel = id === selectedId;
            return (
              <Animated.View
                key={id}
                accessibilityElementsHidden={!open}
                pointerEvents={open ? 'box-none' : 'none'}
                style={[s.fanWrap, {
                  right: cx - 48, bottom: cy - BUBBLE / 2, opacity: pop,
                  transform: [
                    { translateX: pop.interpolate({ inputRange: [0, 1], outputRange: [0, -left] }) },
                    { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, -up] }) },
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                  ],
                }]}
              >
                <TouchableOpacity
                  style={[s.bubble, { backgroundColor: sel ? th.primary : th.card, borderColor: sel ? th.primary : th.border }]}
                  onPress={isMore ? more : () => go(id)} accessibilityLabel={label}
                >
                  {isMore || !it
                    ? <Text style={[s.dots, { color: th.primary }]}>⋯</Text>
                    : <Icon name={it.icon} size={22} color={sel ? th.card : th.primary} />}
                </TouchableOpacity>
                <View style={s.fanLabelWrap} pointerEvents="none">
                  <Text style={[s.fanLabel, { color: th.text, backgroundColor: th.card }]} numberOfLines={1}>{label}</Text>
                </View>
              </Animated.View>
            );
          })}

          {(m.style === 'list' || m.style === 'fan') && (
            <TouchableOpacity
              style={[s.fab, { right: fabRight, bottom: fabBottom, backgroundColor: th.primary }]}
              activeOpacity={0.8}
              onPress={() => (open || sheet ? closeAll() : setOpen(true))}
              accessibilityLabel={open || sheet ? tr.menuClose : tr.menuButton}
            >
              {open || sheet
                ? <Text style={[s.cross, { color: th.card }]}>×</Text>
                : <Burger color={th.card} />}
            </TouchableOpacity>
          )}

        </>
      )}
      {show && m.style === 'bar' && (
        <View style={[s.barWrap, {
          backgroundColor: th.card, borderColor: th.border,
          paddingLeft: insets.left + 8, paddingRight: insets.right + 8, paddingBottom: Math.max(6, insets.bottom),
        }]}>
          <View style={s.bar}>
            {barIds.map(id => {
              const item = byId(id);
              if (!item) return null;
              const selected = id === activeTab;
              const color = selected ? th.primary : th.mutedText;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected }}
                  onPress={() => go(id)}
                  style={({ pressed }) => [s.barBtn, { opacity: pressed ? 0.65 : 1 }]}
                >
                  <View style={[s.tabIcon, selected && { backgroundColor: th.primary + '19' }]}>
                    <Icon name={item.icon} size={20} color={color} />
                  </View>
                  <Text numberOfLines={2} style={[s.tabLabel, { color }]}>{item.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr.menuMore}
              accessibilityState={{ expanded: sheet }}
              onPress={more}
              style={({ pressed }) => [s.barBtn, { opacity: pressed ? 0.65 : 1 }]}
            >
              <View style={s.tabIcon}><Text style={[s.dots, { color: th.mutedText }]}>⋯</Text></View>
              <Text style={[s.tabLabel, { color: th.mutedText }]}>{tr.menuMore}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {sheet && (
        <AdaptiveModal visible animationType="slide" presentationStyle="pageSheet"
          allowSwipeDismissal onRequestClose={closeAll}>
          <SafeAreaProvider>
            <SafeAreaView style={[s.sheet, { backgroundColor: th.background }]}>
              <View style={s.sheetHeader}>
                <Text accessibilityRole="header" style={[s.sheetTitle, { color: th.text }]}>{tr.menuMore}</Text>
                <Pressable accessibilityLabel={tr.menuClose} accessibilityRole="button" onPress={closeAll}
                  style={[s.close, { backgroundColor: th.cardNested }]}>
                  <Icon name="close" color={th.text} size={20} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={s.sheetContents}>
                {groups.filter(group => group.items.length > 0).map(group => (
                  <View key={group.title}>
                    <Text accessibilityRole="header" style={[s.groupTitle, { color: th.mutedText }]}>{group.title}</Text>
                    <View style={[s.groupBox, { backgroundColor: th.card, borderColor: th.border }]}>
                      {group.items.map(item => <Row key={item.id} item={item} onPress={() => go(item.id)} />)}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </SafeAreaView>
          </SafeAreaProvider>
        </AdaptiveModal>
      )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  rowRoot: { flex: 1, flexDirection: 'row' },
  colRoot: { flex: 1 },

  line: { width: 18, height: 2, borderRadius: 1 },
  burgerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },

  rail: { overflow: 'hidden', borderRightWidth: StyleSheet.hairlineWidth },
  pin: { padding: 8, paddingBottom: 0 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 12 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '500', flex: 1 },

  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 40 },

  pop: { position: 'absolute', zIndex: 50, width: 248, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },

  fanWrap: { position: 'absolute', zIndex: 50, width: 96, height: BUBBLE, alignItems: 'center' },
  bubble: { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  fanLabelWrap: { position: 'absolute', top: BUBBLE + 3, left: 0, right: 0, alignItems: 'center' },
  fanLabel: { fontSize: 11, fontWeight: '500', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden', maxWidth: 96 },
  dots: { fontSize: 20, lineHeight: 22, letterSpacing: 1 },

  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 10 },
  sheetTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sheetContents: { padding: 20, paddingTop: 6, gap: 20 },
  groupTitle: { fontSize: 13, fontWeight: '600', marginLeft: 10, marginBottom: 8 },
  groupBox: { borderRadius: v3Radius.card, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 5 },

  fab: { position: 'absolute', zIndex: 60, width: FAB, height: FAB, borderRadius: FAB / 2, alignItems: 'center', justifyContent: 'center' },
  cross: { fontSize: 30, lineHeight: 32, fontWeight: '300' },

  barWrap: { zIndex: 30, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 5, alignItems: 'center' },
  bar: { flexDirection: 'row', width: '100%', maxWidth: 570, alignItems: 'stretch' },
  barBtn: { flex: 1, minHeight: 45, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2, paddingBottom: 3 },
  tabIcon: { minWidth: 46, height: 25, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
