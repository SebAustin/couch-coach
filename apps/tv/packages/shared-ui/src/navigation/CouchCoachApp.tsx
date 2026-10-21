import '../app/configureRemoteControl';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { createApi } from '../api/client';
import { Txt } from '../components/ui/Txt';
import { config, isPlaceholderConfig } from '../config';
import { MembersScreen } from '../screens/MembersScreen';
import { color, s } from '../theme';
import type { Member, SessionResponse } from '../vendor/protocol';
import { parseAttachLink, type AttachRequest } from './attachLink';
import { dispatchBack } from './backStack';
import { SessionFlow } from './SessionFlow';

export interface CouchCoachAppProps {
  /** Hold the UI until fonts are ready (the host app passes expo-font's loaded flag). */
  fontsLoaded?: boolean;
}

/** Wires the system Back key (Android BackHandler, or Backspace/Escape on web) to the in-app back stack. */
function useSystemBack(): void {
  useEffect(() => {
    if (Platform.OS === 'web') {
      const listener = (key: SupportedKeys) => {
        if (key === SupportedKeys.Back) dispatchBack();
      };
      RemoteControlManager.addKeydownListener(listener);
      return () => RemoteControlManager.removeKeydownListener(listener);
    }
    // Returning false when nothing handled it lets the OS leave the app (Back on Members exits).
    const sub = BackHandler.addEventListener('hardwareBackPress', () => dispatchBack());
    return () => sub.remove();
  }, []);
}

/** Listens for the demo `attach` deep link (Android intent, or the URL on web). */
function useAttachLink(onAttach: (request: AttachRequest) => void): void {
  useEffect(() => {
    const handle = (url: string | null) => {
      const request = parseAttachLink(url);
      if (request) onAttach(request);
    };
    if (Platform.OS === 'web') {
      handle(typeof window === 'undefined' ? null : window.location.href);
      return undefined;
    }
    Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => sub.remove();
  }, [onAttach]);
}

const SYNTHETIC_TTL_MS = 10 * 60_000;

function attachedSession(request: AttachRequest): SessionResponse {
  return {
    sessionId: request.sessionId,
    phoneToken: '',
    phoneUrl: `${config.phoneUrl}/?s=${request.sessionId}`,
    expiresAt: Date.now() + SYNTHETIC_TTL_MS,
    memberId: request.memberId,
  };
}

/** App root: Members -> (Pair -> Live -> Recap) -> Members. No router; the flow is a small state machine. */
export function CouchCoachApp({ fontsLoaded = true }: CouchCoachAppProps) {
  const api = useMemo(() => createApi(config), []);
  const [member, setMember] = useState<Member | null>(null);
  const [attached, setAttached] = useState<SessionResponse | undefined>(undefined);
  useSystemBack();
  useAttachLink(
    useCallback((request: AttachRequest) => {
      setAttached(attachedSession(request));
      setMember({ memberId: request.memberId, name: request.name });
    }, []),
  );

  if (!fontsLoaded) return null;
  return (
    <View style={styles.root}>
      {member ? (
        <SessionFlow
          key={`${member.memberId}:${attached?.sessionId ?? ''}`}
          api={api}
          member={member}
          initialSession={attached}
          onExit={() => {
            setAttached(undefined);
            setMember(null);
          }}
        />
      ) : (
        <MembersScreen api={api} onPick={setMember} />
      )}
      {isPlaceholderConfig && (
        <View style={[styles.notice, { top: s(8), right: s(96), paddingHorizontal: s(16) }]} pointerEvents="none">
          <Txt variant="label" color={color.onScore} upper={false} style={{ textTransform: 'none' }}>
            Setup needed: run yarn sync (no infra/client-config.json)
          </Txt>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  notice: { position: 'absolute', backgroundColor: color.scoreOk, borderRadius: 8, zIndex: 100 },
});
