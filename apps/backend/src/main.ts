import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const port = app.get(ConfigService).get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Hatly backend listening on port ${port} (docs at /docs)`);
}

bootstrap();
