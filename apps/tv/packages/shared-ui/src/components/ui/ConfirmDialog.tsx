import React from 'react';
import { View } from 'react-native';
import { DefaultFocus, SpatialNavigationNode } from 'react-tv-space-navigation';
import { s } from '../../theme';
import { Button } from './Button';
import { Modal } from './Modal';
import { Txt } from './Txt';

interface Props {
  title: string;
  body?: string;
  /** Default-focused button (the safe choice). */
  keepLabel: string;
  confirmLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
}

/** Two-button confirm: the safe option is focused first and Back also picks it. */
export function ConfirmDialog({ title, body, keepLabel, confirmLabel, onKeep, onConfirm }: Props) {
  return (
    <Modal onBack={onKeep} width={960}>
      <Txt variant="h1" accessibilityRole="header">
        {title}
      </Txt>
      {body ? (
        <Txt variant="bodyL" color="#CDBFD6" style={{ marginTop: s(16) }}>
          {body}
        </Txt>
      ) : null}
      <SpatialNavigationNode orientation="horizontal">
        <View style={{ flexDirection: 'row', gap: s(32), marginTop: s(48), padding: s(12) }}>
          <DefaultFocus>
            <Button label={keepLabel} onSelect={onKeep} />
          </DefaultFocus>
          <Button label={confirmLabel} variant="secondary" onSelect={onConfirm} />
        </View>
      </SpatialNavigationNode>
    </Modal>
  );
}
