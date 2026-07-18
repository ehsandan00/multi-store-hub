import { SetMetadata } from '@nestjs/common';

export type Role = 'ADMIN' | 'WAREHOUSE_STAFF' | 'VIEWER';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles. Combine with `@Roles()` + RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
