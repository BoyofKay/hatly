import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAP_PROVIDER, MapProvider } from './map-provider.interface';
import { GoogleMapsProvider } from './providers/google-maps.provider';
import { DeterministicMapProvider } from './providers/deterministic-map.provider';
import { UnavailableMapProvider } from './providers/unavailable-map.provider';

/**
 * Selects the `MapProvider` implementation from `MAPS_PROVIDER` (config key `maps.provider`,
 * env var `MAPS_PROVIDER`, default `'google'`) — the SAME `MapProvider` interface/DI token
 * every caller already depends on; this only decides which class backs it.
 *
 * FAIL CLOSED, structurally, not by convention: `'deterministic'` (see
 * `DeterministicMapProvider`'s own doc comment — straight-line distance, dev/test only) is
 * refused outright when `NODE_ENV=production` — the exact same discipline
 * `OtpService`'s constructor already applies to `OTP_LOG_CODE_FOR_LOCAL_DEV`. This throws at
 * application bootstrap (Nest fails to start), never silently falls back to a fake distance
 * in a production deployment.
 *
 * Exported as a plain function (not inlined in the `useFactory`) so it's directly unit-testable
 * without spinning up a Nest testing module.
 */
export function resolveMapProvider(
  configuredProvider: string | undefined,
  env: string | undefined,
  google: MapProvider,
  deterministic: MapProvider,
  unavailable?: MapProvider,
): MapProvider {
  // PD-009 G: Maps deliberately disabled — allowed in every environment (it invents nothing; see UnavailableMapProvider).
  if (configuredProvider === 'none') {
    if (!unavailable) throw new Error('MAPS_PROVIDER=none needs the UnavailableMapProvider.');
    return unavailable;
  }
  if (configuredProvider === 'deterministic') {
    if (env === 'production') {
      throw new Error(
        'MAPS_PROVIDER=deterministic must never be used when NODE_ENV=production. ' +
          'Set MAPS_PROVIDER=google (the default) and configure a real GOOGLE_MAPS_API_KEY instead.',
      );
    }
    return deterministic;
  }
  if (configuredProvider !== undefined && configuredProvider !== 'google') {
    throw new Error(`Unknown MAPS_PROVIDER "${configuredProvider}" — expected "google", "none" or "deterministic".`);
  }
  return google;
}

@Module({
  providers: [
    GoogleMapsProvider,
    DeterministicMapProvider,
    UnavailableMapProvider,
    {
      provide: MAP_PROVIDER,
      useFactory: (configService: ConfigService, google: GoogleMapsProvider, deterministic: DeterministicMapProvider, unavailable: UnavailableMapProvider) => {
        const provider = resolveMapProvider(configService.get<string>('maps.provider'), configService.get<string>('env'), google, deterministic, unavailable);
        if (provider === unavailable) {
          new Logger('LocationModule').warn(
            'Maps DISABLED (MAPS_PROVIDER=none): delivery is priced and bounded by the selected Delivery Zone; dispatch ranks drivers by straight-line distance; address search is off.',
          );
        }
        return provider;
      },
      inject: [ConfigService, GoogleMapsProvider, DeterministicMapProvider, UnavailableMapProvider],
    },
  ],
  exports: [MAP_PROVIDER],
})
export class LocationModule {}
