import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../../auth/presentation/auth_state_provider.dart';
import '../../deliveries/data/driver_providers.dart';
import '../../overview/overview_api.dart';

/// Language and sign-out. There is deliberately nothing here about accepting or rejecting orders: Hatly assigns them.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider);
    final name = ref.watch(driverProfileNameProvider);
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SectionTitle(context.t('Driver name', 'اسم المندوب')),
          DriverCard(
            child: ListTile(
              key: const Key('driver-profile-name'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.badge_outlined),
              title: Text(name.when(
                data: (value) => value.isNotEmpty ? value : context.t('Name unavailable', 'الاسم غير متاح'),
                loading: () => context.t('Loading...', 'جاري التحميل...'),
                error: (_, __) => context.t('Unable to load name', 'تعذّر تحميل الاسم'),
              )),
              subtitle: Text(context.t('To change your name, contact Hatly operations.',
                  'لتغيير اسمك، تواصل مع إدارة هاتلي.')),
              trailing: const Icon(Icons.lock_outline, size: 18),
            ),
          ),
          SectionTitle(context.t('Language', 'اللغة')),
          DriverCard(
            child: SegmentedButton<String>(
              key: const Key('language-switch'),
              segments: const [ButtonSegment(value: 'ar', label: Text('العربية')), ButtonSegment(value: 'en', label: Text('English'))],
              selected: {locale.languageCode},
              onSelectionChanged: (s) => ref.read(localeProvider.notifier).set(Locale(s.first)),
            ),
          ),
          SectionTitle(context.t('Session', 'الجلسة')),
          DriverCard(
            child: ListTile(
              key: const Key('logout-button'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.logout),
              title: Text(context.t('Sign out', 'تسجيل الخروج')),
              subtitle: Text(context.t('Stops sharing your location and returns to the login screen.', 'يوقف مشاركة موقعك ويعيدك إلى شاشة الدخول.')),
              onTap: () {
                // Same approved sequence as before: stop the location timer, clear the session, return to login.
                ref.read(driverOnlineStateProvider.notifier).resetOnLogout();
                ref.read(authStateProvider.notifier).logout();
              },
            ),
          ),
        ],
      ),
    );
  }
}
