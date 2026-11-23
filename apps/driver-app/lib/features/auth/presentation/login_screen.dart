import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../../core/localization/bilingual.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../data/driver_auth_api.dart';
import '../../overview/overview_api.dart';
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

  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (_isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      final api = DriverAuthApi(
          ref.read(apiClientProvider), ref.read(tokenStorageProvider));
      final mustChange = await api.login(
          phone: _phoneController.text.trim(),
          password: _passwordController.text);
      ref.read(authStateProvider.notifier).setAuthenticated(true, mustChangePassword: mustChange);
    } on DioException catch (error) {
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
      setState(() => _error = context.t(
          'Something went wrong. Please check your connection.',
          'حدث خطأ. تحقق من اتصالك بالإنترنت.'));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// No SMS provider yet, so no self-service code: Hatly operations set a temporary password from the admin panel (Drivers ›
  /// Reset password) and send it to the driver, who signs in with it.
  /// Driver app round 2: "Forgot password?" sends a request to Hatly operations (no SMS provider yet, so the app cannot verify identity by
  /// itself). Operations call the driver, set a temporary password, and the app then asks for a new one at sign-in.
  void _showForgotPassword(BuildContext context) {
    final phone = TextEditingController(text: _phoneController.text.trim());
    showDialog<void>(
      context: context,
      builder: (ctx) {
        var sending = false;
        var sent = false;
        String? error;
        return StatefulBuilder(
          builder: (ctx, setDialog) => AlertDialog(
            title: Text(ctx.t('Forgot your password?', 'نسيت كلمة المرور؟')),
            content: sent
                ? Text(
                    ctx.t('Request sent. Hatly operations will call you and give you a temporary password — sign in with it here, then choose your own.',
                        'تم إرسال الطلب. سيتصل بك فريق تشغيل هاتلي ويعطيك كلمة مرور مؤقتة — ادخل بها هنا ثم اختر كلمة مرور خاصة بك.'),
                    key: const Key('forgot-sent'),
                  )
                : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(ctx.t('Send a request to Hatly operations. They will call you to confirm it is you and give you a temporary password.',
                        'أرسل طلبًا لفريق تشغيل هاتلي. سيتصلون بك للتأكد أنك أنت ويعطونك كلمة مرور مؤقتة.')),
                    const SizedBox(height: 12),
                    TextField(
                      key: const Key('forgot-phone'),
                      controller: phone,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(labelText: ctx.t('Your phone number', 'رقم هاتفك'), border: const OutlineInputBorder()),
                    ),
                    if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Colors.red))),
                  ]),
            actions: sent
                ? [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(ctx.t('OK', 'حسنًا')))]
                : [
                    TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(ctx.t('Cancel', 'إلغاء'))),
                    FilledButton(
                      key: const Key('forgot-send'),
                      onPressed: sending
                          ? null
                          : () async {
                              if (phone.text.trim().length < 6) {
                                setDialog(() => error = ctx.t('Enter your phone number.', 'أدخل رقم هاتفك.'));
                                return;
                              }
                              setDialog(() {
                                sending = true;
                                error = null;
                              });
                              try {
                                await ref.read(overviewApiProvider).requestPasswordReset(phone.text.trim());
                                setDialog(() {
                                  sending = false;
                                  sent = true;
                                });
                              } on DioException catch (e) {
                                setDialog(() {
                                  sending = false;
                                  error = e.response?.statusCode == 429
                                      ? ctx.t('Too many attempts. Please wait a few minutes.', 'محاولات كثيرة. انتظر بضع دقائق.')
                                      : ctx.t('Could not send the request. Check your connection, or call your supervisor.', 'تعذّر إرسال الطلب. تحقق من الاتصال، أو اتصل بمشرفك.');
                                });
                              }
                            },
                      child: Text(ctx.t('Send request', 'إرسال الطلب')),
                    ),
                  ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The supplied Hatly logo, bundled unchanged (assets/images/hatly-logo.jpg — the same file the Customer app uses).
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(22),
                    child: Image.asset(
                      'assets/images/hatly-logo.jpg',
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
                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                      labelText: context.t('Phone number', 'رقم الهاتف'),
                      border: const OutlineInputBorder()),
                ),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('login-password'),
                  controller: _passwordController,
                  obscureText: !_showPassword,
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
          ),
        ),
      ),
    );
  }
}
