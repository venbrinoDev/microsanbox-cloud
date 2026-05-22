import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';
import { SshSessionService } from './session.service.js';

class CreateSessionBody {
  @IsString()
  sandboxId!: string;

  @IsInt()
  @Min(1)
  hostPort!: number;
}

@ApiTags('SSH Access')
@Controller()
export class SshController {
  constructor(private readonly sessions: SshSessionService) {}

  @Post('ssh-session')
  @UseGuards(InternalAuthGuard)
  @ApiBearerAuth('internal-api')
  @ApiOperation({
    summary: 'Create an ephemeral SSH session token for a sandbox port',
  })
  async createSession(
    @Body() body: CreateSessionBody,
  ): Promise<Record<string, unknown>> {
    const session = await this.sessions.createSession(
      body.sandboxId,
      body.hostPort,
    );
    return { ...session };
  }

  @Delete('ssh-session/:token')
  @UseGuards(InternalAuthGuard)
  @ApiBearerAuth('internal-api')
  @ApiOperation({ summary: 'Revoke an SSH session token' })
  @ApiParam({ name: 'token', description: 'SSH session token' })
  async revokeSession(
    @Param('token') token: string,
  ): Promise<Record<string, unknown>> {
    const revoked = await this.sessions.revokeSession(token);
    if (!revoked) {
      throw new BadRequestException('Session token not found');
    }
    return { token, revoked: true };
  }

  @Get('ssh/validate')
  @UseGuards(InternalAuthGuard)
  @ApiBearerAuth('internal-api')
  @ApiOperation({
    summary: 'Validate an SSH session token (called by SSH gateway)',
  })
  @ApiQuery({ name: 'token', description: 'SSH session token' })
  async validateToken(
    @Query('token') token: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.sessions.validateSession(token);
    if (!result) {
      throw new BadRequestException('Invalid or expired SSH session token');
    }
    return { sandboxId: result.sandboxId, hostPort: result.hostPort };
  }
}
