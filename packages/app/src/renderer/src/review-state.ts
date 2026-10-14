import { useSyncExternalStore } from 'react';
import { EMPTY_REVIEW } from './review-model.ts';
import type { ReviewState } from './review-model.ts';

// The reviews in progress (M64), one per session, for the app's run:
// closing the tab and opening it again finds the comments where they
// were, a reload loses them, and nothing goes to disk. A review is one
// sitting, and a comment written and not sent is the reviewer's to lose.

const reviews = new Map<string, ReviewState>();
const listeners = new Set<() => void>();

export function getReview(sessionId: string): ReviewState {
  return reviews.get(sessionId) ?? EMPTY_REVIEW;
}

export function setReview(sessionId: string, next: ReviewState): void {
  if (getReview(sessionId) === next) return;
  reviews.set(sessionId, next);
  for (const l of listeners) l();
}

export function updateReview(sessionId: string, f: (s: ReviewState) => ReviewState): void {
  setReview(sessionId, f(getReview(sessionId)));
}

export function useReview(sessionId: string): ReviewState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getReview(sessionId),
  );
}
