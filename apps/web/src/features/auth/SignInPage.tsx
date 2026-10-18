import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '@c32/core';
import type { Role } from '@c32/core';
import {
  Alert,
  Button,
  Card,
  HotelScene,
  Icon,
  Logo,
  SelectField,
  TextField,
} from '../../components';
import type { IconName } from '../../components';
import { useAuth } from './auth';
import type { SignInState } from './RequireAuth';

const ROLE_HELP: Record<Role, string> = {
  Reception: 'Creates quotes, confirms, extends and cancels.',
  ServiceManager:
    'Everything Reception can do, plus approvals, imports, policy and sending quotes to the Owner.',
  Owner: 'Sets any discount on quotes sent by the Service Manager; bookings, imports and policy.',
  Viewer: 'Read-only access to quotes, availability and evidence.',
};

const POINTS: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'trending', text: 'See the contribution on every group quote before you send it.' },
  { icon: 'clock', text: 'Rooms are held with a clear expiry, so nothing is double-booked.' },
  { icon: 'review', text: 'Quotes below the floor go to a Service Manager for a second look.' },
];

/** The sign-in layout: the brand side with the hotel on wide screens, the form beside it. */
function SignInFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* The brand side: the hotel, the product in one line, and what it does. */}
      <section
        aria-label="About the product"
        className="relative isolate m-4 hidden overflow-hidden rounded-[2rem] bg-surface-muted px-12 py-12 text-ink lg:flex lg:flex-col"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(50%_45%_at_50%_45%,rgb(255_207_77/0.25),transparent_70%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 [background-image:radial-gradient(rgb(14_14_14/0.08)_1px,transparent_1px)] [background-size:22px_22px]"
        />
        <p className="flex items-center gap-3 text-lg font-semibold text-ink">
          <Logo />
          Group Stay Quote Builder
        </p>
        <div className="my-auto flex justify-center py-8">
          <HotelScene className="c32-float h-72 w-auto xl:h-80" />
        </div>
        <div className="max-w-lg">
          <p className="text-5xl leading-[1.05] font-bold tracking-[-0.04em] text-ink">
            Quote group stays with confidence.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map((point) => (
              <li key={point.text} className="flex items-start gap-3 text-ink-muted">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-white"
                >
                  <Icon name={point.icon} className="size-4" />
                </span>
                <span className="pt-1">{point.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="flex flex-col justify-center bg-canvas px-4 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <HotelScene className="mx-auto h-32 w-auto lg:hidden" />
          {children}
        </div>
      </div>
    </main>
  );
}

export function SignInPage() {
  const { session, signInMock, mode, signInCognito, pending, authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrival = location.state as Partial<SignInState> | null;
  const from = arrival?.from ?? '/';
  const ended = arrival?.expired ? (
    <Alert tone="warning" title="Your session ended">
      Sign in again to carry on where you were. A quote you were building is kept as a draft in this
      tab.
    </Alert>
  ) : null;
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('Reception');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    document.title = 'Sign in · Group Stay Quote Builder';
  }, []);

  if (session) return <Navigate to={from} replace />;

  if (mode === 'cognito') {
    return (
      <SignInFrame>
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Sign in</h1>
          <p className="mt-2 text-ink-muted">
            Sign in with the account the hotel owner created for you.
          </p>
        </div>
        {ended}
        {authError ? (
          <Alert tone="danger" title="Sign-in did not complete">
            {authError}
          </Alert>
        ) : null}
        <Card className="shadow-raised">
          <Button
            type="button"
            className="min-h-12 w-full"
            disabled={pending}
            onClick={() => signInCognito(from)}
          >
            Sign in
            <Icon name="arrowRight" className="size-4" />
          </Button>
          <p className="mt-4 text-center text-sm text-ink-muted">
            All data in this case is synthetic.
          </p>
        </Card>
      </SignInFrame>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a name so approvals and the audit trail can show who acted.');
      return;
    }
    signInMock(role, name);
    navigate(from, { replace: true });
  }

  return (
    <SignInFrame>
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Sign in</h1>
        <p className="mt-2 text-ink-muted">Pick a name and a role to open the workspace.</p>
      </div>
      {ended}
      <Alert tone="info" title="Practice sign-in">
        This is a stand-in for the real sign-in. It only picks a role so you can try each screen.
        All data is synthetic.
      </Alert>
      <Card className="shadow-raised">
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <TextField
            label="Your name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            {...(error ? { error } : {})}
            autoComplete="name"
            placeholder="For example, Asha Rao"
          />
          <SelectField
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            hint={ROLE_HELP[role]}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          <Button type="submit" className="min-h-12 w-full">
            Sign in
            <Icon name="arrowRight" className="size-4" />
          </Button>
        </form>
      </Card>
    </SignInFrame>
  );
}
