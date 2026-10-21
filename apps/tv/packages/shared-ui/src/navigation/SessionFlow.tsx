import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../api/client';
import { useSessionStream } from '../hooks/useSessionStream';
import { buildRecap, type Recap } from '../lib/recap';
import { LiveScreen } from '../screens/live/LiveScreen';
import { PairScreen, type PairView } from '../screens/PairScreen';
import { RecapScreen } from '../screens/RecapScreen';
import type { Member, SessionResponse } from '../vendor/protocol';
import { useBackHandler } from './backStack';

/** How long "Phone connected" stays up before Live (docs/ux.md 2.2). */
const CONNECTED_HOLD_MS = 800;

type Phase = 'pair' | 'live' | 'recap';

interface Props {
  api: Api;
  member: Member;
  /** Back to the Members screen. */
  onExit: () => void;
  /** Demo/debug: join an existing Session instead of creating one (see attachLink.ts). */
  initialSession?: SessionResponse;
}

/** One Member's Session end to end: Pair -> Live -> Recap, owning the events connection for its lifetime. */
export function SessionFlow({ api, member, onExit, initialSession }: Props) {
  const [phase, setPhase] = useState<Phase>(initialSession ? 'live' : 'pair'); // an attached Session has already said hello
  const [view, setView] = useState<PairView>(
    initialSession ? { status: 'ready', session: initialSession, createdAt: Date.now() } : { status: 'loading' },
  );
  const [recap, setRecap] = useState<Recap | null>(null);
  const sessionId = view.status === 'ready' ? view.session.sessionId : null;
  const stream = useSessionStream(sessionId);
  const latestState = useRef(stream.state);
  latestState.current = stream.state;
  const requestId = useRef(0);

  const createSession = useCallback(() => {
    const id = (requestId.current += 1);
    setView({ status: 'loading' });
    api
      .createSession(member.memberId)
      .then((session) => id === requestId.current && setView({ status: 'ready', session, createdAt: Date.now() }))
      .catch(() => id === requestId.current && setView({ status: 'error' }));
  }, [api, member.memberId]);

  useEffect(() => {
    if (!initialSession) createSession();
    return () => {
      requestId.current += 1; // ignore a response that lands after we left
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSession]);

  // The phone said hello: hold "Phone connected" briefly, then go Live.
  useEffect(() => {
    if (phase !== 'pair' || !stream.state.hasPhone) return undefined;
    const id = setTimeout(() => setPhase('live'), CONNECTED_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase, stream.state.hasPhone]);

  useBackHandler(onExit, phase === 'pair');

  const handleEnded = useCallback(() => {
    setRecap(buildRecap(latestState.current));
    stream.close();
    setPhase('recap');
  }, [stream]);

  const restart = useCallback(() => {
    setRecap(null);
    setPhase('pair');
    createSession();
  }, [createSession]);

  if (phase === 'recap' && recap) {
    return <RecapScreen member={member} recap={recap} onDone={onExit} onSameMemberAgain={restart} />;
  }
  if (phase === 'live' && sessionId) {
    return <LiveScreen member={member} sessionId={sessionId} stream={stream} onEnded={handleEnded} onNewCode={restart} />;
  }
  return (
    <PairScreen
      member={member}
      view={view}
      phoneConnected={stream.state.hasPhone}
      onNewCode={createSession}
      onChangeMember={onExit}
    />
  );
}
