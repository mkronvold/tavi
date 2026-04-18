import { Role } from '@prisma/client';
import { upsertInitialLocalAdmin } from './seed-local-admin';

describe('upsertInitialLocalAdmin', () => {
  it('upserts only the initial admin account and role assignment', async () => {
    const userUpsert = jest.fn().mockResolvedValue({ id: 'admin-user' });
    const roleAssignmentUpsert = jest.fn().mockResolvedValue({});

    const result = await upsertInitialLocalAdmin(
      {
        user: {
          upsert: userUpsert,
        },
        roleAssignment: {
          upsert: roleAssignmentUpsert,
        },
      },
      'hashed-password',
    );

    expect(result).toEqual({ id: 'admin-user' });
    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'admin@tavi.local' },
      update: {
        name: 'Tavi Admin',
        passwordHash: 'hashed-password',
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
      },
      create: {
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        passwordHash: 'hashed-password',
      },
    });
    expect(roleAssignmentUpsert).toHaveBeenCalledWith({
      where: { userId: 'admin-user' },
      update: { role: Role.admin },
      create: {
        userId: 'admin-user',
        role: Role.admin,
      },
    });
  });
});
