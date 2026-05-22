import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SshSessionEntity } from './entities/ssh-session.entity.js';
import { SshService } from './ssh.service.js';
import { SshSessionService } from './session.service.js';
import { SshController } from './ssh.controller.js';
import { AppConfigService } from '../config/app-config.service.js';
import { WinstonLoggerService } from '../logger/winston-logger.service.js';
import { InternalAuthGuard } from '../shared/internal-auth.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([SshSessionEntity])],
  controllers: [SshController],
  providers: [
    SshService,
    SshSessionService,
    AppConfigService,
    WinstonLoggerService,
    InternalAuthGuard,
  ],
  exports: [SshService, SshSessionService],
})
export class SshModule {}
