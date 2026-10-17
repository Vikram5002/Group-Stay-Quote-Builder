import type { Role } from '@c32/core';

export interface NavItem {
  path: string;
  label: string;
  /** Work package that fills the screen in. */
  workPackage: string;
  description: string;
  /** Roles allowed to see the screen. Omitted means every signed-in role. */
  roles?: readonly Role[];
}

/** Screens from blueprint section 10.2. Bodies arrive in later work packages. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    workPackage: 'T2-04',
    description: 'Pipeline by status, holds expiring soon, contribution at risk.',
  },
  {
    path: '/quotes/new',
    roles: ['Sales', 'Owner'],
    label: 'New quote',
    workPackage: 'T2-03',
    description: 'Quote builder wizard with a live contribution meter.',
  },
  {
    path: '/review',
    roles: ['Owner'],
    label: 'Review queue',
    workPackage: 'T2-05',
    description: 'Floor breaches and unknowns awaiting an Owner decision.',
  },
  {
    path: '/availability',
    label: 'Availability',
    workPackage: 'T2-06',
    description: 'Room-nights by date and type: available, held and confirmed.',
  },
  {
    path: '/imports',
    label: 'Imports and exports',
    workPackage: 'T2-07',
    description: 'CSV or JSON upload and download with row-level reports.',
  },
  {
    path: '/policy',
    roles: ['Owner'],
    label: 'Policy',
    workPackage: 'T2-06',
    description: 'Package floor, total rooms, validity and cutoff.',
  },
  {
    path: '/evidence',
    label: 'Evidence',
    workPackage: 'T2-08',
    description: 'Baseline, negotiated scope and final results.',
  },
  {
    path: '/experiments',
    label: 'Experiment log',
    workPackage: 'T2-08',
    description: 'Growth experiment records.',
  },
];

export const DESIGN_SYSTEM_PATH = '/design-system';
