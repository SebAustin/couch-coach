import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { color, radius, s } from '../../theme';
import { Focusable } from './Focusable';
import { Txt } from './Txt';

export interface ButtonProps {
  label: string;
  onSelect: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  accessibilityLabel?: string;
  minWidth?: number;
  nodeRef?: React.Ref<SpatialNavigationNodeRef>;
  onFocus?: () => void;
  /** The button sits on an `overlay` surface (Cue card): use a lighter fill so its edge stays visible. */
  onOverlay?: boolean;
}

/** TV button: >= 96 high (design px), accent fill for the primary action. */
export function Button({
  label,
  onSelect,
  variant = 'primary',
  disabled,
  accessibilityLabel,
  minWidth = 280,
  nodeRef,
  onFocus,
  onOverlay,
}: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Focusable
      onSelect={onSelect}
      onFocus={onFocus}
      nodeRef={nodeRef}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      cornerRadius={radius.button}
      focusScale={1.08}
    >
      <View
        style={[
          styles.base,
          { minWidth: s(minWidth), minHeight: s(96), borderRadius: s(radius.button) },
          primary ? { backgroundColor: color.accent } : { backgroundColor: onOverlay ? color.track : color.overlay },
          disabled && styles.disabled,
        ]}
      >
        <Txt variant="bodyBold" color={primary ? color.onAccent : color.text}>
          {label}
        </Txt>
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  disabled: { opacity: 0.45 },
});
