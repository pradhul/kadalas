import { AuthExpiredError, friendlyAuthError, isAuthError } from '../src/services/auth/errors';
import { createScanJob, isAuthPause, pauseForAuth, resumeScan } from '../src/lib/scanPipeline';

describe('friendlyAuthError', () => {
  it('hides client_secret / missing parameter noise', () => {
    const msg = friendlyAuthError(
      new Error(
        'The request is missing a required parameter... More info: client_secret is missing.',
      ),
    );
    expect(msg.toLowerCase()).not.toContain('client_secret');
    expect(msg).toMatch(/try again/i);
  });

  it('maps cancel / deny / popup cases', () => {
    expect(friendlyAuthError(new Error('access_denied'))).toMatch(/denied/i);
    expect(friendlyAuthError(new Error('popup_closed_by_user'))).toMatch(/cancelled/i);
    expect(friendlyAuthError(new Error('popup_blocked_by_browser'))).toMatch(/pop-up/i);
  });

  it('keeps AuthExpiredError message', () => {
    expect(friendlyAuthError(new AuthExpiredError())).toMatch(/reconnect/i);
  });
});

describe('isAuthError / pauseForAuth', () => {
  it('detects 401 and AuthExpiredError', () => {
    expect(isAuthError(new AuthExpiredError())).toBe(true);
    expect(isAuthError(Object.assign(new Error('Drive API 401'), { status: 401 }))).toBe(true);
    expect(isAuthError(Object.assign(new Error('429'), { status: 429 }))).toBe(false);
  });

  it('pauses scan like quota and resumes after reconnect', () => {
    let state = createScanJob({ mode: 'full' });
    state = { ...state, stage: 'search', gmailPageToken: 'abc', triageQueue: ['1'] };
    const paused = pauseForAuth(state, { message: 'Session expired', status: 401 });
    expect(paused.stage).toBe('paused_quota');
    expect(isAuthPause(paused)).toBe(true);
    expect(paused.gmailPageToken).toBe('abc');
    expect(paused.triageQueue).toEqual(['1']);

    const resumed = resumeScan(paused);
    expect(resumed.stage).toBe('search');
    expect(resumed.quotaPause).toBeNull();
    expect(resumed.gmailPageToken).toBe('abc');
  });
});
