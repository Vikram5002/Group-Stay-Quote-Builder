import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { QuoteBuilderPage } from './QuoteBuilderPage';

/** History state the wizard puts on its own entries (its steps), so they keep the same form. */
export const WIZARD_STATE = { wizard: true } as const;

const inWizard = (state: unknown) => (state as { wizard?: boolean } | null)?.wizard === true;

/**
 * Choosing "New quote" while already on the builder starts the wizard again (which then offers
 * the draft). Every navigation, including a click on the current page's own link, gets a new
 * location key; moves between steps, and Back and Forward over them, carry WIZARD_STATE and keep
 * the wizard as it is.
 */
export function QuoteBuilderRoute() {
  const location = useLocation();
  const instance = useRef(location.key);
  if (!inWizard(location.state)) instance.current = location.key;
  return <QuoteBuilderPage key={instance.current} />;
}
