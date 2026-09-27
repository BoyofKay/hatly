import '../../home/data/home_content_config.dart';

/// Explore content configuration — the single place to change how the Explore
/// discovery sections are composed, without touching any widget.
///
/// Nothing here is a business rule or a popularity metric: it only limits how
/// much of the EXISTING data each section shows.

/// Shop by Category on Explore starts collapsed at this many categories (two
/// rows of the 3-column grid) so the first viewport also shows other sections;
/// "عرض الكل ←" expands to every available category and "عرض أقل" collapses.
const int kExploreInitialCategoryCount = 6;

/// "Featured categories": categories listed here (by stable `slug`) come first,
/// in this order. Empty (default) means "no editorial pinning" and the section
/// simply surfaces the first categories of the existing backend order
/// (`sortOrder`), exactly like Shop by Category. No usage or popularity data is
/// involved.
const List<String> kExploreFeaturedCategorySlugs = <String>[];

/// How many categories the "Featured categories" row shows.
const int kExploreFeaturedCategoryCount = 6;

/// With fewer categories than this, Shop by Category already fits in one row,
/// so a second, smaller copy of the same tiles would only be noise — the
/// section is hidden.
const int kExploreFeaturedCategoryMinTotal = 4;

/// "New on Hatly" vendors: how many sectors are queried (existing per-sector
/// listing with `sort=newest`), how many vendors are taken from each, and how
/// many are shown in total.
const int kExploreNewVendorSectorFanout = kHomeVendorSectorFanout;
const int kExploreNewVendorsPerSector = 3;
const int kExploreNewVendorCount = 4;

/// Backend search only starts at this many characters (mirrors the backend's
/// own gate); category matching uses the same threshold for consistency.
const int kExploreMinQueryLength = 2;
