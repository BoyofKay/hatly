import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../domain/home_banner.dart';
import 'home_banners_api.dart';

final homeBannersApiProvider = Provider<HomeBannersApi>(
    (ref) => HomeBannersApi(ref.watch(apiClientProvider)));

/// The admin-managed Home banners. Kept OUT of `homeSnapshotProvider` on purpose: promotional images are optional, so a slow or
/// failing banner request must never delay or blank the rest of Home (see [HomeBannerSection], which falls back quietly).
final homeBannersProvider = FutureProvider.autoDispose<List<HomeBanner>>(
    (ref) => ref.watch(homeBannersApiProvider).getBanners());
