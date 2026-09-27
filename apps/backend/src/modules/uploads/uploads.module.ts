import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Upload } from './entities/upload.entity';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { UPLOAD_PROVIDER } from './upload-provider.interface';
import { StubUploadProvider } from './providers/stub-upload.provider';
import { LocalFilesystemUploadProvider } from './providers/local-filesystem-upload.provider';

/**
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
    { provide: UPLOAD_PROVIDER, useClass: LocalFilesystemUploadProvider },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
