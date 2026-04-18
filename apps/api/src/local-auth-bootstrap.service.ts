import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { AppLogger } from './app-logger';
import { DEFAULT_LOCAL_ADMIN } from './default-local-users';
import { PrismaService } from './prisma.service';
import { upsertInitialLocalAdmin } from './seed-local-admin';

const BOOTSTRAP_LOCK_ID = 4_942_717;
const INITIAL_ADMIN_PASSWORD_LENGTH = 10;
const LOCAL_AUTH_MODE = 'local';
const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

type AdvisoryLockResult = {
  locked: boolean;
};

export function generateRandomAlphanumericPassword(
  length = INITIAL_ADMIN_PASSWORD_LENGTH,
) {
  return Array.from({ length }, () => {
    const index = randomInt(PASSWORD_ALPHABET.length);
    return PASSWORD_ALPHABET[index];
  }).join('');
}

@Injectable()
export class LocalAuthBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly logger: AppLogger,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.isLocalAuthModeEnabled()) {
      return;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<AdvisoryLockResult[]>`
        SELECT pg_try_advisory_xact_lock(${BOOTSTRAP_LOCK_ID}) AS locked
      `;

      if (!lock?.locked) {
        return { created: false as const };
      }

      const userCount = await tx.user.count();

      if (userCount > 0) {
        return { created: false as const };
      }

      const initialPassword = generateRandomAlphanumericPassword();
      const passwordHash = await bcrypt.hash(initialPassword, 10);

      await upsertInitialLocalAdmin(tx, passwordHash);

      return {
        created: true as const,
        initialPassword,
      };
    });

    if (!result.created) {
      return;
    }

    this.logger.log('auth.bootstrap.initial_admin_created', {
      email: DEFAULT_LOCAL_ADMIN.email,
      initialPassword: result.initialPassword,
      passwordSource: 'generated',
    });
  }

  private isLocalAuthModeEnabled() {
    return (process.env.AUTH_MODE ?? LOCAL_AUTH_MODE) === LOCAL_AUTH_MODE;
  }
}
