import { Injectable, type LoggerService } from '@nestjs/common';
import {
  createStructuredLogger,
  type StructuredLogFields,
  type StructuredLogLevel,
} from './structured-logger';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger = createStructuredLogger({ service: 'api' });

  log(message: unknown, ...optionalParams: unknown[]) {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.write('fatal', message, optionalParams);
  }

  setLogLevels(): void {}

  private write(
    level: StructuredLogLevel,
    message: unknown,
    optionalParams: unknown[],
  ) {
    const { fields, text } = this.parseArguments(
      level,
      message,
      optionalParams,
    );

    switch (level) {
      case 'debug':
        this.logger.debug(text, fields);
        return;
      case 'error':
        this.logger.error(text, fields);
        return;
      case 'fatal':
        this.logger.fatal(text, fields);
        return;
      case 'warn':
        this.logger.warn(text, fields);
        return;
      default:
        this.logger.info(text, fields);
    }
  }

  private parseArguments(
    level: StructuredLogLevel,
    message: unknown,
    optionalParams: unknown[],
  ) {
    const fields: StructuredLogFields = {};
    const details: unknown[] = [];
    const text = formatMessage(message);

    if (message instanceof Error) {
      fields.err = message;
    }

    optionalParams.forEach((param, index) => {
      if (param === undefined) {
        return;
      }

      if (param instanceof Error) {
        fields.err = param;
        return;
      }

      if (isPlainObject(param)) {
        Object.assign(fields, param);
        return;
      }

      if (typeof param === 'string') {
        if (
          level === 'error' &&
          index === 0 &&
          optionalParams.length > 1 &&
          fields.stack === undefined
        ) {
          fields.stack = param;
          return;
        }

        if (fields.context === undefined) {
          fields.context = param;
          return;
        }
      }

      details.push(param);
    });

    if (details.length > 0) {
      fields.details = details;
    }

    return { fields, text };
  }
}

function isPlainObject(value: unknown): value is StructuredLogFields {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Error)
  );
}

function formatMessage(message: unknown) {
  if (message instanceof Error) {
    return message.message;
  }

  if (typeof message === 'string') {
    return message;
  }

  if (message === undefined) {
    return 'undefined';
  }

  const serialized = JSON.stringify(message);

  return serialized ?? '[unserializable]';
}
