import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '@c32/core';
import type { Role } from '@c32/core';
import { Alert, Button, Card, SelectField, TextField } from '../../components';
import { useAuth } from './auth';

const ROLE_HELP: Record<Role, string> = {
  Sales: 'Creates quotes, confirms, extends and cancels.',
  Owner: 'Everything Sales can do, plus approvals, imports and policy.',
  Viewer: 'Read-only access to quotes, availability and evidence.',
};

export function SignInPage() {
  const { session, signInMock } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('Sales');
  const [error, setError] = useState<string | undefined>();

  if (session) return <Navigate to={from} replace />;

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <Alert tone="info" title="Practice sign-in">
        This is a stand-in for the real sign-in. It only picks a role so you can try each screen.
        All data is synthetic.
      </Alert>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
          <Button type="submit">Sign in</Button>
        </form>
      </Card>
    </main>
  );
}
