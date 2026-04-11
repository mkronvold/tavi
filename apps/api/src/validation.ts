import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

export const parseInput = <T>(schema: ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }

  return parsed.data;
};
