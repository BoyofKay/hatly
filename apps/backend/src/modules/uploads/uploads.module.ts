import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Upload } from './entities/upload.entity';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { UPLOAD_PROVIDER } from './upload-provider.interface';
import { StubUploadProvider } from './providers/stub-upload.provider';
import { LocalFilesystemUploadProvider } from './providers/local-filesystem-upload.provider';
import { buildS3UploadProvider } from './providers/s3-upload.settings';

/**
 * M5 Batch 2: the binding below is now a driver switch (`STORAGE_DRIVER=local|s3`); `local` remains the default.
 *
 * CHUNK 12B-1 CORRECTION: `UPLOAD_PROVIDER` now binds to
 * `LocalFilesystemUploadProvider` (real bytes written to disk) —
 * replacing the previous `StubUploadProvider` binding, which discarded
 * every uploaded file's content. `StubUploadProvider` itself is left
 * in the codebase, still a valid `UploadProvider` implementation, in
 * case a lightweight no-disk-IO binding is ever wanted again (e.g. a
 * future test environment) — just no longer the default.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Upload])],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    StubUploadProvider,
    LocalFilesystemUploadProvider,
    // Storage driver by configuration: `local` (default, the development workflow — files under uploads-storage) or `s3`
    // (S3-compatible object storage; production). Nothing else in the application knows which one is active.
    {
      provide: UPLOAD_PROVIDER,
      inject: [ConfigService, LocalFilesystemUploadProvider],
      useFactory: (config: ConfigService, local: LocalFilesystemUploadProvider) =>
        config.get<string>('storage.driver') === 's3' ? buildS3UploadProvider(config) : local,
    },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
