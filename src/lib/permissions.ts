export type RoleCode = "ADMIN" | "MANAGER" | "OPERATOR";

export type Permission =
  | "session.open"
  | "movement.write"
  | "conference.write"
  | "session.close"
  | "session.report"
  | "session.email"
  | "reports.view"
  | "history.view"
  | "closing.reopen"
  | "closing.correct"
  | "export.all"
  | "audit.view"
  | "users.manage"
  | "catalog.manage"
  | "settings.manage";

const OPERATOR: Permission[] = [
  "session.open",
  "movement.write",
  "conference.write",
  "session.close",
  "session.report",
  "session.email",
];
const MANAGER: Permission[] = [
  ...OPERATOR,
  "reports.view",
  "history.view",
  "closing.reopen",
  "closing.correct",
  "export.all",
];
const ADMIN: Permission[] = [...MANAGER, "audit.view", "users.manage", "catalog.manage", "settings.manage"];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  OPERATOR,
  MANAGER,
  ADMIN,
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  OPERATOR: "Operador",
  MANAGER: "Gerente",
  ADMIN: "Administrador",
};

export function can(role: RoleCode, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
