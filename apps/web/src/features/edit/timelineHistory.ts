import type { TimelineDocument } from "@cinakey/shared";

const MAX_UNDO = 50;

export type TimelineHistoryState = {
  present: TimelineDocument;
  past: TimelineDocument[];
  future: TimelineDocument[];
  dirty: boolean;
};

export function createHistory(
  present: TimelineDocument,
): TimelineHistoryState {
  return { present, past: [], future: [], dirty: false };
}

export function pushDocument(
  state: TimelineHistoryState,
  next: TimelineDocument,
): TimelineHistoryState {
  if (next === state.present) return state;
  return {
    present: next,
    past: [...state.past.slice(-(MAX_UNDO - 1)), state.present],
    future: [],
    dirty: true,
  };
}

export function undo(
  state: TimelineHistoryState,
): TimelineHistoryState {
  const prev = state.past[state.past.length - 1];
  if (!prev) return state;
  return {
    present: prev,
    past: state.past.slice(0, -1),
    future: [state.present, ...state.future],
    dirty: true,
  };
}

export function redo(
  state: TimelineHistoryState,
): TimelineHistoryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    present: next,
    past: [...state.past, state.present],
    future: state.future.slice(1),
    dirty: true,
  };
}

export function markClean(
  state: TimelineHistoryState,
): TimelineHistoryState {
  return { ...state, dirty: false };
}

export function replacePresent(
  _state: TimelineHistoryState,
  present: TimelineDocument,
  dirty = false,
): TimelineHistoryState {
  return { present, past: [], future: [], dirty };
}

export function documentHash(doc: TimelineDocument): string {
  return JSON.stringify(doc);
}
