import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../../App';
import { ADVANCED_POWER_KEY } from '../components/activity/ActivityPanel';
import Icon, { type IconName } from '../components/ui/Icon';
import { Button, FieldRow, StatusNote, Toggle } from '../components/ui/primitives';
import { SettingsSection } from '../components/ui/SettingsSection';
import UpdateNotice from '../components/UpdateNotice';
import { useExperimental } from '../config/ExperimentalContext';
import { APP_VERSION } from '../config/version';
import { t } from '../i18n';
import { CREDITS_URL } from '../legal/credits';
import { detectAttachedDeviceType } from '../native/AmbitUsbModule';
import { checkNow, initAppUpdate, setAutoCheck, updateAvailable, updatesSupported, useAppUpdate } from '../services/AppUpdate';
import { clearAnthropicKey, getChatBackend, hasAnthropicKey, setAnthropicKey, setChatBackend, type ChatBackend } from '../services/CoachChat';
import { getLoadSource, setLoadSource, type LoadSource } from '../services/CoachService';
import { getUsdaApiKey, setUsdaApiKey } from '../services/EmberFood';
import { getEmberSyncCfg, setEmberSyncCfg } from '../services/EmberSync';
import { isEmberUnlocked } from '../services/EmberUnlock';
import { useThemeMode, type ThemeMode } from '../theme/ThemeModeContext';
import { useV3Theme } from '../theme/v3';

const COACH_SAMPLE_SESSIONS = 55;

const THEME_OPTIONS: { mode: ThemeMode; icon: IconName; label: () => string }[] = [
  { mode: 'light', icon: 'sun', label: () => t.themeLight },
  { mode: 'dark', icon: 'moon', label: () => t.themeDark },
  { mode: 'system', icon: 'auto', label: () => t.themeSystem },
];

function SwitchLine({ value, onValueChange, label, a11yLabel, accent = false }: {
  value: boolean; onValueChange: (v: boolean) => void; label: string;
  // What a screen reader calls the switch, when `label` is only its state ("On", "Off").
  a11yLabel?: string;
  // Desktop colours a state label primary while on (Theme.primary vs Theme.mutedText).
  accent?: boolean;
}) {
  const t = useV3Theme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 7,
      borderBottomColor: t.border, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => onValueChange(!value)} accessible={false}>
        <Text style={{ fontSize: 16, color: accent && value ? t.primary : t.text }}>{label}</Text>
      </TouchableOpacity>
      <Toggle value={value} onValueChange={onValueChange} accessibilityLabel={a11yLabel ?? label} />
    </View>
  );
}

// "03/11/2026 04:10", the date style used across the app.
function fmtChecked(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SettingsScreen() {
  const theme = useV3Theme();
  const update = useAppUpdate();
  useEffect(() => { initAppUpdate().catch(() => {}); }, []);
  const styles = createStyles(theme);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode, setMode } = useThemeMode();

  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>();
  const section = route.params?.section;
  const openSection = (id: string) => () => navigation.push('Settings', { section: id });
  const shows = (id: string) => !section || section === id;
  const generalSection = !!section && ['appearance', 'backup'].includes(section);
  const setDetailTitle = useCallback((title: string) => {
    navigation.setOptions({ title });
  }, [navigation]);

  const { features } = useExperimental();
  const [anthropicKey, setAnthropicKeyInput]        = useState('');
  const [anthropicSaved, setAnthropicSaved]         = useState(false);
  const [savingAnthropic, setSavingAnthropic]       = useState(false);
  // Settings -> Coach -> "Chat with a real AI coach" (desktop CoachService.chatBackend).
  const [chatBackend, setChatBackendState]          = useState<ChatBackend>('canned');
  // Settings -> Coach -> "Training load from Sommet" (sync/05, desktop CoachService.loadSource).
  const [loadSource, setLoadSourceState] = useState<LoadSource>('intervals');
  function handleLoadSource(on: boolean) {
    const v: LoadSource = on ? 'sommet' : 'intervals';
    setLoadSourceState(v);
    setLoadSource(v).catch(() => undefined);
  }
  function handleChatBackend(on: boolean) {
    const v: ChatBackend = on ? 'claude' : 'canned';
    setChatBackendState(v);
    setChatBackend(v).catch(() => undefined);
  }

  const [emberOn, setEmberOn]                       = useState(false);
  const [emberSyncUrl, setEmberSyncUrl]             = useState('');
  const [emberSyncToken, setEmberSyncToken]         = useState('');
  const [savingEmberSync, setSavingEmberSync]       = useState(false);
  // Personal USDA FoodData Central key for Ember's food search (2026-09-28); empty = DEMO_KEY.
  const [usdaKey, setUsdaKey]                       = useState('');

  const [advancedPower, setAdvancedPower] = useState(false);
  useEffect(() => { AsyncStorage.getItem(ADVANCED_POWER_KEY).then(v => setAdvancedPower(v === '1')).catch(() => undefined); }, []);
  function handleToggleAdvancedPower(v: boolean) {
    setAdvancedPower(v);
    AsyncStorage.setItem(ADVANCED_POWER_KEY, v ? '1' : '0').catch(() => undefined);
  }

  const [isGarminAttached, setIsGarminAttached] = useState(false);
  // Only detects whether a Garmin is attached, to hide the Firmware card below. Watch settings
  // moved to their own screen (WatchSettingsScreen, 2026-08-29), so this no longer reads the watch.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'ios') detectAttachedDeviceType().then(t => setIsGarminAttached(t === 'garmin')).catch(() => {});
  }, []));

  useFocusEffect(useCallback(() => {
    hasAnthropicKey().then(setAnthropicSaved);
    getChatBackend().then(setChatBackendState);
    getLoadSource().then(setLoadSourceState);
    isEmberUnlocked().then(setEmberOn);
    getEmberSyncCfg().then(c => { if (c) { setEmberSyncUrl(c.url); setEmberSyncToken(c.token); } });
    getUsdaApiKey().then(setUsdaKey);
  }, []));

  async function handleSaveEmberSync() {
    setSavingEmberSync(true);
    try {
      const url = emberSyncUrl.trim();
      await setEmberSyncCfg(url ? { url, token: emberSyncToken.trim() } : null);
      Alert.alert('Ember', url ? 'Ember sync saved.' : 'Ember sync cleared (local only).');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save');
    } finally {
      setSavingEmberSync(false);
    }
  }

  async function handleSaveAnthropic() {
    setSavingAnthropic(true);
    try {
      await setAnthropicKey(anthropicKey);
      setAnthropicSaved(true);
      setAnthropicKeyInput('');       // don't keep the secret in component state after saving
    } finally {
      setSavingAnthropic(false);
    }
  }

  async function handleRemoveAnthropic() {
    await clearAnthropicKey();
    setAnthropicSaved(false);
    setAnthropicKeyInput('');
  }

  return (
    <ScrollView key={section ?? 'settings'} style={styles.root} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      {!section && <Text accessibilityRole="header" style={styles.pageTitle}>{t.settingsTitle}</Text>}
      {(!section || generalSection) && (
        <View style={styles.group}>
      <SettingsSection title={t.appearanceSection} icon="auto" summary={THEME_OPTIONS.find(option => option.mode === mode)?.label()} visible={shows('appearance')}
        onDetailTitle={setDetailTitle} open={section === 'appearance'} onToggle={openSection('appearance')}>
        <Text style={styles.sectionDesc}>{t.appearanceDesc}</Text>
        {THEME_OPTIONS.map(option => (
          <TouchableOpacity key={option.mode} accessibilityRole="button" accessibilityLabel={option.label()} accessibilityState={{ selected: mode === option.mode }}
            onPress={() => setMode(option.mode)} style={[styles.preference, { borderBottomColor: theme.border }]}>
            <Icon name={option.icon} color={theme.mutedText} size={18} />
            <Text style={[styles.preferenceLabel, { color: theme.text }]}>{option.label()}</Text>
            {mode === option.mode && <Icon name="check" color={theme.primary} size={18} />}
          </TouchableOpacity>
        ))}
      </SettingsSection>
      <SettingsSection title={t.backupScreenTitle} icon="backup" visible={shows('backup')}
        onDetailTitle={setDetailTitle} open={section === 'backup'} onToggle={openSection('backup')} last>
        <Text style={styles.sectionDesc}>
          Back up your watch and app data, and restore from a backup.
        </Text>
        <Button label="Open backup & restore…" icon="backup" variant="outline"
          onPress={() => navigation.navigate('Backup')} style={{ marginTop: 10 }} />
      </SettingsSection>
        </View>
      )}
      {!generalSection && (
        <View style={styles.group}>
        <SettingsSection
          title="Activities"
          summary={`Advanced power numbers: ${advancedPower ? 'on' : 'off'}`}
          visible={shows('activities')} onDetailTitle={setDetailTitle} open={section === 'activities'} onToggle={openSection('activities')}
        >
          <SwitchLine value={advancedPower} onValueChange={handleToggleAdvancedPower} label="Advanced power numbers" />
          <Text style={styles.sectionDesc}>
            Adds normalized power, training load (TSS), intensity factor and work to rides with a power
            meter. Uses the FTP from your intervals.icu settings.
          </Text>
        </SettingsSection>
        {emberOn && (
        <SettingsSection
          title="Ember"
          summary="Ember sync · food search key"
          icon="ember"
          visible={shows('ember')} onDetailTitle={setDetailTitle} open={section === 'ember'} onToggle={openSection('ember')}
        >
          <Text style={styles.cardTitle}>Ember sync</Text>
          <Text style={styles.sectionDesc}>
            Shared store URL + token so Ember logs merge with your other devices (the same
            ember/sync.json the desktop uses). Leave blank to log on this device only.
          </Text>
          <FieldRow
            icon="link"
            value={emberSyncUrl}
            onChangeText={setEmberSyncUrl}
            placeholder="https://192.168.1.102/ember/sync.php"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FieldRow
            icon="key"
            value={emberSyncToken}
            onChangeText={setEmberSyncToken}
            placeholder="token"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.row}>
            <Button label={t.saveBtn} variant="filled" loading={savingEmberSync} onPress={handleSaveEmberSync} />
          </View>

          <Text style={[styles.cardTitle, { marginTop: 12 }]}>Food search</Text>
          <Text style={styles.sectionDesc}>
            Generic foods come from USDA FoodData Central. Without your own key a shared demo key
            is used, limited to about 30 searches an hour. The key is free and stays on this phone.
          </Text>
          <FieldRow
            icon="key"
            value={usdaKey}
            onChangeText={setUsdaKey}
            placeholder="USDA API key (optional)"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.row}>
            <Button label="Get a free key" variant="outline"
              onPress={() => Linking.openURL('https://fdc.nal.usda.gov/api-key-signup')} />
            <Button label={t.saveBtn} variant="filled"
              onPress={async () => { await setUsdaApiKey(usdaKey); Alert.alert('Ember', usdaKey.trim() ? 'USDA key saved.' : 'USDA key cleared (demo key).'); }} />
          </View>
        </SettingsSection>
        )}
        {features.coach && (
        <SettingsSection
          title="Coach"
          summary={`Load: ${loadSource === 'sommet' ? 'Sommet' : 'intervals.icu'} · replies: ${chatBackend === 'claude' ? 'Claude API' : 'pre-written'} · catalogue: bundled sample`}
          icon="coach"
          visible={shows('coach')} onDetailTitle={setDetailTitle} open={section === 'coach'} onToggle={openSection('coach')}
        >
          <Text style={[styles.connRowText, { fontWeight: '700' }]}>Chat with a real AI coach</Text>
          <Text style={[styles.sectionDesc, { fontSize: 11, lineHeight: 16, marginTop: 2 }]}>
            Off, the coach replies from a few pre-written answers. On, it talks to Claude about your
            real training. This needs an API key you create at console.anthropic.com — that's a
            developer key, separate from a claude.ai subscription (your normal Claude login won't
            work here), and it's billed separately, a few cents per chat.
          </Text>
          <SwitchLine
            value={chatBackend === 'claude'}
            onValueChange={handleChatBackend}
            label={chatBackend === 'claude' ? 'Claude API' : 'Canned replies'}
            a11yLabel="Chat with a real AI coach"
            accent
          />
          {chatBackend === 'claude' && (
            <>
              <FieldRow
                icon="key"
                value={anthropicKey}
                onChangeText={setAnthropicKeyInput}
                placeholder={anthropicSaved ? 'Key saved (enter to replace)' : 'Anthropic API key'}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                accessibilityLabel="Anthropic API key"
              />
              <View style={styles.row}>
                <Button label={t.saveBtn} variant="filled" grow={false} loading={savingAnthropic}
                        disabled={!anthropicKey.trim()} onPress={handleSaveAnthropic} />
                {anthropicSaved && (
                  <Button label="Clear" variant="outline" danger grow={false} onPress={handleRemoveAnthropic} />
                )}
              </View>
            </>
          )}
          <Text style={[styles.connRowText, { fontWeight: '700', marginTop: 16 }]}>Training load from Sommet</Text>
          <Text style={[styles.sectionDesc, { fontSize: 11, lineHeight: 16, marginTop: 2 }]}>
            Off, fitness, fatigue and form come from intervals.icu when it is connected, and from
            Sommet's own estimate when it isn't. On, always Sommet's estimate, worked out from the
            moves in this app. Compare the two on the Coach screen.
          </Text>
          <SwitchLine
            value={loadSource === 'sommet'}
            onValueChange={handleLoadSource}
            label={loadSource === 'sommet' ? 'Sommet' : 'intervals.icu'}
            a11yLabel="Training load from Sommet"
            accent
          />
          <Text style={[styles.connRowText, { fontWeight: '700', marginTop: 16 }]}>Workout catalogue</Text>
          <Text style={[styles.sectionDesc, { marginTop: 2 }]}>
            Bundled sample ({COACH_SAMPLE_SESSIONS} sessions). The live wahoo-systm-mcp catalogue is on
            the desktop app only.
          </Text>
        </SettingsSection>
        )}
        {!isGarminAttached && Platform.OS !== 'ios' && (
        <SettingsSection
          title="Firmware"
          summary="Flash watch firmware over USB"
          icon="watch"
          visible={shows('firmware')} onDetailTitle={setDetailTitle} open={section === 'firmware'} onToggle={openSection('firmware')}
        >
          <Text style={styles.sectionDesc}>
            Flash watch firmware over USB. Advanced and irreversible — intended for a supervised
            session. Opens the firmware tool.
          </Text>
          <Button label="Open firmware tool" icon="upload" variant="outline"
            onPress={() => navigation.navigate('Firmware')} style={{ marginTop: 10 }} />
        </SettingsSection>
        )}
        {isGarminAttached && (
        <SettingsSection
          title="Supported devices"
          summary="What Sommet can read, and how it connects"
          icon="settings"
          visible={shows('devices')} onDetailTitle={setDetailTitle} open={section === 'devices'} onToggle={openSection('devices')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.mutedText }} />
            <Text style={{ fontSize: 12, color: theme.mutedText }}>Suunto Ambit 3 (USB)</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.success }} />
            <Text style={{ fontSize: 12, color: theme.text }}>Garmin eTrex — connected</Text>
          </View>
        </SettingsSection>
        )}
        <SettingsSection
          title={t.aboutSection}
          summary={updateAvailable(update) && update.latest
            ? t.aboutVersionReady(APP_VERSION, update.latest.version) : t.aboutVersion(APP_VERSION)}
          visible={shows('about')} onDetailTitle={setDetailTitle} open={section === 'about'} onToggle={openSection('about')}
          last
        >
          <Text style={styles.sectionDesc}>{t.aboutVersion(APP_VERSION)}</Text>

          {/* Updates (André, 2026-11-03, 🟣124): is there a newer Sommet on GitHub? */}
          {updatesSupported() && (
            <View style={{ gap: 8, marginBottom: 6 }}>
              <UpdateNotice closable={false} maxHighlights={8} />
              <StatusNote
                tone={update.phase === 'checking' ? 'working' : update.status === 'error' ? 'error' : 'success'}
                closable={false}
                text={update.phase === 'checking' ? t.updateChecking
                  : update.status === 'error' ? t.updateError
                  : update.status === 'upToDate' ? t.updateUpToDate : ''}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Button grow={false} label={t.updateCheck} busy={update.phase === 'checking'}
                  onPress={() => { checkNow(); }} />
                {update.lastChecked != null && (
                  <Text style={{ fontSize: 12, color: theme.mutedText }}>
                    {t.updateLastChecked(fmtChecked(update.lastChecked))}
                  </Text>
                )}
              </View>
              <SwitchLine value={update.autoCheck} onValueChange={v => { setAutoCheck(v); }} label={t.updateAutoCheck} />
              <Text style={styles.sectionDesc}>{t.updateAutoCheckDesc}</Text>
            </View>
          )}
          <Text style={[styles.sectionDesc, { marginTop: 10 }]}>{t.aboutDisclaimer}</Text>
          <Text style={styles.sectionDesc}>{t.aboutLicenses}</Text>
          {/* The full credits list lives on GitHub, same page as the PC app (André, 2026-11-03). */}
          <Text style={styles.sectionDesc}>{t.aboutBuiltOn}</Text>
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Button variant="outline" grow={false} label={t.aboutCreditsLink}
              onPress={() => { Linking.openURL(CREDITS_URL).catch(() => {}); }} />
          </View>
        </SettingsSection>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { width: '100%', maxWidth: 710, alignSelf: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 28, gap: 20 },
  pageTitle: { color: t.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.8, marginHorizontal: 4, marginBottom: -6 },
  group: { backgroundColor: t.card, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  preference: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  connRowText: { color: t.text, fontSize: 14, flex: 1 },
  preferenceLabel: { flex: 1, fontSize: 16 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: t.text },
  sectionDesc: { fontSize: 14, color: t.mutedText, marginBottom: 8, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
