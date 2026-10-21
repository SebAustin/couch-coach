import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color as palette } from '../../theme';

interface IconProps {
  size: number;
  color?: string;
}

/** Triangle with "!" (Fault chips: a shape cue as well as color). */
export function WarnIcon({ size, color = palette.scorePoor }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M12 3 L22 20 H2 Z" fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" />
      <Path d="M12 9.5 V14.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={12} cy={17.3} r={1.3} fill={color} />
    </Svg>
  );
}

export function CheckIcon({ size, color = palette.scoreGood }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={2.2} />
      <Path d="M7 12.5 L10.5 16 L17 8.5" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CrossIcon({ size, color = palette.scorePoor }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={2.2} />
      <Path d="M8 8 L16 16 M16 8 L8 16" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function SpeakerIcon({ size, color = palette.onAccent }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 9.5 H8 L13 5.5 V18.5 L8 14.5 H4 Z" fill={color} />
      <Path d="M16 8.5 Q18.5 12 16 15.5 M18.5 6 Q22.5 12 18.5 18" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function PlusIcon({ size, color = palette.textMuted }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={10.5} y={3} width={3} height={18} rx={1.5} fill={color} />
      <Rect x={3} y={10.5} width={18} height={3} rx={1.5} fill={color} />
    </Svg>
  );
}
