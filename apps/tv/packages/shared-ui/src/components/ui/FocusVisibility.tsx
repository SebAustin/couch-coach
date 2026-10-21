import { createContext, useContext } from 'react';

/**
 * Lets a screen keep its focus treatment hidden until the first D-pad press (Live: "the End session button is
 * not focused by default"). Defaults to visible everywhere else.
 */
export const FocusVisibilityContext = createContext(true);
export const useFocusVisible = (): boolean => useContext(FocusVisibilityContext);
