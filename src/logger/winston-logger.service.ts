import {
  Injectable,
  LoggerService,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

@Injectable()
export class WinstonLoggerService
  implements LoggerService, OnApplicationShutdown
{
  private readonly logger: winston.Logger;
  private readonly logtail?: Logtail;

  constructor() {
    const transports: winston.transport[] = [
      new winston.transports.DailyRotateFile({
        filename: 'logs/app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
      }),
      new winston.transports.DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        zippedArchive: true,
      }),
    ];

    if (process.env.MICROSANDBOX_ENV === 'production') {
      const betterStackToken = process.env.BETTER_STACK_TOKEN?.trim();
      if (betterStackToken) {
        const betterStackEndpoint =
          process.env.BETTER_STACK_ENDPOINT?.trim() ||
          'https://s2393059.eu-fsn-3.betterstackdata.com';
        this.logtail = new Logtail(betterStackToken, {
          endpoint: betterStackEndpoint,
        });
        transports.push(new LogtailTransport(this.logtail));
      }
    }

    if (process.env.MICROSANDBOX_ENV !== 'production') {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: 'microsandbox-cloud' },
      transports,
    });
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    this.logger.info(String(message), { context: optionalParams[0] });
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.logger.error(String(message), {
      context: optionalParams[0],
      trace: optionalParams[1],
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.logger.warn(String(message), { context: optionalParams[0] });
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.logger.debug(String(message), { context: optionalParams[0] });
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.logger.verbose(String(message), { context: optionalParams[0] });
  }

  onApplicationShutdown(): void {
    for (const transport of this.logger.transports) {
      if (typeof transport.close === 'function') {
        transport.close();
      }
    }
    void this.logtail?.flush();
  }
}
