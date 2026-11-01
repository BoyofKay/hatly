import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../../core/localization/bilingual.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../data/driver_auth_api.dart';
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
      await api.login(
          phone: _phoneController.text.trim(),
          password: _passwordController.text);
      ref.read(authStateProvider.notifier).setAuthenticated(true);
    } on DioException catch (error) {
      final message = error.response?.data is Map
          ? (error.response?.data as Map)['message']
          : null;
      setState(() {
        _error = (message as String?) ??
            context.t('Invalid credentials. Please try again.',
                'بيانات الدخول غير صحيحة. حاول مرة أخرى.');
      });
    } catch (_) {
      setState(() => _error = context.t(
          'Something went wrong. Please check your connection.',
          'حدث خطأ. تحقق من اتصالك بالإنترنت.'));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
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
                  controller: _passwordController,
                  obscureText: true,
                  decoration: InputDecoration(
                      labelText: context.t('Password', 'كلمة المرور'),
                      border: const OutlineInputBorder()),
                  onSubmitted: (_) => _handleLogin(),
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
