import { useEffect, useState } from "react";

export interface TypewriterState {
  /** Each input segment revealed up to its current character count. */
  rendered: string[];
  /** Index of the segment currently being typed (=== segments.length once done). */
  activeIndex: number;
  done: boolean;
}

/**
 * Types out `segments` one after another, character by character, starting shortly
 * after mount. Honours `prefers-reduced-motion` by revealing everything immediately.
 *
 * Intended for a small, static set of strings (module-level constants). `segments`
 * is deliberately not a hook dependency so the animation doesn't restart on every
 * parent re-render — pass a stable array.
 */
export function useTypewriter(
  segments: string[],
  charMs = 16,
  startDelayMs = 250,
): TypewriterState {
  const [state, setState] = useState<TypewriterState>(() => ({
    rendered: segments.map(() => ""),
    activeIndex: 0,
    done: false,
  }));

  useEffect(() => {
    const full = segments;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || full.length === 0) {
      setState({ rendered: [...full], activeIndex: full.length, done: true });
      return;
    }

    setState({ rendered: full.map(() => ""), activeIndex: 0, done: false });

    let seg = 0;
    let char = 0;
    let intervalId: number | undefined;

    const tick = (): void => {
      const target = full[seg];
      if (target === undefined) {
        if (intervalId !== undefined) window.clearInterval(intervalId);
        return;
      }
      char += 1;
      const revealedSeg = seg;
      const revealedChars = char;
      setState((prev) => {
        const rendered = [...prev.rendered];
        rendered[revealedSeg] = target.slice(0, revealedChars);
        return { rendered, activeIndex: revealedSeg, done: false };
      });
      if (char >= target.length) {
        seg += 1;
        char = 0;
        if (seg >= full.length) {
          if (intervalId !== undefined) window.clearInterval(intervalId);
          setState((prev) => ({ ...prev, activeIndex: full.length, done: true }));
        }
      }
    };

    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(tick, charMs);
    }, startDelayMs);

    return () => {
      window.clearTimeout(startId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see doc comment above
  }, [charMs, startDelayMs]);

  return state;
}
