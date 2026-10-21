import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { color, s } from '../../theme';

const RADIUS = 1100;

/** The static lamp glow in the top-left of every screen: `radial-gradient(1100px at 8% 0%, lampGlow, transparent)`. */
export function LampGlow() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.width > 0 && (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <RadialGradient
              id="lamp"
              cx={size.width * 0.08}
              cy={0}
              r={s(RADIUS)}
              fx={size.width * 0.08}
              fy={0}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={color.accent} stopOpacity={0.14} />
              <Stop offset="1" stopColor={color.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#lamp)" />
        </Svg>
      )}
    </View>
  );
}
