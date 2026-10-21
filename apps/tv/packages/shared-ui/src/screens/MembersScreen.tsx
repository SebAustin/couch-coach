import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TextInput, View } from 'react-native';
import {
  DefaultFocus,
  SpatialNavigationNode,
  SpatialNavigationRoot,
  useLockSpatialNavigation,
  type SpatialNavigationNodeRef,
} from 'react-tv-space-navigation';
import type { Api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Focusable } from '../components/ui/Focusable';
import { PlusIcon } from '../components/ui/Icons';
import { Modal } from '../components/ui/Modal';
import { Screen } from '../components/ui/Screen';
import { Txt } from '../components/ui/Txt';
import { useNow } from '../hooks/useNow';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { glyphCount, initialOf, memberLayout } from '../lib/fit';
import { lastSeenLabel, newestSeenIndex } from '../lib/format';
import { color, radius, s } from '../theme';
import type { Member } from '../vendor/protocol';

/** Full tiles (up to 7 Members + Add = 2 rows) and compact tiles (up to 11 + Add = 3 rows). Both are 4 per row. */
const FULL = { width: 384, height: 300 } as const;
const COMPACT = { width: 384, height: 184 } as const;
const GAP = 32;
const PER_ROW = 4;
const RETRY_MS = 10_000;
/** A name longer than this steps down from 44 to 36 and may use two lines (an unbreakable 40-character name still fits). */
const LONG_NAME_GLYPHS = 12;

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; members: Member[] };

interface Props {
  api: Api;
  onPick: (member: Member) => void;
}

/** Start screen: choose a Member (or add one), then pair. */
export function MembersScreen({ api, onPick }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const now = useNow(60_000);

  useEffect(() => {
    let cancelled = false;
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    api
      .getMembers()
      .then((members) => !cancelled && setLoad({ status: 'ready', members }))
      .catch(() => !cancelled && setLoad({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [api, retryTick]);

  useEffect(() => {
    if (load.status !== 'error') return undefined;
    const id = setTimeout(() => setRetryTick((n) => n + 1), RETRY_MS);
    return () => clearTimeout(id);
  }, [load.status, retryTick]);

  const saveMember = useCallback(
    async (name: string) => {
      const created = await api.createMember(name);
      setAdding(false);
      setLoad((prev) => (prev.status === 'ready' ? { status: 'ready', members: [...prev.members, created] } : prev));
      return created;
    },
    [api],
  );

  return (
    <Screen>
      <SpatialNavigationRoot isActive={!adding}>
        <Header load={load} />
        {/* The content zone takes the rest of the screen and centres what is in it, so a short row of tiles
            sits at the optical middle instead of hugging the title with an empty bottom half. */}
        <View style={[styles.zone, { paddingBottom: s(48) }]}>
          {load.status === 'loading' && <LoadingTiles />}
          {load.status === 'error' && <ErrorCard onRetry={() => setRetryTick((n) => n + 1)} />}
          {load.status === 'ready' && (
            <Grid members={load.members} now={now} onPick={onPick} onAdd={() => setAdding(true)} />
          )}
        </View>
      </SpatialNavigationRoot>
      {adding && <AddMemberModal onCancel={() => setAdding(false)} onSave={saveMember} />}
    </Screen>
  );
}

function Header({ load }: { load: Load }) {
  const first = load.status === 'ready' && load.members.length === 0;
  return (
    <View style={{ marginBottom: s(32) }}>
      <Txt variant="label" color={color.textMuted}>
        Couch Coach
      </Txt>
      <Txt variant="display" accessibilityRole="header">
        {first ? "Let's meet your first Member" : "Who's working out?"}
      </Txt>
      <Txt variant="bodyL" color={color.textDim}>
        {first
          ? 'Add a name so the Coach can remember you.'
          : 'Pick a Member and the Coach picks up where you left off.'}
      </Txt>
    </View>
  );
}

function Grid({ members, now, onPick, onAdd }: { members: Member[]; now: number; onPick: (m: Member) => void; onAdd: () => void }) {
  const [focusRow, setFocusRow] = useState(0);
  const sorted = useMemo(() => [...members].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)), [members]);
  const layout = memberLayout(sorted.length);
  const shown = useMemo(() => sorted.slice(0, layout.shown), [sorted, layout.shown]);
  const size = layout.compact ? COMPACT : FULL;

  // Focus order is left to right, top to bottom, "Add member" last. Start on the newest Member, else Add.
  const items: (Member | null)[] = [...shown, null];
  const startIndex = shown.length === 0 ? 0 : newestSeenIndex(shown);
  const initial = startIndex < 0 ? shown.length : startIndex;
  const rows = Array.from({ length: Math.ceil(items.length / PER_ROW) }, (_, r) => items.slice(r * PER_ROW, (r + 1) * PER_ROW));

  return (
    <View>
      {/* alignInGrid: Down/Up keeps the column (Alex stays above Alex's column) instead of jumping to the last-focused tile. */}
      <SpatialNavigationNode orientation="vertical" alignInGrid>
        <View style={{ gap: s(GAP) }}>
          {rows.map((row, r) => (
            // The row holding focus is drawn above the rows below it, so the focus glow is not cut by the next row's tiles.
            <SpatialNavigationNode key={r} orientation="horizontal">
              <View style={{ flexDirection: 'row', gap: s(GAP), zIndex: r === focusRow ? 2 : 0 }}>
                {row.map((member, c) => {
                  const index = r * PER_ROW + c;
                  const onFocus = () => setFocusRow(r);
                  const tile = member ? (
                    <MemberTile
                      key={member.memberId}
                      member={member}
                      now={now}
                      compact={layout.compact}
                      size={size}
                      onFocus={onFocus}
                      onSelect={() => onPick(member)}
                    />
                  ) : (
                    <AddTile key="add" primary={shown.length === 0} compact={layout.compact} size={size} onFocus={onFocus} onSelect={onAdd} />
                  );
                  return index === initial ? <DefaultFocus key={tile.key}>{tile}</DefaultFocus> : tile;
                })}
              </View>
            </SpatialNavigationNode>
          ))}
        </View>
      </SpatialNavigationNode>
      {layout.hidden > 0 && (
        <Txt variant="body" color={color.textMuted} style={{ marginTop: s(24) }}>
          Showing your {layout.shown} most recent Members
        </Txt>
      )}
    </View>
  );
}

interface TileProps {
  compact: boolean;
  size: { width: number; height: number };
  onFocus: () => void;
  onSelect: () => void;
}

function MemberTile({ member, now, compact, size, onFocus, onSelect }: TileProps & { member: Member; now: number }) {
  const caption = lastSeenLabel(member.lastSeenAt, now);
  const long = glyphCount(member.name) > LONG_NAME_GLYPHS;
  const box = { width: s(size.width), height: s(size.height), borderRadius: s(radius.card) };
  const avatar = compact ? 72 : 96;
  return (
    <Focusable
      onSelect={onSelect}
      onFocus={onFocus}
      focusScale={1.06}
      cornerRadius={radius.card}
      accessibilityLabel={`${member.name}, ${caption.toLowerCase()}`}
    >
      <View
        style={[
          styles.tile,
          compact ? styles.tileCompact : styles.tileFull,
          box,
          { padding: s(compact ? 24 : 32), gap: s(compact ? 20 : 0) },
        ]}
      >
        <View style={[styles.avatar, { width: s(avatar), height: s(avatar), borderRadius: s(avatar / 2) }]}>
          <Txt variant="display" style={{ fontSize: s(compact ? 40 : 56), lineHeight: s(compact ? 52 : 68) }}>
            {initialOf(member.name)}
          </Txt>
        </View>
        <View style={compact ? styles.nameCompact : undefined}>
          {compact ? (
            <Txt variant="bodyBold" numberOfLines={2}>
              {member.name}
            </Txt>
          ) : (
            <Txt
              variant="h2"
              numberOfLines={long ? 2 : 1}
              style={long ? { fontSize: s(36), lineHeight: s(44) } : undefined}
            >
              {member.name}
            </Txt>
          )}
          <Txt variant="bodyS" color={color.textMuted} numberOfLines={1}>
            {caption}
          </Txt>
        </View>
      </View>
    </Focusable>
  );
}

function AddTile({ primary, compact, size, onFocus, onSelect }: TileProps & { primary: boolean }) {
  return (
    <Focusable onSelect={onSelect} onFocus={onFocus} focusScale={1.06} cornerRadius={radius.card} accessibilityLabel="Add member">
      <View
        style={[
          styles.tile,
          styles.addTile,
          {
            width: s(size.width),
            height: s(size.height),
            borderRadius: s(radius.card),
            padding: s(compact ? 24 : 32),
            borderWidth: s(3),
            borderColor: primary ? color.accent : color.textMuted,
            backgroundColor: primary ? color.raised : 'transparent',
            flexDirection: compact ? 'row' : 'column',
            gap: s(16),
          },
        ]}
      >
        <PlusIcon size={s(compact ? 56 : 72)} color={primary ? color.accent : color.textMuted} />
        <Txt variant={compact ? 'bodyBold' : 'h2'}>Add member</Txt>
      </View>
    </Focusable>
  );
}

/** Four placeholder tiles breathing together (one animated node, native driver); still under reduced motion. */
function LoadingTiles() {
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View>
      <Animated.View style={{ flexDirection: 'row', gap: s(GAP), opacity: pulse }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: s(FULL.width), height: s(FULL.height), borderRadius: s(radius.card), backgroundColor: color.raised }} />
        ))}
      </Animated.View>
      <Txt variant="body" color={color.textMuted} style={{ marginTop: s(24) }} accessibilityLiveRegion="polite">
        Loading Members...
      </Txt>
    </View>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ backgroundColor: color.raised, borderRadius: s(radius.card), padding: s(48), maxWidth: s(1000) }}>
      <Txt variant="h1">Can&apos;t reach Couch Coach</Txt>
      <Txt variant="bodyL" color={color.textDim} style={{ marginTop: s(12) }}>
        Check that the TV is online. We&apos;ll keep trying.
      </Txt>
      <SpatialNavigationNode orientation="horizontal">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(32), marginTop: s(32), padding: s(12) }}>
          <DefaultFocus>
            <Button label="Try again" onSelect={onRetry} />
          </DefaultFocus>
          <Txt variant="body" color={color.textMuted}>
            Trying again...
          </Txt>
        </View>
      </SpatialNavigationNode>
    </View>
  );
}

function AddMemberModal({ onCancel, onSave }: { onCancel: () => void; onSave: (name: string) => Promise<Member> }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave(trimmed);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onBack={onCancel}>
      <Txt variant="h1" accessibilityRole="header">
        Add a Member
      </Txt>
      <NameField value={name} onChange={setName} onSubmit={save} />
      <Txt variant="body" color={failed ? color.scorePoor : color.textMuted} style={{ marginTop: s(16) }} accessibilityLiveRegion="polite">
        {failed
          ? "Couldn't save. Try again."
          : trimmed
            ? 'Use the keyboard, or press the mic on your remote'
            : 'Enter a name to continue'}
      </Txt>
      <SpatialNavigationNode orientation="horizontal">
        <View style={{ flexDirection: 'row', gap: s(32), marginTop: s(32), padding: s(12) }}>
          <Button label={saving ? 'Saving...' : 'Save'} onSelect={save} disabled={!trimmed || saving} />
          <Button label="Cancel" variant="secondary" onSelect={onCancel} />
        </View>
      </SpatialNavigationNode>
    </Modal>
  );
}

/**
 * Text field. D-pad "select" focuses the native input (which opens the TV keyboard); while it has native focus
 * spatial navigation is locked so the keyboard owns the arrow keys.
 */
function NameField({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const input = React.useRef<TextInput>(null);
  const node = React.useRef<SpatialNavigationNodeRef>(null);
  const { lock, unlock } = useLockSpatialNavigation();
  return (
    <View style={{ marginTop: s(32), padding: s(12) }}>
      <Txt variant="label" color={color.textMuted} style={{ marginBottom: s(8) }}>
        Name
      </Txt>
      <DefaultFocus>
        <Focusable
          nodeRef={node}
          onSelect={() => input.current?.focus()}
          focusScale={1.02}
          cornerRadius={radius.button}
          accessibilityLabel="Name"
        >
          <View style={[styles.field, { minHeight: s(96), borderRadius: s(radius.button), paddingHorizontal: s(32) }]}>
            <TextInput
              ref={input}
              value={value}
              onChangeText={onChange}
              onFocus={lock}
              onBlur={unlock}
              onSubmitEditing={() => {
                input.current?.blur();
                onSubmit();
              }}
              maxLength={40}
              placeholder="Name"
              placeholderTextColor={color.textMuted}
              returnKeyType="done"
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Name"
              style={[styles.input, { fontSize: s(34), height: s(96) }]}
            />
          </View>
        </Focusable>
      </DefaultFocus>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { flex: 1, justifyContent: 'center' },
  tile: { backgroundColor: color.raised },
  tileFull: { justifyContent: 'space-between' },
  tileCompact: { flexDirection: 'row', alignItems: 'center' },
  nameCompact: { flex: 1 },
  addTile: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  avatar: { backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' },
  field: { backgroundColor: color.overlay, justifyContent: 'center' },
  input: { color: color.text, fontFamily: 'Figtree_500Medium', padding: 0 },
});
