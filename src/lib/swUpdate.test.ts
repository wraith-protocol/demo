import { describe, expect, it } from 'vitest';
import {
  initialUpdateState,
  isApplyingUpdate,
  reduceUpdateState,
  shouldPromptForUpdate,
  type UpdateState,
} from './swUpdate';

function apply(state: UpdateState, ...events: Parameters<typeof reduceUpdateState>[1][]) {
  return events.reduce(reduceUpdateState, state);
}

describe('service worker update prompt', () => {
  it('stays hidden until a new worker is waiting', () => {
    expect(shouldPromptForUpdate(initialUpdateState)).toBe(false);

    const state = reduceUpdateState(initialUpdateState, { type: 'NEED_REFRESH' });

    expect(state.status).toBe('waiting');
    expect(shouldPromptForUpdate(state)).toBe(true);
  });

  it('can be dismissed without applying the update', () => {
    const state = apply(initialUpdateState, { type: 'NEED_REFRESH' }, { type: 'DISMISS' });

    expect(state.status).toBe('waiting');
    expect(shouldPromptForUpdate(state)).toBe(false);
  });

  it('prompts again when another version is waiting after a dismissal', () => {
    const dismissed = apply(initialUpdateState, { type: 'NEED_REFRESH' }, { type: 'DISMISS' });
    const nextVersion = reduceUpdateState(dismissed, { type: 'NEED_REFRESH' });

    expect(shouldPromptForUpdate(nextVersion)).toBe(true);
  });

  it('reports progress while the update is applied', () => {
    const applying = apply(initialUpdateState, { type: 'NEED_REFRESH' }, { type: 'APPLY' });

    expect(applying.status).toBe('applying');
    expect(isApplyingUpdate(applying)).toBe(true);
    // The prompt is replaced by the busy state, so it must not linger.
    expect(shouldPromptForUpdate(applying)).toBe(false);
  });

  it('ignores a duplicate refresh while already applying', () => {
    const applying = apply(initialUpdateState, { type: 'NEED_REFRESH' }, { type: 'APPLY' });
    const duplicate = reduceUpdateState(applying, { type: 'NEED_REFRESH' });

    expect(duplicate.status).toBe('applying');
    expect(duplicate.error).toBeNull();
  });

  it('surfaces the reason when the update cannot be applied', () => {
    const failed = reduceUpdateState(apply(initialUpdateState, { type: 'NEED_REFRESH' }), {
      type: 'ERROR',
      error: 'activation failed',
    });

    expect(failed.status).toBe('error');
    expect(failed.error).toBe('activation failed');
    expect(shouldPromptForUpdate(failed)).toBe(false);
  });
});
