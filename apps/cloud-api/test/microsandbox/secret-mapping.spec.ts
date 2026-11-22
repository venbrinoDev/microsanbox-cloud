import { SecretBuilder } from 'microsandbox';
import { MicrosandboxAdapterService } from '../../src/microsandbox/microsandbox-adapter.service.js';
import type { RuntimeSecretInput } from '../../src/microsandbox/microsandbox-adapter.interface.js';

// Runs our secret mapping against the real SDK builder. `SandboxBuilder.secret()`
// takes an untyped callback, so an SDK method rename only shows up at runtime;
// this test catches it before deploy.
type SdkSecretBuilder = InstanceType<typeof SecretBuilder>;

describe('MicrosandboxAdapterService secret mapping', () => {
  const adapter = new MicrosandboxAdapterService(
    {} as never,
    {} as never,
    {} as never,
  );

  const build = (input: Partial<RuntimeSecretInput>) => {
    const secret: RuntimeSecretInput = {
      env: 'OPENROUTER_API_KEY',
      value: 'sk-test-value',
      allowedHosts: [],
      allowedHostPatterns: [],
      ...input,
    };
    const builder = (
      adapter as unknown as {
        applySecret(
          b: SdkSecretBuilder,
          s: RuntimeSecretInput,
        ): SdkSecretBuilder;
      }
    ).applySecret(new SecretBuilder(), secret);
    return builder.build();
  };

  it('maps the header-injected API key secret the Jovita server sends', () => {
    const entry = build({
      placeholder: '$MSB_OPENROUTER_API_KEY',
      allowedHosts: ['openrouter.ai'],
      requireTlsIdentity: true,
      injectHeaders: true,
    });

    expect(entry.envVar).toBe('OPENROUTER_API_KEY');
    expect(entry.placeholder).toBe('$MSB_OPENROUTER_API_KEY');
    expect(entry.allowedHosts).toEqual(['openrouter.ai']);
    expect(entry.requireTlsIdentity).toBe(true);
    expect(entry.substitution.headers).toBe(true);
  });

  it('maps body injection and host patterns', () => {
    const entry = build({
      allowedHosts: ['api.example.com'],
      allowedHostPatterns: ['*.example.org'],
      injectHeaders: false,
      injectBody: true,
      injectQuery: false,
    });

    expect(entry.allowedHosts).toContain('api.example.com');
    expect(entry.allowedHostPatterns).toContain('*.example.org');
    expect(entry.substitution).toMatchObject({
      headers: false,
      body: true,
      query: false,
    });
  });

  it('scopes basic-auth injection to the Authorization header', () => {
    const entry = build({
      allowedHosts: ['registry.example.com'],
      injectBasicAuth: true,
    });

    expect(entry.substitution.headers).toBe(true);
    expect(entry.substitution.headerFields).toEqual(['authorization']);
  });

  it('rejects a bare "*" host instead of letting the SDK panic', () => {
    expect(() => build({ allowedHostPatterns: ['*'] })).toThrow(
      /allowAnyHostDangerous/,
    );
  });
});
