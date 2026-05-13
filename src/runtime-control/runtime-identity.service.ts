import { Injectable } from '@nestjs/common';

export interface NormalizedSandboxIdentity {
  sandboxId: string;
}

@Injectable()
export class RuntimeIdentityService {
  normalizeSandboxId(value: string): string {
    return this.normalizeSegment(value, 'sandboxId');
  }

  sandboxName(input: { prefix: string; sandboxId: string }): string {
    const normalized = this.normalizeSandboxId(input.sandboxId);
    return this.trimName(`${input.prefix}-${normalized}`);
  }

  volumeName(input: { prefix: string; sandboxId: string }): string {
    const normalized = this.normalizeSandboxId(input.sandboxId);
    return this.trimName(`${input.prefix}-${normalized}`);
  }

  private normalizeSegment(value: string, fieldName: string): string {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '');

    if (!normalized) {
      throw new Error(`${fieldName} is required`);
    }
    if (normalized.length > 64) {
      return (
        normalized.slice(0, 64).replace(/[._-]+$/g, '') ||
        normalized.slice(0, 64)
      );
    }
    return normalized;
  }

  private trimName(value: string): string {
    if (value.length <= 120) {
      return value;
    }
    return value.slice(0, 120).replace(/[._-]+$/g, '');
  }
}
