import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../addresses/data/addresses_providers.dart';
import '../../addresses/domain/saved_address.dart';

/// LAUNCH TRACK L1-A. Replaces `address_fixture.dart`'s role for
/// Home — reuses the SAME real data source Checkout already reads
/// (`savedAddressesProvider`), never a second competing address
/// store. No `isDefault`/`isPrimary` concept exists on the backend
/// `Address` entity (confirmed by inspection) — the first saved
/// address is used as the sensible default when nothing has been
/// explicitly picked via the selection sheet; this override is a
/// thin id, not a duplicate copy of address data.
final homeSelectedAddressIdProvider = StateProvider<String?>((ref) => null);

/// `null` data value (inside AsyncData) means "no saved addresses
/// exist yet" — never fabricated. Loading/error states pass through
/// from the real `savedAddressesProvider` unchanged.
final homeActiveAddressProvider = Provider<AsyncValue<SavedAddress?>>((ref) {
  final addressesAsync = ref.watch(savedAddressesProvider);
  final selectedId = ref.watch(homeSelectedAddressIdProvider);

  return addressesAsync.whenData((addresses) {
    if (addresses.isEmpty) return null;
    if (selectedId != null) {
      for (final address in addresses) {
        if (address.id == selectedId) return address;
      }
    }
    return addresses.first;
  });
});
