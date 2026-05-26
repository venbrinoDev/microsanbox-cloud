import { Injectable } from '@nestjs/common';
import { WinstonLoggerService } from '../logger/winston-logger.service.js';
import httpProxy from 'http-proxy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { RuntimeControlService } from '../runtime-control/runtime-control.service.js';

const createProxyServer = httpProxy.createProxyServer.bind(httpProxy);

type StandardProxyMatch = {
  kind: 'standard';
  sandboxId: string;
  port: number;
  path: string;
  token?: string | null;
};

type SignedProxyMatch = {
  kind: 'signed';
  token: string;
  port: number;
  path: string;
};

@Injectable()
export class ProxyService {
  private readonly proxy = createProxyServer({
    changeOrigin: true,
    ws: true,
    xfwd: true,
  });

  constructor(
    private readonly runtimeControl: RuntimeControlService,
    private readonly logger: WinstonLoggerService,
  ) {
    this.proxy.on('error', (_error, _req, res) => {
      if (this.isServerResponse(res)) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(
          JSON.stringify({
            statusCode: 502,
            message: 'Upstream proxy error',
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
    req: IncomingMessage & {
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    },
    res: ServerResponse,
  ): Promise<void> {
    const match = this.extract(req.url ?? '', req.headers);
    if (!match) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const target =
      match.kind === 'signed'
        ? await this.runtimeControl.validateProxyAccessBySignedToken(
            match.token,
            match.port,
          )
        : await this.runtimeControl.validateProxyAccessBySandbox(
            match.sandboxId,
            match.port,
            match.token,
          );

    req.url = match.path;
    this.logger.log(
      `Proxy HTTP: kind=${match.kind}, sandboxId=${target.runtime.sandboxId}, port=${match.port}, path=${match.path}`,
    );
    this.proxy.web(req, res, {
      target: `http://127.0.0.1:${target.hostPort}`,
    });
  }

  async handleUpgrade(
    req: IncomingMessage & {
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    },
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    const match = this.extract(req.url ?? '', req.headers);
    if (!match) {
      socket.destroy();
      return;
    }

    const target =
      match.kind === 'signed'
        ? await this.runtimeControl.validateProxyAccessBySignedToken(
            match.token,
            match.port,
          )
        : await this.runtimeControl.validateProxyAccessBySandbox(
            match.sandboxId,
            match.port,
            match.token,
          );

    req.url = match.path;
    this.logger.log(
      `Proxy WS: kind=${match.kind}, sandboxId=${target.runtime.sandboxId}, port=${match.port}`,
    );
    this.proxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${target.hostPort}`,
    });
  }

  private extract(
    rawUrl: string,
    headers: Record<string, string | string[] | undefined>,
  ): StandardProxyMatch | SignedProxyMatch | null {
    const base = new URL(rawUrl, 'http://localhost');
    const signedMatch = /^\/proxy\/signed\/([^/]+)\/ports\/(\d+)(\/.*)?$/.exec(
      base.pathname,
    );
    if (signedMatch) {
      return {
        kind: 'signed',
        token: decodeURIComponent(signedMatch[1]),
        port: Number(signedMatch[2]),
        path: `${signedMatch[3] || '/'}${base.search}`,
      };
    }

    const standardMatch = /^\/proxy\/([^/]+)\/ports\/(\d+)(\/.*)?$/.exec(
      base.pathname,
    );
    if (!standardMatch) {
      return null;
    }
    return {
      kind: 'standard',
      sandboxId: decodeURIComponent(standardMatch[1]),
      port: Number(standardMatch[2]),
      path: `${standardMatch[3] || '/'}${base.search}`,
      token: this.readPreviewToken(headers, base.searchParams.get('token')),
    };
  }

  private readPreviewToken(
    headers: Record<string, string | string[] | undefined>,
    queryToken: string | null,
  ): string | null {
    const header = headers['x-microsandbox-preview-token'];
    if (typeof header === 'string' && header.trim()) {
      return header.trim();
    }
    if (Array.isArray(header)) {
      const firstHeader = header[0];
      if (typeof firstHeader === 'string' && firstHeader.trim()) {
        return firstHeader.trim();
      }
    }
    return queryToken?.trim() || null;
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
