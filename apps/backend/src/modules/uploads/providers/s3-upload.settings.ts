import { ConfigService } from '@nestjs/config';
import { S3UploadProvider, S3UploadSettings } from './s3-upload.provider';

/** Builds the S3 provider from validated configuration (`storage.*`, `uploads.publicUrlPrefix`). Throws a clear error if a required value is missing. */
export function s3SettingsFromConfig(config: ConfigService): S3UploadSettings {
  const get = <T>(key: string): T | undefined => config.get<T>(key);
  const need = (key: string): string => {
    const v = get<string>(key);
    if (!v) throw new Error(`Object storage is enabled (STORAGE_DRIVER=s3) but ${key} is not configured.`);
    return v;
  };
  return {
    endpoint: get<string>('storage.endpoint') || undefined,
    region: need('storage.region'),
    bucket: need('storage.bucket'),
    accessKey: need('storage.accessKey'),
    secretKey: need('storage.secretKey'),
    forcePathStyle: get<boolean>('storage.forcePathStyle') ?? false,
    access: get<'private' | 'public'>('storage.access') ?? 'private',
    publicBaseUrl: get<string>('storage.publicBaseUrl') || undefined,
    signedUrlTtlSeconds: get<number>('storage.signedUrlTtlSeconds') ?? 300,
    keyPrefix: get<string>('storage.keyPrefix') ?? '',
    publicUrlPrefix: get<string>('uploads.publicUrlPrefix') ?? '/uploads/files',
  };
}

export function buildS3UploadProvider(config: ConfigService): S3UploadProvider {
  return new S3UploadProvider(s3SettingsFromConfig(config));
}
