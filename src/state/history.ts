import { StadiumDocument } from '../stadium/schema';

export interface HistoryState {
  past: StadiumDocument[];
  future: StadiumDocument[];
}

const MAX_HISTORY_STEPS = 45;

export function cloneDocument(doc: StadiumDocument): StadiumDocument {
  return JSON.parse(JSON.stringify(doc)) as StadiumDocument;
}

export function pushHistorySnapshot(
  history: HistoryState,
  currentDoc: StadiumDocument
): HistoryState {
  const snapshot = cloneDocument(currentDoc);
  const nextPast = [...history.past, snapshot];
  if (nextPast.length > MAX_HISTORY_STEPS) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    future: [],
  };
}
