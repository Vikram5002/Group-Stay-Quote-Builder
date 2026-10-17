export const TOKEN_GROUPS = [
  { name: 'Surfaces', tokens: ['canvas', 'surface', 'surface-muted', 'border', 'border-strong'] },
  { name: 'Text', tokens: ['ink', 'ink-muted'] },
  { name: 'Brand', tokens: ['brand', 'brand-hover', 'brand-soft', 'on-brand', 'focus'] },
  {
    name: 'Status',
    tokens: [
      'success',
      'success-soft',
      'warning',
      'warning-soft',
      'danger',
      'danger-soft',
      'info',
      'info-soft',
      'unknown',
      'unknown-soft',
    ],
  },
] as const;
