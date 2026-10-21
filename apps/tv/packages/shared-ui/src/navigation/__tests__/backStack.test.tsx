import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { backStackDepth, dispatchBack, useBackHandler } from '../backStack';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Handler({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  useBackHandler(onBack, active);
  return null;
}

describe('back stack', () => {
  it('lets the app exit (returns false) when nothing is registered', () => {
    expect(backStackDepth()).toBe(0);
    expect(dispatchBack()).toBe(false);
  });

  it('runs only the newest handler, so a dialog gets Back before the screen under it', () => {
    const screen = jest.fn();
    const dialog = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <Handler onBack={screen} />
          <Handler onBack={dialog} />
        </>,
      );
    });
    expect(dispatchBack()).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();

    act(() => {
      renderer.update(<Handler onBack={screen} />); // dialog closed
    });
    dispatchBack();
    expect(screen).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    expect(backStackDepth()).toBe(0);
  });

  it('ignores inactive handlers and always calls the latest callback', () => {
    const first = jest.fn();
    const second = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Handler onBack={first} active={false} />);
    });
    expect(dispatchBack()).toBe(false);
    act(() => {
      renderer.update(<Handler onBack={first} />);
    });
    act(() => {
      renderer.update(<Handler onBack={second} />); // new closure, same registration
    });
    dispatchBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
