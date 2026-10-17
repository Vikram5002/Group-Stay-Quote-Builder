import { act, render, screen } from '@testing-library/react';
import { AuthProvider, mockSession, useAuth } from './auth';
import type { Session } from './auth';

const KEY = 'c32.session';

/** Shows who this tab thinks is signed in, and offers the actions. */
function Probe() {
  const { session, signedOutBy, signInMock, signOut } = useAuth();
  return (
    <div>
      <p>
        {session ? `Signed in as ${session.displayName}` : `Signed out (${String(signedOutBy)})`}
      </p>
      <button type="button" onClick={() => signInMock('Sales', 'Asha')}>
        Sign in
      </button>
      <button type="button" onClick={() => signOut('manual')}>
        Sign out
      </button>
    </div>
  );
}

/** A tab: a fresh provider that reads the shared storage, as a newly opened tab does. */
const openTab = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

/** What another tab's write looks like to this one: a storage event. */
function otherTabWrites(session: Session | null) {
  const newValue = session ? JSON.stringify(session) : null;
  if (newValue) localStorage.setItem(KEY, newValue);
  else localStorage.removeItem(KEY);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue }));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('one session for every tab', () => {
  it('a link opened in a new tab is already signed in', () => {
    const first = openTab();
    act(() => screen.getByRole('button', { name: 'Sign in' }).click());
    first.unmount();

    openTab();
    expect(screen.getByText('Signed in as Asha')).toBeInTheDocument();
    // Nothing is left in the per-tab store.
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('signing out in another tab signs this tab out too', () => {
    localStorage.setItem(KEY, JSON.stringify(mockSession('Sales', 'Asha')));
    openTab();
    expect(screen.getByText('Signed in as Asha')).toBeInTheDocument();

    otherTabWrites(null);
    expect(screen.getByText('Signed out (manual)')).toBeInTheDocument();
  });

  it('signing in in another tab is picked up here', () => {
    openTab();
    otherTabWrites(mockSession('Owner', 'Meera'));
    expect(screen.getByText('Signed in as Meera')).toBeInTheDocument();
  });

  it('an expired session is not restored, and is removed', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...mockSession('Sales', 'Asha'), expiresAt: Date.now() - 1000 }),
    );
    openTab();
    expect(screen.getByText('Signed out (null)')).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('the session ends when its token expires, in every tab', () => {
    vi.useFakeTimers();
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...mockSession('Sales', 'Asha'), expiresAt: Date.now() + 60_000 }),
    );
    openTab();
    expect(screen.getByText('Signed in as Asha')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Signed out (expired)')).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a sign-out here clears the shared session', () => {
    localStorage.setItem(KEY, JSON.stringify(mockSession('Sales', 'Asha')));
    openTab();
    act(() => screen.getByRole('button', { name: 'Sign out' }).click());
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
