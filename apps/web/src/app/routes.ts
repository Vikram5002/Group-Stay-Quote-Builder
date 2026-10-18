import type { Role } from '@c32/core';

export interface NavItem {
  path: string;
  label: string;
  /** Work package that fills the screen in. */
  workPackage: string;
  description: string;
  /** Roles allowed to see the screen. Omitted means every signed-in role. */
  roles?: readonly Role[];
  /**
   * Where the menu shows it: the main action, daily work, admin, or the project pages that
   * explain how the product was built (kept out of the way for hotel staff).
   */
  group: 'action' | 'work' | 'admin' | 'project';
}

/** Screens from blueprint section 10.2. Bodies arrive in later work packages. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    group: 'work',
    workPackage: 'T2-04',
    description: 'Pipeline by status, holds expiring soon, contribution at risk.',
  },
  {
    path: '/quotes',
    label: 'Quotes',
    group: 'work',
    workPackage: 'UI',
    description: 'Every quote, with search, filters and sorting.',
  },
  {
    path: '/quotes/new',
    roles: ['Sales', 'Owner'],
    label: 'New quote',
    group: 'action',
    workPackage: 'T2-03',
    description: 'Quote builder wizard with a live contribution meter.',
  },
  {
    path: '/review',
    roles: ['Owner'],
    label: 'Review queue',
    group: 'work',
    workPackage: 'T2-05',
    description: 'Floor breaches and unknowns awaiting an Owner decision.',
  },
  {
    path: '/availability',
    label: 'Availability',
    group: 'work',
    workPackage: 'T2-06',
    description: 'Room-nights by date and type: available, held and confirmed.',
  },
  {
    path: '/imports',
    label: 'Imports and exports',
    group: 'admin',
    workPackage: 'T2-07',
    description: 'CSV or JSON upload and download with row-level reports.',
  },
  {
    path: '/policy',
    roles: ['Owner'],
    label: 'Policy',
    group: 'admin',
    workPackage: 'T2-06',
    description: 'Package floor, total rooms, validity and cutoff.',
  },
  {
    path: '/evidence',
    label: 'Evidence',
    group: 'project',
    workPackage: 'T2-08',
    description: 'Baseline, negotiated scope and final results.',
  },
  {
    path: '/experiments',
    label: 'Experiment log',
    group: 'project',
    workPackage: 'T2-08',
    description: 'Growth experiment records.',
  },
];

export const DESIGN_SYSTEM_PATH = '/design-system';
