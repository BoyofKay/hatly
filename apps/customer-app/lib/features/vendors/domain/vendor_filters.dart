/// Filters V1. The Vendor List's active filter state — everything
/// EXCEPT subcategory (which already has its own, separately-visible
/// chip row above the list — see `SubcategoryChipRow` — and is never
/// duplicated inside this filter sheet). Deliberately immutable and
/// explicit: the parent screen holds exactly one instance as its
/// "committed" filter state, and the filter sheet edits its own local
/// draft copy, never this one directly, until "تطبيق" (Apply).
class VendorFilters {
  const VendorFilters({
    this.openNow = false,
    this.hasOffers = false,
    this.minRating,
  });

  /// Real `VendorBranch.isOpen` — never inferred from a schedule.
  final bool openNow;

  /// Real, currently-active `Offer` existence — never a fabricated badge.
  final bool hasOffers;

  /// `4.0` or `3.0` (the two sensible thresholds this milestone
  /// exposes) or `null` ("Any" — no rating filter). Real
  /// `VendorBranch.ratingSumStars/ratingCount`, never fabricated.
  final double? minRating;

  static const empty = VendorFilters();

  bool get isEmpty => !openNow && !hasOffers && minRating == null;

  /// How many distinct filters are active — shown as the badge count
  /// on the "فلترة" (Filter) button.
  int get activeCount =>
      (openNow ? 1 : 0) + (hasOffers ? 1 : 0) + (minRating != null ? 1 : 0);

  VendorFilters copyWith({
    bool? openNow,
    bool? hasOffers,
    // A tri-state setter: omitted keeps the current value, an explicit
    // `double?` (including a literal `null` wrapped this way) replaces
    // it — needed because `minRating` itself is nullable and a plain
    // `minRating ?? this.minRating` could never clear it back to null.
    Object? minRating = _unset,
  }) {
    return VendorFilters(
      openNow: openNow ?? this.openNow,
      hasOffers: hasOffers ?? this.hasOffers,
      // `(... as num?)?.toDouble()`, not a bare `as double?` — an int literal
      // (e.g. `copyWith(minRating: 4)`) passed through this `Object?` sentinel
      // parameter keeps its literal `int` type at runtime (Dart's int->double
      // literal promotion only applies when the target type is `double`
      // itself, not when erased to `Object?` first) — a bare cast would throw.
      minRating: minRating == _unset ? this.minRating : (minRating as num?)?.toDouble(),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is VendorFilters &&
      other.openNow == openNow &&
      other.hasOffers == hasOffers &&
      other.minRating == minRating;

  @override
  int get hashCode => Object.hash(openNow, hasOffers, minRating);
}

const _unset = Object();
