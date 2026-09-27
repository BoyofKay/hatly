import 'package:flutter/foundation.dart';

/// Home content configuration — the single place to change how Home is
/// composed, without touching any widget.

/// Demo content (clearly isolated in `home_demo_content.dart`) fills sections
/// that have no real data yet, so the design can be reviewed end to end.
///
/// **Default: debug builds only.** A release build shows real data or hides the
/// section; it never shows invented offers. Override at build time with
/// `--dart-define=HATLY_HOME_DEMO=true|false`.
const bool kHomeDemoContentEnabled =
    bool.fromEnvironment('HATLY_HOME_DEMO', defaultValue: kDebugMode);

/// Shop-by-category ordering is data-driven: the backend `sortOrder` decides.
/// To pin categories first without a backend change, list their slugs here in
/// the desired order; everything else follows in `sortOrder`.
const List<String> kHomeCategoryPinnedSlugs = <String>[];

/// How many categories the Home grid shows (4 rows of 3). More than this and
/// the section offers "عرض الكل" instead of growing the page.
const int kHomeMaxCategories = 12;

/// How many sectors are queried to assemble "Popular near you" (there is no
/// all-vendors endpoint; the existing per-sector listing is reused).
const int kHomeVendorSectorFanout = 3;

/// "Popular near you" shows exactly this many vendors.
const int kHomePopularVendorCount = 4;

/// How many of the popular vendors are used to source "Popular & New" products
/// and offers, and how many products of each tag are taken from each.
const int kHomeProductSourceVendors = 3;
const int kHomeProductsPerTagPerVendor = 3;
const int kHomeMaxProductEntries = 10;
const int kHomeMaxOffers = 8;
const int kHomeMaxPromos = 5;
