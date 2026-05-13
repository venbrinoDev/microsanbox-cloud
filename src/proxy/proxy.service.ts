import { Injectable, UnauthorizedException } from '@nestjs/common';
import httpProxy from 'http-proxy';

const createProxyServer = httpProxy.createProxyServer.bind(httpProxy);
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { ProxyTokenService } from '../auth/proxy-token.service.js';
import { RuntimeControlService } from '../runtime-control/runtime-control.service.js';

@Injectable()
export class ProxyService {
  private readonly proxy = createProxyServer({
    changeOrigin: true,
    ws: true,
    xfwd: true,
  });

  constructor(
    private readonly runtimeControl: RuntimeControlService,
    private readonly tokens: ProxyTokenService,
  ) {
    this.proxy.on('error', (error, _req, res) => {
      if (this.isServerResponse(res)) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(
          JSON.stringify({
            statusCode: 502,
            message: error.message || 'Upstream proxy error',
          }),
        );
        return;
      }

      if (this.isSocket(res)) {
        res.destroy();
      }
    });
  }

  async handleHttp(
    req: IncomingMessage & { url?: string },
    res: ServerResponse,
  ): Promise<void> {
    const match = this.extract(req.url ?? '');
    if (!match) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    this.tokens.verify(match.token, match.sandboxId);
    const runtime = await this.runtimeControl.connection(match.sandboxId);
    req.url = match.path;
    this.proxy.web(req, res, {
      target: `http://127.0.0.1:${runtime.hostPort}`,
    });
  }

  async handleUpgrade(
    req: IncomingMessage & { url?: string },
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    const match = this.extract(req.url ?? '');
    if (!match) {
      socket.destroy();
      return;
    }

    this.tokens.verify(match.token, match.sandboxId);
    const runtime = await this.runtimeControl.connection(match.sandboxId);
    req.url = match.path;
    this.proxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${runtime.hostPort}`,
    });
  }

  private extract(rawUrl: string): {
    sandboxId: string;
    path: string;
    token: string;
  } | null {
    const base = new URL(rawUrl, 'http://localhost');
    const match = /^\/proxy\/([^/]+)(\/.*)?$/.exec(base.pathname);
    if (!match) {
      return null;
    }
    const sandboxId = decodeURIComponent(match[1]);
    const token = base.searchParams.get('token')?.trim() || '';
    if (!token) {
      throw new UnauthorizedException('Missing proxy token');
    }
    base.searchParams.delete('token');
    const path = `${match[2] || '/'}${base.search}`;
    return { sandboxId, path, token };
  }

  private isServerResponse(value: unknown): value is ServerResponse {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'writeHead' in value &&
      typeof value.writeHead === 'function' &&
      'end' in value &&
      typeof value.end === 'function',
    );
  }

  private isSocket(value: unknown): value is Socket {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'destroy' in value &&
      typeof value.destroy === 'function',
    );
  }
}
