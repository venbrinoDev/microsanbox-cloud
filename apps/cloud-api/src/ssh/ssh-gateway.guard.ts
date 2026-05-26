import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

@Injectable()
export class SshGatewayGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.internalApiToken;
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const authHeader = request.headers.authorization;
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (token === `Bearer ${expected}`) {
      return true;
    }

    throw new UnauthorizedException('Invalid gateway API token');
  }
}
