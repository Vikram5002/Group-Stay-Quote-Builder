import { useLocation } from 'react-router-dom';
import { QuoteBuilderPage } from './QuoteBuilderPage';

/**
 * Choosing "New quote" while already on the builder starts a fresh form. Every navigation,
 * including a click on the current page's own link, gets a new location key.
 */
export function QuoteBuilderRoute() {
  const { key } = useLocation();
  return <QuoteBuilderPage key={key} />;
}
