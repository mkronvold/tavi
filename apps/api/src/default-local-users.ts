import { Role } from '@prisma/client';

export const DEFAULT_LOCAL_USER_PASSWORD = 'password123';
export const GUEST_LOCAL_USER_EMAIL = 'guest@tavi.local';
export const GUEST_LOCAL_USER_NAME = 'Guest';

export const DEFAULT_LOCAL_ADMIN = {
  email: 'admin@tavi.local',
  name: 'Tavi Admin',
  role: Role.admin,
} as const;

export const DEFAULT_LOCAL_USERS = [
  {
    ...DEFAULT_LOCAL_ADMIN,
    password: DEFAULT_LOCAL_USER_PASSWORD,
  },
  {
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: Role.editor,
    password: DEFAULT_LOCAL_USER_PASSWORD,
  },
  {
    email: 'viewer@tavi.local',
    name: 'Tavi Viewer',
    role: Role.viewer,
    password: DEFAULT_LOCAL_USER_PASSWORD,
  },
] as const;

export const DEFAULT_LOCAL_USER_EMAILS = DEFAULT_LOCAL_USERS.map(
  (user) => user.email,
);
