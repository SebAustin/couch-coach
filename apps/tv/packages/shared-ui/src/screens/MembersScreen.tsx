import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
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
import { lastSeenLabel, newestSeenIndex } from '../lib/format';
import { color, radius, s } from '../theme';
import type { Member } from '../vendor/protocol';

const TILE = { width: 384, height: 300 } as const;
const GAP = 32;
const PER_ROW = 4;
/** Two rows of four: seven Members plus "Add member". A household is a handful of people. */
const MAX_MEMBERS = PER_ROW * 2 - 1;
const RETRY_MS = 10_000;

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
        {load.status === 'loading' && <LoadingTiles />}
        {load.status === 'error' && <ErrorCard onRetry={() => setRetryTick((n) => n + 1)} />}
        {load.status === 'ready' && (
          <Grid members={load.members} now={now} onPick={onPick} onAdd={() => setAdding(true)} />
        )}
      </SpatialNavigationRoot>
      {adding && <AddMemberModal onCancel={() => setAdding(false)} onSave={saveMember} />}
    </Screen>
  );
}

function Header({ load }: { load: Load }) {
  const first = load.status === 'ready' && load.members.length === 0;
  return (
    <View style={{ marginBottom: s(40) }}>
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
  const shown = useMemo(
    () => [...members].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)).slice(0, MAX_MEMBERS),
    [members],
  );
  // Focus order is left to right, top to bottom, "Add member" last. Start on the newest Member, else Add.
  const items: (Member | null)[] = [...shown, null];
  const startIndex = shown.length === 0 ? 0 : newestSeenIndex(shown);
  const initial = startIndex < 0 ? shown.length : startIndex;
  const rows = Array.from({ length: Math.ceil(items.length / PER_ROW) }, (_, r) => items.slice(r * PER_ROW, (r + 1) * PER_ROW));

  return (
    <SpatialNavigationNode orientation="vertical">
      <View style={{ gap: s(GAP) }}>
        {rows.map((row, r) => (
          <SpatialNavigationNode key={r} orientation="horizontal">
            <View style={{ flexDirection: 'row', gap: s(GAP) }}>
              {row.map((member, c) => {
                const index = r * PER_ROW + c;
                const tile = member ? (
                  <MemberTile key={member.memberId} member={member} now={now} onSelect={() => onPick(member)} />
                ) : (
                  <AddTile key="add" primary={shown.length === 0} onSelect={onAdd} />
                );
                return index === initial ? <DefaultFocus key={tile.key}>{tile}</DefaultFocus> : tile;
              })}
            </View>
          </SpatialNavigationNode>
        ))}
      </View>
    </SpatialNavigationNode>
  );
}

function MemberTile({ member, now, onSelect }: { member: Member; now: number; onSelect: () => void }) {
  const caption = lastSeenLabel(member.lastSeenAt, now);
  return (
    <Focusable
      onSelect={onSelect}
      focusScale={1.06}
      cornerRadius={radius.card}
      accessibilityLabel={`${member.name}, ${caption.toLowerCase()}`}
    >
      <View style={[styles.tile, { width: s(TILE.width), height: s(TILE.height), borderRadius: s(radius.card), padding: s(32) }]}>
        <View style={[styles.avatar, { width: s(96), height: s(96), borderRadius: s(48) }]}>
          <Txt variant="display" style={{ fontSize: s(56), lineHeight: s(68) }}>
            {member.name.charAt(0).toUpperCase()}
          </Txt>
        </View>
        <View>
          <Txt variant="h2" numberOfLines={1}>
            {member.name}
          </Txt>
          <Txt variant="body" color={color.textMuted}>
            {caption}
          </Txt>
        </View>
      </View>
    </Focusable>
  );
}

function AddTile({ primary, onSelect }: { primary: boolean; onSelect: () => void }) {
  return (
    <Focusable onSelect={onSelect} focusScale={1.06} cornerRadius={radius.card} accessibilityLabel="Add member">
      <View
        style={[
          styles.tile,
          styles.addTile,
          {
            width: s(TILE.width),
            height: s(TILE.height),
            borderRadius: s(radius.card),
            padding: s(32),
            borderWidth: s(3),
            borderColor: primary ? color.accent : color.textMuted,
            backgroundColor: primary ? color.raised : 'transparent',
          },
        ]}
      >
        <PlusIcon size={s(72)} color={primary ? color.accent : color.textMuted} />
        <Txt variant="h2">Add member</Txt>
      </View>
    </Focusable>
  );
}

function LoadingTiles() {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: s(GAP), opacity: 0.5 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: s(TILE.width), height: s(TILE.height), borderRadius: s(radius.card), backgroundColor: color.raised }} />
        ))}
      </View>
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
  tile: { backgroundColor: color.raised, justifyContent: 'space-between' },
  addTile: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', gap: 16 },
  avatar: { backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' },
  field: { backgroundColor: color.overlay, justifyContent: 'center' },
  input: { color: color.text, fontFamily: 'Figtree_500Medium', padding: 0 },
});
