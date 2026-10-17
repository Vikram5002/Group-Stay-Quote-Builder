import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Dialog } from '../components';

/** Navigation state for a move that should never be stopped, such as opening what was just saved. */
export const LEAVE_ALLOWED = { leaveAllowed: true } as const;

function allowed(state: unknown): boolean {
  return (state as { leaveAllowed?: boolean } | null)?.leaveAllowed === true;
}

/**
 * Asks before leaving a page with unsaved changes: an in-app confirm for links, the menu and the
 * browser's Back and Forward (the router's blocker), and the browser's own prompt for a reload or
 * closing the tab (beforeunload). Moves within the same page, such as between wizard steps, a
 * move that carries LEAVE_ALLOWED, and going to sign-in when the session ends are not stopped.
 */
export function LeaveGuard({
  when,
  title,
  children,
}: {
  when: boolean;
  title: string;
  /** What happens to the changes if the person leaves. */
  children: ReactNode;
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when &&
      nextLocation.pathname !== currentLocation.pathname &&
      nextLocation.pathname !== '/sign-in' &&
      !allowed(nextLocation.state),
  );

  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show their prompt only when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);

  const stay = () => blocker.reset?.();
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      title={title}
      onClose={stay}
      footer={
        <>
          <Button variant="secondary" onClick={stay}>
            Stay on this page
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Leave
          </Button>
        </>
      }
    >
      <p className="text-sm">{children}</p>
    </Dialog>
  );
}
