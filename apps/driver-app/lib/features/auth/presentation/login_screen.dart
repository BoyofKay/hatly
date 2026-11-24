import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../../core/utils/egypt_phone_number.dart';
import '../../../core/localization/bilingual.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../data/driver_auth_api.dart';
import 'forgot_password_screen.dart';
import 'auth_state_provider.dart';

/// CONFIRMED (locked decision): phone + password only, no OTP, no
/// registration. On success, updates the existing [authStateProvider]
/// — the app's existing GoRouter redirect logic (see app_router.dart,
/// unchanged) then takes over navigation to Home automatically.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isSubmitting = false;
  bool _showPassword = false;
  String? _error;
  static const _savedPhoneKey = 'hatly_driver_last_phone';
  final _storage = const FlutterSecureStorage();

  @override
  void initState() {
    super.initState();
    _restorePhone();
  }

  Future<void> _restorePhone() async {
    try {
      final saved = await _storage.read(key: _savedPhoneKey);
      if (mounted && saved != null && _phoneController.text.isEmpty) {
        setState(() => _phoneController.text = saved.startsWith('+20') ? saved.substring(3) : saved);
      }
    } catch (_) { /* Local storage is optional; login must still work. */ }
  }


  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (_isSubmitting) return;
    final phone = EgyptPhoneNumber.normalizeForAuth(_phoneController.text);
    if (phone == null) {
      setState(() => _error = context.t('Enter a valid Egyptian mobile number.', 'أدخل رقم هاتف مصري صحيح.'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      final api = DriverAuthApi(
          ref.read(apiClientProvider), ref.read(tokenStorageProvider));
      final mustChange = await api.login(
          phone: phone,
          password: _passwordController.text);
      try { await _storage.write(key: _savedPhoneKey, value: phone); } catch (_) {}
      if (!mounted) return;
      TextInput.finishAutofillContext(shouldSave: true);
      ref.read(authStateProvider.notifier).setAuthenticated(true, mustChangePassword: mustChange);
    } on DioException catch (error) {
      if (!mounted) return;
      // The server explains in English; the driver always sees their own language.
      final status = error.response?.statusCode;
      setState(() {
        _error = status == 429
            ? context.t('Too many attempts. Please wait a few minutes and try again.',
                'محاولات كثيرة. انتظر بضع دقائق ثم حاول مرة أخرى.')
            : status == null
                ? context.t('Something went wrong. Please check your connection.',
                    'حدث خطأ. تحقق من اتصالك بالإنترنت.')
                : context.t('Invalid phone number or password. Please try again.',
                    'رقم الهاتف أو كلمة المرور غير صحيحة. حاول مرة أخرى.');
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = context.t(
          'Something went wrong. Please check your connection.',
          'حدث خطأ. تحقق من اتصالك بالإنترنت.'));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// No SMS provider yet, so no self-service code: Hatly operations set a temporary password from the admin panel (Drivers ›
  /// Reset password) and send it to the driver, who signs in with it.
  /// Request-based "Forgot password?" (owner decision 2026-11-23): its own screen — request, then the temporary password + a new one.
  void _showForgotPassword(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ForgotPasswordScreen(initialPhone: EgyptPhoneNumber.normalizeForAuth(_phoneController.text) ?? _phoneController.text.trim())));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: AutofillGroup(onDisposeAction: AutofillContextAction.cancel, child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The supplied Hatly logo, bundled unchanged (assets/images/hatly-driver-icon.png).
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(22),
                    child: Image.asset(
                      'assets/images/hatly-driver-icon.png',
                      key: const Key('hatly-logo'),
                      width: 96,
                      height: 96,
                      cacheWidth: 288,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) =>
                          const SizedBox(width: 96, height: 96),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  context.t('Hatly Driver', 'سائق هاتلي'),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 32),
                Directionality(textDirection: TextDirection.ltr, child: TextField(
                  key: const Key('login-phone'),
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  inputFormatters: const [DriverNationalPhoneFormatter()],
                  onChanged: (_) => setState(() {}),
                  autofillHints: const [AutofillHints.username, AutofillHints.telephoneNumberNational],
                  decoration: InputDecoration(
                    prefixIcon: SizedBox(width: 86, child: Center(child: Text(EgyptPhoneNumber.looksInternational(_phoneController.text) ? 'Intl' : '🇪🇬 +20', style: const TextStyle(fontWeight: FontWeight.w700)))),
                    labelText: context.t('Phone number', 'رقم الهاتف'),
                    hintText: '10XXXXXXXX',
                    border: const OutlineInputBorder()),
                )),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('login-password'),
                  controller: _passwordController,
                  obscureText: !_showPassword,
                  enableSuggestions: false,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.password],
                  decoration: InputDecoration(
                    labelText: context.t('Password', 'كلمة المرور'),
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      key: const Key('toggle-password'),
                      tooltip: _showPassword
                          ? context.t('Hide password', 'إخفاء كلمة المرور')
                          : context.t('Show password', 'إظهار كلمة المرور'),
                      icon: Icon(_showPassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined),
                      onPressed: () =>
                          setState(() => _showPassword = !_showPassword),
                    ),
                  ),
                  onSubmitted: (_) => _handleLogin(),
                ),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton(
                    key: const Key('forgot-password'),
                    onPressed: () => _showForgotPassword(context),
                    child: Text(context.t('Forgot password?', 'نسيت كلمة المرور؟')),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _isSubmitting ? null : _handleLogin,
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : Text(context.t('Login', 'تسجيل الدخول')),
                ),
              ],
            ),
          )),
        ),
      ),
    );
  }
}
