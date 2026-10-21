import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useRetainedValue } from '../useRetainedValue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Seen = { value: string | null; leaving: boolean };

function Probe({ value, holdMs, onRender }: { value: string | null; holdMs: number; onRender: (seen: Seen) => void }) {
  onRender(useRetainedValue(value, holdMs));
  return null;
}

describe('useRetainedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps showing the last value while it leaves, then lets go', () => {
    const renders: Seen[] = [];
    const record = (seen: Seen) => renders.push(seen);
    const last = () => renders[renders.length - 1];
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Probe value="cue" holdMs={200} onRender={record} />);
    });
    expect(last()).toEqual({ value: 'cue', leaving: false });

    act(() => {
      renderer.update(<Probe value={null} holdMs={200} onRender={record} />);
    });
    expect(last()).toEqual({ value: 'cue', leaving: true });

    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(last()).toEqual({ value: 'cue', leaving: true });

    act(() => {
      jest.advanceTimersByTime(60);
    });
    expect(last()).toEqual({ value: null, leaving: false });
    act(() => renderer.unmount());
  });

  it('cancels the exit when a new value arrives mid-way', () => {
    const renders: Seen[] = [];
    const record = (seen: Seen) => renders.push(seen);
    const last = () => renders[renders.length - 1];
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Probe value="a" holdMs={200} onRender={record} />);
    });
    act(() => {
      renderer.update(<Probe value={null} holdMs={200} onRender={record} />);
    });
    act(() => {
      renderer.update(<Probe value="b" holdMs={200} onRender={record} />);
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(last()).toEqual({ value: 'b', leaving: false });
    act(() => renderer.unmount());
  });

  it('shows nothing when it never had a value', () => {
    const renders: Seen[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe value={null} holdMs={200} onRender={(seen) => renders.push(seen)} />);
    });
    expect(renders[renders.length - 1]).toEqual({ value: null, leaving: false });
    act(() => renderer.unmount());
  });
});
