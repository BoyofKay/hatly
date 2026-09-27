import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as path from 'path';
import { UuidParamPipe } from './common/pipes/uuid-param.pipe';

/**
 * Everything `main.ts` configures on the Nest application beyond
 * `AppModule` itself (CORS, static uploads, the global API prefix, the
 * global ValidationPipe, Swagger). Extracted so the real-runtime
 * integration tests bootstrap the application EXACTLY as production
 * does, instead of re-implementing (and silently drifting from) this
 * wiring.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  app.disable('x-powered-by'); // no framework fingerprint on every response

  app.enableCors(); // tighten to known origins (customer/driver apps, dashboard) before production launch

  // CHUNK 12B-1 CORRECTION: serves files written by
  // LocalFilesystemUploadProvider — matches that provider's own
  // `uploads.publicUrlPrefix` default exactly. A future real
  // S3-compatible provider would return a real external URL instead
  // and this line would simply become unused, not need removing.
const localUploadDir = config.get<string>('uploads.localDir') || './uploads-storage';
app.useStaticAssets(localUploadDir, { prefix: '/uploads/files' });

  app.setGlobalPrefix(config.get<string>('apiPrefix')!);

  app.useGlobalPipes(
    new UuidParamPipe(),
    new ValidationPipe({
      whitelist: true, // strips unknown properties instead of erroring — safer default for client-supplied bodies
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hatly API')
    .setDescription('Hatly delivery marketplace backend API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}
