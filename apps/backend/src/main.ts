import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.setup';
import { collectEnvIssues, ConfigurationError } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  // Non-fatal configuration findings (e.g. an acknowledged missing SMS provider, TRUST_PROXY unset). Messages never contain secrets.
  const logger = new Logger('Config');
  for (const warning of collectEnvIssues(process.env).warnings) logger.warn(warning);

  const port = app.get(ConfigService).get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Hatly backend listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  // A configuration error is a clear, secret-free operator message — print it without a stack and exit non-zero so the process
  // manager marks the deploy as failed. Anything else keeps its full diagnostic.
  if (error instanceof ConfigurationError) {
    // eslint-disable-next-line no-console
    console.error(error.message);
  } else {
    // eslint-disable-next-line no-console
    console.error('Hatly backend failed to start:', error);
  }
  process.exit(1);
});
