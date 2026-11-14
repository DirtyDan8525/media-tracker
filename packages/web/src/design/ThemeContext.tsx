import { cfSetFor, type CfSet } from '@media-tracker/shared';
import { createContext, useContext } from 'react';

/** The active CF set, for components that compute colors (RatingBadge, StatusPill). */
export const CfSetContext = createContext<CfSet>(cfSetFor('Midnight'));
export const useCfSet = (): CfSet => useContext(CfSetContext);
