import { useThemeMode } from './ThemeModeContext';

export interface V3Colors {
  background: string;
  surface: string;
  card: string;
  cardNested: string;
  border: string;
  borderStrong: string;
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  hard: string;
  tempered: string;
  error: string;
  text: string;
  mutedText: string;
}

// Warm mineral neutrals and a blue accent that stays legible over both appearances.
export const v3Light: V3Colors = {
  background: '#F4F4F7',
  surface: '#ECECF2',
  card: '#FFFFFF',
  cardNested: '#F0F0F5',
  border: '#E0E1E9',
  borderStrong: '#C6C8D5',
  primary: '#344AC8',
  secondary: '#4A5066',
  accent: '#535FD7',
  success: '#176843',
  warning: '#805300',
  hard: '#A34818',
  tempered: '#546625',
  error: '#AE283C',
  text: '#151827',
  mutedText: '#53596D',
};

export const v3Dark: V3Colors = {
  background: '#101116',
  surface: '#171920',
  card: '#1B1D26',
  cardNested: '#252835',
  border: '#303444',
  borderStrong: '#484D62',
  primary: '#ABB6FF',
  secondary: '#CDD1E5',
  accent: '#8A9CFF',
  success: '#72DCA5',
  warning: '#F5C471',
  hard: '#FFA976',
  tempered: '#C1CE79',
  error: '#FF91A0',
  text: '#F6F6FA',
  mutedText: '#B2B7CC',
};

export const v3Spacing = { small: 8, medium: 16, large: 24, page: 8 };
export const v3Radius = { small: 12, card: 22, sheet: 28 };

export const v3Type = {
  tiny: 11,
  caption: 12,
  label: 13,
  body: 15,
  bodyLarge: 16,
  subtitle: 17,
  heading: 19,
  title: 22,
  largeTitle: 26,
  display: 34,
};

export function useV3Theme(): V3Colors {
  const { isDark } = useThemeMode();
  return isDark ? v3Dark : v3Light;
}
