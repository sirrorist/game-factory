// Пользовательские роли отличаются от роли подключения Postgres в roles.ts.
export const USER_ROLES = ['user', 'developer', 'admin', 'owner'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.some((role) => role === value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return value === 'active' || value === 'suspended';
}

export interface AccessPrincipal {
  id: string;
  role: UserRole;
  status: UserStatus;
}

export type Permission =
  | 'profile.manage.own' | 'progress.read.own' | 'progress.write.own'
  | 'games.create' | 'games.manage.own' | 'games.publish.own' | 'games.transfer'
  | 'games.moderate' | 'users.list' | 'users.suspend' | 'roles.assign'
  | 'kit.view' | 'prereleases.view.all';

const PLAYER: readonly Permission[] = ['profile.manage.own', 'progress.read.own', 'progress.write.own'];
const DEVELOPER: readonly Permission[] = [...PLAYER, 'games.create', 'games.manage.own', 'games.publish.own'];
const ADMIN: readonly Permission[] = [...DEVELOPER, 'games.moderate', 'users.list', 'users.suspend'];
const PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  user: PLAYER,
  developer: DEVELOPER,
  admin: ADMIN,
  owner: [...ADMIN, 'games.transfer', 'roles.assign', 'kit.view', 'prereleases.view.all'],
};

export interface AccessResource {
  ownerUserId: string;
  /** Действующая роль владельца ресурса/целевого пользователя, прочитанная сервером. */
  ownerRole?: UserRole;
}

/** Проверка роли не заменяет владение ресурсом; неизвестные значения закрывают доступ. */
export function can(principal: AccessPrincipal | null, permission: Permission, resource?: AccessResource): boolean {
  if (!principal || principal.status !== 'active' || !isUserRole(principal.role)) return false;
  if (!PERMISSIONS[principal.role].includes(permission)) return false;
  if (permission.endsWith('.own')) return resource?.ownerUserId === principal.id;
  if (permission === 'users.suspend' || permission === 'games.moderate') {
    if (!resource) return false;
    return principal.role === 'owner' || resource.ownerRole === 'user' || resource.ownerRole === 'developer';
  }
  return true;
}
