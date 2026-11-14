import { cfSetFor, THEMES, type CfSet, type ThemeColors } from '@media-tracker/shared';
import { createContext, useContext } from 'react';

/** The active CF set, for components that compute colors (RatingBadge, StatusPill). */
export const CfSetContext = createContext<CfSet>(cfSetFor('Midnight'));
export const useCfSet = (): CfSet => useContext(CfSetContext);

/** The active theme's 10 role colours (Custom already filled from Midnight), for contrast choices. */
export const ThemeColorsContext = createContext<ThemeColors>(THEMES.Midnight!);
export const useThemeColors = (): ThemeColors => useContext(ThemeColorsContext);
