import type { Role } from '@c32/core';

/**
 * Who does what (D-062). Reception and the Service Manager build quotes; the Service Manager also
 * approves reviews and can send a quote to the Owner; the Owner sets discounts on those quotes and
 * works on bookings, imports and policy, but does not build quotes. The server decides; these only
 * hide what a role cannot use.
 */
export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  Reception: 'Reception',
  ServiceManager: 'Service Manager',
  Owner: 'Owner',
  Viewer: 'Viewer',
};

export const BUILDERS: readonly Role[] = ['Reception', 'ServiceManager'];
export const BOOKING: readonly Role[] = ['Reception', 'ServiceManager', 'Owner'];
export const REVIEWERS: readonly Role[] = ['ServiceManager'];
export const ADMINS: readonly Role[] = ['ServiceManager', 'Owner'];

export const can = (roles: readonly Role[], role: Role | undefined): boolean =>
  role !== undefined && roles.includes(role);
