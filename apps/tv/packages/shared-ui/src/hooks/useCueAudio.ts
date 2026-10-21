import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { isTrustedAudioUrl } from '../lib/audioUrl';

export type CueAudioState = 'none' | 'loading' | 'playing' | 'idle' | 'unavailable';

/** How long to wait for the audio file to load before calling it unavailable. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * Plays the Cue's Polly audio once when it is ready. Audio is a bonus: the Cue card is the caption, so any
 * failure (blocked autoplay, 403 on an expired presigned URL, no network) only changes the label.
 */
export function useCueAudio(cueAudioUrl: string | undefined): { state: CueAudioState; replay: () => void } {
  const audioUrl = isTrustedAudioUrl(cueAudioUrl) ? cueAudioUrl : undefined;
  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);
  const status = useAudioPlayerStatus(player);
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    started.current = false;
    setFailed(false);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl || !status.isLoaded || started.current) return;
    started.current = true;
    try {
      player.play();
    } catch {
      setFailed(true);
    }
  }, [audioUrl, status.isLoaded, player]);

  useEffect(() => {
    if (!audioUrl || status.isLoaded) return undefined;
    const id = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [audioUrl, status.isLoaded]);

  const replay = useCallback(() => {
    try {
      void player.seekTo(0);
      player.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [player]);

  let state: CueAudioState;
  if (!audioUrl) state = 'none';
  else if (failed && !status.playing) state = 'unavailable';
  else if (status.playing) state = 'playing';
  else if (!status.isLoaded) state = 'loading';
  else state = 'idle';
  return { state, replay };
}
