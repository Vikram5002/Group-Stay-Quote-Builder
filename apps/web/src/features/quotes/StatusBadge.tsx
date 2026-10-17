import type { QuoteStatus } from '@c32/core';
import { Badge } from '../../components';
import { STATUS_LABEL, STATUS_TONE } from './labels';

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
