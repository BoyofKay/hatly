import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'uploads_api.dart';

final uploadsApiProvider =
    Provider<UploadsApi>((ref) => UploadsApi(ref.watch(apiClientProvider)));
