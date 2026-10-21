import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { DefaultFocus, SpatialNavigationNode, SpatialNavigationRoot, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { pairingUrl, shortUrlHint } from '../api/client';
import { Button } from '../components/ui/Button';
import { CheckIcon } from '../components/ui/Icons';
import { Screen } from '../components/ui/Screen';
import { Txt } from '../components/ui/Txt';
import { useNow } from '../hooks/useNow';
import { expiresAtMs, formatCountdown } from '../lib/format';
import { color, radius, s } from '../theme';
import type { Member, SessionResponse } from '../vendor/protocol';

export type PairView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; session: SessionResponse; createdAt: number };

interface Props {
  member: Member;
  view: PairView;
  /** The phone said hello: show "Phone connected" before moving on. */
  phoneConnected: boolean;
  onNewCode: () => void;
  onChangeMember: () => void;
}

const QR_SIZE = 448;
const QR_CARD = 560;
const HURRY_MS = 60_000;
const STEPS = [
  "Point your phone's camera at this code.",
  'Tap the link and allow camera access.',
  'Prop your phone upright, 2-3 m away, so your whole body fits in the frame.',
] as const;

/** Pair: a large QR for the phone, three steps, the expiry countdown, and "New code" / "Change Member". */
export function PairScreen({ member, view, phoneConnected, onNewCode, onChangeMember }: Props) {
  const ready = view.status === 'ready' ? view : null;
  const now = useNow(1000);
  const newCodeRef = useRef<SpatialNavigationNodeRef>(null);

  const expiresMs = ready ? expiresAtMs(ready.session.expiresAt) : 0;
  const remaining = ready ? expiresMs - now : 0;
  const expired = ready !== null && remaining <= 0 && !phoneConnected;

  useEffect(() => {
    if (expired) newCodeRef.current?.focus(); // the one place the spec moves focus by itself
  }, [expired]);

  return (
    <Screen>
      <SpatialNavigationRoot isActive>
      <Txt variant="label" color={color.textMuted}>
        Pairing for {member.name}
      </Txt>
      <Txt variant="display" accessibilityRole="header">
        Scan to join
      </Txt>

      <View style={[styles.row, { gap: s(64), marginTop: s(24) }]}>
        <QrCard view={view} expired={expired} url={ready ? pairingUrl(ready.session.phoneUrl, member.memberId) : ''} />
        <View style={styles.steps}>
          {STEPS.map((text, i) => (
            <View key={text} style={[styles.step, { gap: s(24), marginBottom: s(32) }]}>
              <View style={[styles.numeral, { width: s(56), height: s(56), borderRadius: s(28) }]}>
                <Txt variant="bodyBold" color={color.onAccent}>
                  {i + 1}
                </Txt>
              </View>
              <Txt variant="bodyL" style={{ flex: 1 }}>
                {text}
              </Txt>
            </View>
          ))}
          <Status phoneConnected={phoneConnected} />
          {ready && (
            <Txt variant="body" color={color.textMuted} style={{ marginTop: s(16) }}>
              Link opens {shortUrlHint(ready.session.phoneUrl)}
            </Txt>
          )}
        </View>
      </View>

      <View style={{ marginTop: 'auto' }}>
        <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, marginRight: s(48) }}>
            <Expiry ready={ready !== null} remaining={remaining} />
            <ExpiryBar fraction={ready ? clamp01(remaining / Math.max(1, expiresMs - ready.createdAt)) : 0} />
          </View>
          <SpatialNavigationNode orientation="horizontal">
            <View style={[styles.row, { gap: s(32), padding: s(12) }]}>
              <DefaultFocus>
                <Button label="New code" onSelect={onNewCode} nodeRef={newCodeRef} minWidth={280} />
              </DefaultFocus>
              <Button label="Change Member" variant="secondary" onSelect={onChangeMember} minWidth={340} />
            </View>
          </SpatialNavigationNode>
        </View>
      </View>
      </SpatialNavigationRoot>
    </Screen>
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function QrCard({ view, expired, url }: { view: PairView; expired: boolean; url: string }) {
  return (
    <View
      style={[styles.qrCard, { width: s(QR_CARD), height: s(QR_CARD), borderRadius: s(radius.card), padding: s(56) }]}
      accessible
      accessibilityLabel="Pairing Code. Scan with your phone's camera."
    >
      {view.status === 'ready' && (
        <View style={{ opacity: expired ? 0.15 : 1 }}>
          <QRCode value={url} size={s(QR_SIZE)} quietZone={s(32)} color={color.ink} backgroundColor={color.white} ecl="M" />
        </View>
      )}
      {view.status === 'loading' && (
        <Txt variant="bodyL" color={color.ink} align="center" accessibilityLiveRegion="polite">
          Creating your Pairing Code...
        </Txt>
      )}
      {view.status === 'error' && (
        <View>
          <Txt variant="h2" color={color.ink} align="center">
            Couldn&apos;t create a code
          </Txt>
          <Txt variant="body" color={color.ink} align="center" style={{ marginTop: s(12) }}>
            Check your connection and try again.
          </Txt>
        </View>
      )}
      {expired && (
        <View style={[StyleSheet.absoluteFill, styles.expired]}>
          <Txt variant="h1" color={color.ink}>
            Code expired
          </Txt>
        </View>
      )}
    </View>
  );
}

function Status({ phoneConnected }: { phoneConnected: boolean }) {
  const pulse = useNow(800);
  const dotOn = Math.floor(pulse / 800) % 2 === 0;
  return (
    <View style={[styles.step, { gap: s(16) }]} accessibilityLiveRegion="polite">
      {phoneConnected ? (
        <>
          <CheckIcon size={s(40)} />
          <Txt variant="bodyBold" color={color.scoreGood}>
            Phone connected
          </Txt>
        </>
      ) : (
        <>
          <View style={{ width: s(20), height: s(20), borderRadius: s(10), backgroundColor: color.accent, opacity: dotOn ? 1 : 0.4 }} />
          <Txt variant="bodyBold" color={color.textDim}>
            Waiting for your phone...
          </Txt>
        </>
      )}
    </View>
  );
}

function Expiry({ ready, remaining }: { ready: boolean; remaining: number }) {
  if (!ready) return <Txt variant="bodyBold"> </Txt>;
  if (remaining <= 0) return <Txt variant="bodyBold" color={color.scoreOk}>Code expired</Txt>;
  const hurry = remaining < HURRY_MS;
  return (
    <Txt variant="bodyBold" color={hurry ? color.scoreOk : color.textDim} accessibilityLabel={`Code expires in ${formatCountdown(remaining)}`}>
      {hurry ? 'Hurry: ' : ''}Code expires in {formatCountdown(remaining)}
    </Txt>
  );
}

/** Remaining-time bar: scaleX from the left (transform only, per the motion rules). */
function ExpiryBar({ fraction }: { fraction: number }) {
  const width = s(720);
  return (
    <View style={{ width, height: s(12), borderRadius: s(6), backgroundColor: color.track, overflow: 'hidden', marginTop: s(12) }}>
      <View
        style={{
          width,
          height: s(12),
          borderRadius: s(6),
          backgroundColor: fraction < 0.25 ? color.scoreOk : color.accent,
          transform: [{ translateX: (-width / 2) * (1 - fraction) }, { scaleX: fraction }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  qrCard: { backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  steps: { flex: 1, justifyContent: 'center' },
  step: { flexDirection: 'row', alignItems: 'center' },
  numeral: { backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  expired: { alignItems: 'center', justifyContent: 'center' },
});
