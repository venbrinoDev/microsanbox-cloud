import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Microsandbox Cloud API')
    .setDescription(
      'Control plane and signed proxy for running per-user Microsandbox runtimes.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Internal API token',
      },
      'internal-api',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-microsandbox-preview-token',
        in: 'header',
        description: 'Preview access token for sandbox proxy',
      },
      'preview-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      syntaxHighlight: { theme: 'monokai' },
    },
  });
}
