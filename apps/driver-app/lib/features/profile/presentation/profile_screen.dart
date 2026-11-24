import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
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
    final position = ref.watch(driverFinancialPositionProvider);
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      body: RefreshIndicator(
        onRefresh: () async { try { await ref.refresh(driverFinancialPositionProvider.future); } catch (_) { /* Provider renders its retry state. */ } },
        child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
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
          position.when(
            data: (d) => d.totalPositionMinor == null
                ? DriverCard(child: Text(context.t('Financial position is unavailable.', 'الموقف المالي غير متاح.')))
                : _FinancialPositionCard(data: d),
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => DriverCard(child: Column(children: [
              Text(context.t('Could not load your financial position.', 'تعذّر تحميل الموقف المالي.')),
              TextButton(onPressed: () => ref.invalidate(driverFinancialPositionProvider), child: Text(context.t('Retry', 'إعادة المحاولة'))),
            ])),
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
      ),
    );
  }
}

class _FinancialPositionCard extends StatelessWidget {
  const _FinancialPositionCard({required this.data});
  final CurrentEarnings data;
  @override
  Widget build(BuildContext context) {
    final d = data;
    String money(int v) => formatMinor(v, arabic: context.isArabic);
    return Card(key: const Key('driver-financial-position'), child: Padding(padding: const EdgeInsets.all(12), child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(context.t('Financial position', 'الموقف المالي'), style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(context.t('Current unclosed: ${money(d.balanceMinor)}', 'الرصيد غير المقفل: ${money(d.balanceMinor)}')),
              Text(context.t('Previous unpaid payouts: ${money(d.unpaidPayoutMinor)}', 'مستحقات سابقة لك: ${money(d.unpaidPayoutMinor)}')),
              Text(context.t('Previous uncollected amounts: ${money(d.unpaidCollectionMinor)}', 'مستحقات سابقة عليك: ${money(d.unpaidCollectionMinor)}')),
              const Divider(),
              Text(context.t('Total net position: ${money(d.totalPositionMinor!)}', 'صافي الموقف المالي: ${money(d.totalPositionMinor!)}'),
                style: TextStyle(fontWeight: FontWeight.w800, color: d.totalPositionMinor! < 0 ? Colors.red.shade700 : Colors.green.shade800)),
              Text(context.t('Positive: Hatly owes you. Negative: you owe Hatly. Loans are separate.', 'الموجب: هاتلي تدين لك. السالب: أنت مدين لهاتلي. السلف منفصلة.'), style: const TextStyle(fontSize: 11)),
            ])));
  }
}
