import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { UuidParamPipe } from './common/pipes/uuid-param.pipe';
import { UPLOAD_PROVIDER, UploadProvider } from './modules/uploads/upload-provider.interface';
import { createPrivateMediaRedirect } from './modules/uploads/private-media-redirect';
import { buildCorsOptions, DEFAULT_BODY_LIMIT, securityHeaders, staticFileHeaders, UPLOAD_BODY_LIMIT } from './config/http-security';
import { isImageUploadRequest, limitConcurrentUploads } from './common/middleware/upload-concurrency.middleware';
import { JwtService } from '@nestjs/jwt';

/**
 * Everything `main.ts` configures on the Nest application beyond
 * `AppModule` itself (security headers, CORS, trust-proxy, body limits, static uploads, the global API prefix, the
 * global ValidationPipe, Swagger). Extracted so the real-runtime
 * integration tests bootstrap the application EXACTLY as production
 * does, instead of re-implementing (and silently drifting from) this
 * wiring.
 *
 * M5 Batch 1: every environment-dependent decision here is driven by validated configuration
 * (`config/configuration.ts` `http.*`), never by a raw `process.env` read.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const strict = config.get<boolean>('http.strict') ?? false;
  const apiPrefix = config.get<string>('apiPrefix')!;

  app.disable('x-powered-by'); // no framework fingerprint on every response

  // Trust forwarded headers ONLY when explicitly configured (a hop count or proxy list — never "everything"): otherwise a client
  // could spoof X-Forwarded-For and defeat per-IP rate limiting; behind a real proxy WITHOUT it every client shares one IP.
  const trustProxy = config.get<number | string[] | false>('http.trustProxy');
  if (trustProxy !== false && trustProxy !== undefined) app.set('trust proxy', trustProxy);

  // Static uploads route (served from this API's own disk). An absolute https:// prefix means external storage: nothing to serve.
  const publicPrefix = config.get<string>('uploads.publicUrlPrefix') ?? '/uploads/files';
  const staticPrefix = publicPrefix.startsWith('/') ? publicPrefix : null;

  app.use(securityHeaders({ hsts: strict, staticPrefix }));

  // Production/staging: only the configured origins (never `*`). Development/test with no list: open, as before.
  app.enableCors(buildCorsOptions(config.get<string[]>('http.corsAllowedOrigins') ?? [], strict));

  // Body limits. Explicit (not the framework default) so they are reviewable: 100 kb everywhere, except the image upload,
  // which carries a base64 image. The upload parser is registered first so the stricter default never sees that route.
  // Before any body is buffered: at most N image uploads in flight (memory protection; see the middleware's own comment).
  const jwtService = app.get(JwtService);
  const accessSecret = config.get<string>('auth.accessSecret');
  app.use(
    limitConcurrentUploads({
      max: config.get<number>('uploads.maxConcurrent') ?? 6,
      matches: isImageUploadRequest(apiPrefix),
      isAuthenticated: (req) => {
        const header = req.headers.authorization;
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
        try {
          jwtService.verify(header.slice(7), { secret: accessSecret, algorithms: ['HS256'] });
          return true;
        } catch {
          return false;
        }
      },
    }),
  );
  app.use(`/${apiPrefix}/uploads`, json({ limit: UPLOAD_BODY_LIMIT }));
  app.useBodyParser('json', { limit: DEFAULT_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: DEFAULT_BODY_LIMIT });

  // Reading stored media, by storage driver (`storage.driver`):
  //  - local (default): serves files written by LocalFilesystemUploadProvider. Directory listings/index files and dotfiles are
  //    never served, and every file is sent as non-executable (`nosniff` + a sandboxing CSP) so an upload can never run as a page/script.
  //  - s3 + private: the bucket is not public; the same `/uploads/files/<name>` reference 302-redirects to a short-lived signed URL.
  //  - s3 + public: references are absolute public URLs — nothing to serve here.
  const storageDriver = config.get<string>('storage.driver') ?? 'local';
  if (staticPrefix) {
    if (storageDriver === 's3') {
      if ((config.get<string>('storage.access') ?? 'private') === 'private') {
        const provider = app.get<UploadProvider>(UPLOAD_PROVIDER, { strict: false });
        app.use(staticPrefix, createPrivateMediaRedirect(provider, config.get<number>('storage.signedUrlTtlSeconds') ?? 300));
      }
    } else {
      const localUploadDir = config.get<string>('uploads.localDir') || './uploads-storage';
      app.useStaticAssets(localUploadDir, {
        prefix: staticPrefix,
        index: false,
        dotfiles: 'deny',
        redirect: false,
        setHeaders: staticFileHeaders,
      });
    }
  }

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new UuidParamPipe(),
    new ValidationPipe({
      whitelist: true, // strips unknown properties instead of erroring — safer default for client-supplied bodies
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The Swagger UI documents every route: on by default for local development, opt-in (ENABLE_API_DOCS=true) when deployed.
  if (config.get<boolean>('http.enableApiDocs')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Hatly API')
      .setDescription('Hatly delivery marketplace backend API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }
}
