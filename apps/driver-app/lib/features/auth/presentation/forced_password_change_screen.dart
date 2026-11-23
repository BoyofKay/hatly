import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/network/providers.dart';
import '../../deliveries/data/driver_providers.dart';
import '../data/driver_auth_api.dart';
import 'auth_state_provider.dart';

/// Owner decision 2026-11-23: after signing in with a TEMPORARY password (set by Hatly operations from the admin panel) the driver must
/// choose their own before anything else. The server refuses every other call meanwhile (PASSWORD_CHANGE_REQUIRED).
class ForcedPasswordChangeScreen extends ConsumerStatefulWidget {
  const ForcedPasswordChangeScreen({super.key});

  @override
  ConsumerState<ForcedPasswordChangeScreen> createState() => _ForcedPasswordChangeScreenState();
}

class _ForcedPasswordChangeScreenState extends ConsumerState<ForcedPasswordChangeScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;
  bool _show = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    String? local;
    if (_current.text.isEmpty) {
      local = context.t('Enter the temporary password.', 'أدخل كلمة المرور المؤقتة.');
    } else if (_next.text.length < 8) {
      local = context.t('The new password must be at least 8 characters.', 'كلمة المرور الجديدة 8 أحرف على الأقل.');
    } else if (_next.text != _confirm.text) {
      local = context.t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.');
    } else if (_next.text == _current.text) {
      local = context.t('Choose a password different from the temporary one.', 'اختر كلمة مرور مختلفة عن المؤقتة.');
    }
    if (local != null) {
      setState(() => _error = local);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await DriverAuthApi(ref.read(apiClientProvider), ref.read(tokenStorageProvider))
          .changePassword(currentPassword: _current.text, newPassword: _next.text);
      if (!mounted) return;
      setState(() => _saving = false);
      ref.read(authStateProvider.notifier).passwordChanged();
    } on DioException catch (e) {
      if (!mounted) return;
      final body = e.response?.data;
      final error = body is Map ? body['error'] : null;
      final details = error is Map ? error['details'] : null;
      final code = details is Map ? details['code'] : null;
      setState(() {
        _saving = false;
        _error = switch (code) {
          'CURRENT_PASSWORD_INVALID' => context.t('The temporary password is not correct.', 'كلمة المرور المؤقتة غير صحيحة.'),
          'PASSWORD_UNCHANGED' => context.t('Choose a password different from the temporary one.', 'اختر كلمة مرور مختلفة عن المؤقتة.'),
          'TOO_MANY_FAILED_LOGINS' => context.t('Too many attempts. Please wait a few minutes.', 'محاولات كثيرة. انتظر بضع دقائق.'),
          _ => e.response == null
              ? context.t('Something went wrong. Please check your connection.', 'حدث خطأ. تحقق من اتصالك بالإنترنت.')
              : context.t('Could not change the password.', 'تعذّر تغيير كلمة المرور.'),
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String label) => InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: IconButton(
            icon: Icon(_show ? Icons.visibility_off : Icons.visibility),
            tooltip: _show ? context.t('Hide password', 'إخفاء كلمة المرور') : context.t('Show password', 'إظهار كلمة المرور'),
            onPressed: () => setState(() => _show = !_show),
          ),
        );
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: Text(context.t('Choose a new password', 'اختر كلمة مرور جديدة')),
          actions: [
            TextButton(
              key: const Key('temp-password-sign-out'),
              onPressed: () {
                ref.read(driverOnlineStateProvider.notifier).resetOnLogout();
                ref.read(authStateProvider.notifier).logout();
              },
              child: Text(context.t('Sign out', 'تسجيل الخروج')),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.lock_reset_rounded, size: 48),
              const SizedBox(height: 12),
              Text(
                context.t('You signed in with a temporary password from Hatly operations. Choose your own password to continue.',
                    'دخلت بكلمة مرور مؤقتة من عمليات هتلي. اختر كلمة مرور خاصة بك للمتابعة.'),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              TextField(key: const Key('temp-password-current'), controller: _current, obscureText: !_show, decoration: deco(context.t('Temporary password', 'كلمة المرور المؤقتة'))),
              const SizedBox(height: 12),
              TextField(key: const Key('temp-password-new'), controller: _next, obscureText: !_show, decoration: deco(context.t('New password (8+ characters)', 'كلمة المرور الجديدة (8 أحرف أو أكثر)'))),
              const SizedBox(height: 12),
              TextField(key: const Key('temp-password-confirm'), controller: _confirm, obscureText: !_show, decoration: deco(context.t('Repeat the new password', 'أعد كتابة كلمة المرور الجديدة'))),
              const SizedBox(height: 12),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(_error!, key: const Key('temp-password-error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              FilledButton(
                key: const Key('temp-password-save'),
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(context.t('Save and continue', 'حفظ ومتابعة')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
