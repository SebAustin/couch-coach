import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useFadeIn } from '../../hooks/useFadeIn';
import { useBackHandler } from '../../navigation/backStack';
import { color, motion, radius, s } from '../../theme';
import { FocusVisibilityContext } from './FocusVisibility';

interface Props {
  /** Back closes the layer (Cancel / Keep going). */
  onBack: () => void;
  width?: number;
  children: React.ReactNode;
}

/**
 * Dialog layer: dims the screen (scrim), owns D-pad focus through its own spatial-navigation root, and takes
 * the Back key first. Mount it only while open; the screen below should set `isActive={false}` on its root.
 * The scrim and card fade in together (opacity only: the card holds focusable nodes, so it never moves or scales).
 */
export function Modal({ onBack, width = 960, children }: Props) {
  useBackHandler(onBack);
  const opacity = useFadeIn(motion.exit);
  return (
    <Animated.View style={[styles.scrim, { opacity }]} accessibilityViewIsModal>
      {/* A dialog always shows its focus, even over a screen that hides focus until the first key press. */}
      <FocusVisibilityContext.Provider value>
        <SpatialNavigationRoot isActive>
          <View style={[styles.card, { width: s(width), borderRadius: s(radius.card), padding: s(48) }]}>{children}</View>
        </SpatialNavigationRoot>
      </FocusVisibilityContext.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  card: { backgroundColor: color.raised },
});
