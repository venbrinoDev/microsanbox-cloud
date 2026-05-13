import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, Router } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { ProxyService } from './proxy/proxy.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const config = app.get(AppConfigService);
  const proxy = app.get(ProxyService);
  const expressApp = app.getHttpAdapter().getInstance() as Router;
  expressApp.use('/proxy', (req: Request, res: Response) => {
    const proxyReq = Object.assign(req, { url: req.originalUrl });
    proxy.handleHttp(proxyReq, res).catch((error: unknown) => {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number'
          ? error.status
          : 502;
      res.status(status).json({
        statusCode: status,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const server = (await app.listen(config.port, config.host)) as Server;
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    proxy.handleUpgrade(req, socket, head).catch(() => socket.destroy());
  });
}
void bootstrap();
