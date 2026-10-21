import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { color as palette, s, type } from '../../theme';

export type TxtVariant = keyof typeof type;

export interface TxtProps extends TextProps {
  variant?: TxtVariant;
  color?: string;
  /** Uppercase (labels). */
  upper?: boolean;
  align?: TextStyle['textAlign'];
}

/** Text in the Lamplight type scale. Numbers always use tabular figures so counters don't jitter. */
export function Txt({ variant = 'body', color = palette.text, upper, align, style, children, ...rest }: TxtProps) {
  const t = type[variant];
  const letterSpacing = 'letterSpacing' in t ? t.letterSpacing : undefined;
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: s(t.fontSize),
          lineHeight: s(t.lineHeight),
          fontFamily: t.fontFamily,
          color,
          fontVariant: ['tabular-nums'],
          textAlign: align,
          textTransform: upper || variant === 'label' ? 'uppercase' : undefined,
          letterSpacing: letterSpacing ? s(letterSpacing) : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
