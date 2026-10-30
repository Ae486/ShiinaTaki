/**
 * INPUT:  content-change counters (entries/in-flight/oldest seq) + hasMore + loadOlder from the timeline hook.
 * OUTPUT: useTimelineScroll(...) -> { scrollRef, onScroll }: auto-stick-to-bottom, top-reach loads older, and holds
 *         the reading position when an older page prepends.
 * POS:    ui/windows/home/pages/chat — the scroll-behavior seam kept out of TimelineView (DOM-only; not the render contract).
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const NEAR_EDGE_PX = 48;
const LOAD_BACKSTOP_MS = 2_000;

export interface TimelineScrollInput {
  reading?: { key: string; positions: Map<string, TimelineReadingPosition> };
  entryCount: number;
  /** Oldest mounted seq: a prepended older page LOWERS it. The landed-prepend signal survives the P1b window trim,
   *  where a prepend and its trim cancel out in entryCount. */
  firstSeq: number | null;
  inflightLen: number; // -1 when no in-flight row, so a clear still changes the value and re-runs the effect
  hasMore: boolean;
  loadOlder: () => void;
  tailKey?: string;
}

export interface TimelineReadingPosition {
  top: number;
  following: boolean;
  anchor?: { key: string; offset: number };
}

export interface TimelineScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  hasNewContent: boolean;
  followTail: () => void;
  requestOlder: () => void;
}

interface ScrollState {
  ref: RefObject<HTMLDivElement | null>;
  following: boolean;
  loading: boolean;
  height: number;
  firstSeq: number | null;
  tailKey: string;
  timer: ReturnType<typeof setTimeout> | null;
  anchor?: { key: string; offset: number };
}

function hasSelection(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed
    && (element.contains(selection.anchorNode) || element.contains(selection.focusNode));
}

function follow(state: ScrollState): void {
  const element = state.ref.current;
  if (element && state.following && !hasSelection(element)) element.scrollTop = element.scrollHeight;
}

function readAnchor(element: HTMLElement): ScrollState["anchor"] {
  const top = element.getBoundingClientRect().top;
  const row = [...element.querySelectorAll<HTMLElement>("[data-transcript-key]")]
    .find((candidate) => candidate.getBoundingClientRect().bottom >= top);
  const key = row?.dataset.transcriptKey;
  return row && key ? { key, offset: row.getBoundingClientRect().top - top } : undefined;
}

function rememberReading(state: ScrollState, input: TimelineScrollInput): void {
  const element = state.ref.current;
  if (element && input.reading) input.reading.positions.set(input.reading.key,
    { top: element.scrollTop, following: state.following, anchor: readAnchor(element) });
}

function restoreReading(state: ScrollState, input: TimelineScrollInput): void {
  const element = state.ref.current;
  const saved = input.reading?.positions.get(input.reading.key);
  state.following = saved?.following ?? true;
  state.loading = false;
  state.firstSeq = input.firstSeq;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  if (!element || !saved) return;
  const row = [...element.querySelectorAll<HTMLElement>("[data-transcript-key]")]
    .find((candidate) => candidate.dataset.transcriptKey === saved.anchor?.key);
  element.scrollTop = saved.top;
  if (row && saved.anchor) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.anchor.offset;
}

function scrollChanged(state: ScrollState, input: TimelineScrollInput): void {
  const element = state.ref.current;
  if (!element) return;
  state.following = !hasSelection(element) && element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_EDGE_PX;
  if (element.scrollTop >= NEAR_EDGE_PX || !input.hasMore || state.loading) return;
  requestOlder(state, input);
}

function requestOlder(state: ScrollState, input: TimelineScrollInput): void {
  const element = state.ref.current;
  if (!element || state.loading) return;
  state.loading = true;
  state.height = element.scrollHeight;
  state.anchor = readAnchor(element);
  input.loadOlder();
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.loading = false; state.timer = null; }, LOAD_BACKSTOP_MS);
}

function contentChanged(state: ScrollState, input: TimelineScrollInput): void {
  const element = state.ref.current;
  if (!element) return;
  const prepended = input.firstSeq !== null && (state.firstSeq === null || input.firstSeq < state.firstSeq);
  state.firstSeq = input.firstSeq;
  if (state.loading && prepended) {
    const row = [...element.querySelectorAll<HTMLElement>("[data-transcript-key]")]
      .find((candidate) => candidate.dataset.transcriptKey === state.anchor?.key);
    element.scrollTop += row && state.anchor
      ? row.getBoundingClientRect().top - element.getBoundingClientRect().top - state.anchor.offset
      : element.scrollHeight - state.height;
    state.loading = false;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  } else follow(state);
}

function observeContent(state: ScrollState, content: HTMLElement | null): () => void {
  const selectionChanged = () => { if (state.ref.current && hasSelection(state.ref.current)) state.following = false; };
  document.addEventListener("selectionchange", selectionChanged);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => follow(state));
  if (content) observer?.observe(content);
  return () => {
    observer?.disconnect(); document.removeEventListener("selectionchange", selectionChanged);
    if (state.timer !== null) clearTimeout(state.timer);
  };
}

export function useTimelineScroll(input: TimelineScrollInput): TimelineScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [hasNewContent, setNewContent] = useState(false);
  const state = useRef<ScrollState>({ ref: scrollRef, following: true, loading: false, height: 0,
    firstSeq: input.firstSeq, tailKey: "", timer: null }).current;
  const tailKey = input.tailKey ?? `${input.entryCount}:${input.inflightLen}`;
  useLayoutEffect(() => { restoreReading(state, input); setNewContent(false); }, [input.reading?.key, state]);
  useLayoutEffect(() => {
    contentChanged(state, input);
    if (state.tailKey !== tailKey && !state.following) setNewContent(true);
    state.tailKey = tailKey;
    rememberReading(state, input);
  }, [input.entryCount, input.firstSeq, input.inflightLen, tailKey, state]);
  useEffect(() => observeContent(state, contentRef.current), [state]);
  const onScroll = () => { scrollChanged(state, input); rememberReading(state, input); if (state.following) setNewContent(false); };
  const followTail = () => { state.following = true; const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight; rememberReading(state, input); setNewContent(false); };
  return { scrollRef, contentRef, onScroll, hasNewContent, followTail, requestOlder: () => requestOlder(state, input) };
}
