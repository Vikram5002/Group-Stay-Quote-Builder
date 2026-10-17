import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SignInLink } from './SignInLink';

const auth = vi.hoisted(() => ({
  value: { mode: 'mock', signInCognito: vi.fn(), pending: false } as {
    mode: 'mock' | 'cognito';
    signInCognito: ReturnType<typeof vi.fn>;
    pending: boolean;
  },
}));
vi.mock('../auth/auth', () => ({ useAuth: () => auth.value }));

function renderLink() {
  return render(
    <MemoryRouter>
      <SignInLink>Sign in</SignInLink>
    </MemoryRouter>,
  );
}

describe('SignInLink', () => {
  beforeEach(() => {
    auth.value = { mode: 'mock', signInCognito: vi.fn(), pending: false };
  });

  it('links to the practice sign-in page when the practice sign-in is used', () => {
    renderLink();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('goes straight to the real hosted sign-in when Cognito is on', async () => {
    auth.value = { mode: 'cognito', signInCognito: vi.fn(), pending: false };
    renderLink();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.value.signInCognito).toHaveBeenCalledWith('/');
  });
});
