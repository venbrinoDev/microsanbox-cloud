import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { WinstonLoggerService } from '../logger/winston-logger.service.js';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: WinstonLoggerService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.internalApiToken;
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      url?: string;
    }>();
    const authHeader = request.headers.authorization;
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (token === `Bearer ${expected}`) {
      return true;
    }

    this.logger.warn(`Auth failure: url=${request.url}`);
    throw new UnauthorizedException('Invalid internal API token');
  }
}
