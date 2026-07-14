import type { Role } from '@tavi/schemas';
import type { FastifyRequest } from 'fastify';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export type AuthenticatedRequest = FastifyRequest;
