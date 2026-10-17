import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  Alert,
  Badge,
  Button,
  ContributionMeter,
  DataTable,
  Dialog,
  Money,
  TextField,
  Unknown,
} from '.';

describe('Button', () => {
  it('is disabled and busy while loading so a double click cannot resubmit', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Confirm
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Confirm' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type button so it never submits a form by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('TextField', () => {
  it('links label, hint and error to the input', () => {
    render(<TextField label="Rooms" hint="How many?" error="Required" />);
    const input = screen.getByLabelText('Rooms');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('How many? Required');
  });
});

describe('Unknown handling', () => {
  it('renders null money as the word Unknown, not zero', () => {
    render(<Money value={null} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText(/0/)).not.toBeInTheDocument();
  });

  it('renders a real zero as a rupee amount', () => {
    render(<Money value={0} />);
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });
});

describe('ContributionMeter', () => {
  it('flags a contribution below the floor with text', () => {
    render(<ContributionMeter contribution={16000} floor={20000} max={40000} />);
    expect(screen.getByText(/Below floor: review required/)).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '16000');
    expect(screen.getByText(/Floor/)).toBeInTheDocument();
  });

  it('meets the floor for the fixture contribution', () => {
    render(<ContributionMeter contribution={24000} floor={20000} max={40000} />);
    expect(screen.getByText('Meets floor')).toBeInTheDocument();
  });

  it('reports unknown contribution without a value', () => {
    render(<ContributionMeter contribution={null} floor={20000} max={40000} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Contribution: Unknown/ })).toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('uses the alert role for errors only', () => {
    const { rerender } = render(<Alert tone="danger" title="Expired" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<Alert tone="info" title="FYI" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('mounts its content only while open', () => {
    const { rerender } = render(
      <Dialog open={false} title="Approve" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    rerender(
      <Dialog open title="Approve" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});

describe('accessibility (axe)', () => {
  it('has no violations across the core components', async () => {
    const { container } = render(
      <main>
        <h1>Test</h1>
        <TextField label="Group name" required hint="Hint" />
        <TextField label="Rooms" error="Enter at least 1" />
        <Badge tone="warning">Review</Badge>
        <Alert tone="danger" title="Problem">
          Details
        </Alert>
        <ContributionMeter contribution={24000} floor={20000} max={40000} />
        <DataTable
          caption="Results"
          rows={[{ id: 'a', value: null as number | null }]}
          rowKey={(r) => r.id}
          columns={[{ header: 'Value', render: (r) => <Money value={r.value} /> }]}
        />
        <Unknown />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
