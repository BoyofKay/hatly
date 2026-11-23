import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../overview/overview_api.dart';

/// Request-based "Forgot password?" (owner decision 2026-11-23). The driver sends a request; Hatly operations call and give a temporary
/// password (valid 60 minutes, 5 tries); the driver types it with a new password on this same screen. "Cancel" returns to sign-in — the
/// old password keeps working until the change succeeds.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key, this.initialPhone = ''});
  final String initialPhone;
  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

enum _Step { ask, enter, done }

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  late final _phone = TextEditingController(text: widget.initialPhone);
  final _temp = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  _Step _step = _Step.ask;
  bool _busy = false;
  bool _sent = false;
  bool _show = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _temp.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  static Map? _details(DioException e) {
    final body = e.response?.data;
    final error = body is Map ? body['error'] : null;
    final details = error is Map ? error['details'] : null;
    return details is Map ? details : null;
  }

  Future<void> _ask() async {
    if (_phone.text.trim().length < 6) {
      setState(() => _error = context.t('Enter your phone number.', 'أدخل رقم هاتفك.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(overviewApiProvider).requestPasswordReset(_phone.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _sent = true;
        _step = _Step.enter;
      });
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.response?.statusCode == 429
            ? context.t('Too many attempts. Please wait a few minutes.', 'محاولات كثيرة. انتظر بضع دقائق.')
            : context.t('Could not send the request. Check your connection, or call your supervisor.', 'تعذّر إرسال الطلب. تحقق من الاتصال، أو اتصل بمشرفك.');
      });
    }
  }

  Future<void> _complete() async {
    String? local;
    if (_temp.text.trim().isEmpty) {
      local = context.t('Enter the temporary password.', 'أدخل كلمة المرور المؤقتة.');
    } else if (_next.text.length < 8) {
      local = context.t('The new password must be at least 8 characters.', 'كلمة المرور الجديدة 8 أحرف على الأقل.');
    } else if (_next.text != _confirm.text) {
      local = context.t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.');
    }
    if (local != null) {
      setState(() => _error = local);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(overviewApiProvider).completePasswordReset(_phone.text.trim(), _temp.text.trim(), _next.text);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = _Step.done;
      });
    } on DioException catch (e) {
      if (!mounted) return;
      final d = _details(e);
      final code = d?['code'];
      final left = d?['attemptsLeft'];
      setState(() {
        _busy = false;
        switch (code) {
          case 'TEMP_PASSWORD_INVALID':
            _error = context.t('The temporary password is not correct (or not given yet).${left is num ? ' $left tries left.' : ''}',
                'كلمة المرور المؤقتة غير صحيحة (أو لم تُعطَ بعد).${left is num ? ' متبقٍ $left محاولات.' : ''}');
          case 'TEMP_PASSWORD_EXPIRED':
            _error = context.t('The temporary password has expired. Send a new request.', 'انتهت صلاحية كلمة المرور المؤقتة. أرسل طلبًا جديدًا.');
            _step = _Step.ask;
          case 'TEMP_PASSWORD_LOCKED':
            _error = context.t('Too many wrong tries. Send a new request.', 'محاولات خاطئة كثيرة. أرسل طلبًا جديدًا.');
            _step = _Step.ask;
          case 'PASSWORD_UNCHANGED':
            _error = context.t('Choose a password different from the temporary one.', 'اختر كلمة مرور مختلفة عن المؤقتة.');
          case 'WEAK_PASSWORD':
            _error = context.t('The new password must be at least 8 characters.', 'كلمة المرور الجديدة 8 أحرف على الأقل.');
          default:
            _error = e.response == null
                ? context.t('Something went wrong. Please check your connection.', 'حدث خطأ. تحقق من اتصالك بالإنترنت.')
                : context.t('Could not change the password.', 'تعذّر تغيير كلمة المرور.');
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String label, {bool secret = false}) => InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: secret ? IconButton(icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)) : null,
        );
    return Scaffold(
      appBar: AppBar(title: Text(context.t('Forgot your password?', 'نسيت كلمة المرور؟'))),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          if (_step == _Step.done) ...[
            const Icon(Icons.check_circle_outline, size: 48, color: Color(0xFF1B7F3B)),
            const SizedBox(height: 12),
            Text(context.t('Your password was changed. Sign in with it now.', 'تم تغيير كلمة المرور. ادخل بها الآن.'), key: const Key('forgot-done'), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(key: const Key('forgot-back'), onPressed: () => Navigator.of(context).pop(), child: Text(context.t('Back to sign in', 'العودة لتسجيل الدخول'))),
          ] else ...[
            Text(_sent
                ? context.t('Request sent. When Hatly operations give you a temporary password, type it here with your new password.',
                    'تم إرسال الطلب. عندما يعطيك فريق التشغيل كلمة مرور مؤقتة، اكتبها هنا مع كلمة مرورك الجديدة.')
                : context.t('Send a request to Hatly operations. They will call you to confirm it is you and give you a temporary password (valid 60 minutes).',
                    'أرسل طلبًا لفريق تشغيل هاتلي. سيتصلون بك للتأكد أنك أنت ويعطونك كلمة مرور مؤقتة (صالحة 60 دقيقة).'),
                key: const Key('forgot-explain')),
            const SizedBox(height: 16),
            TextField(key: const Key('forgot-phone'), controller: _phone, keyboardType: TextInputType.phone, decoration: deco(context.t('Your phone number', 'رقم هاتفك'))),
            const SizedBox(height: 12),
            if (_step == _Step.ask) ...[
              FilledButton(key: const Key('forgot-send'), onPressed: _busy ? null : _ask, child: Text(context.t('Send request', 'إرسال الطلب'))),
              TextButton(
                key: const Key('forgot-have-temp'),
                onPressed: () => setState(() {
                  _error = null;
                  _step = _Step.enter;
                }),
                child: Text(context.t('I already have a temporary password', 'لدي كلمة مرور مؤقتة')),
              ),
            ] else ...[
              TextField(key: const Key('forgot-temp'), controller: _temp, decoration: deco(context.t('Temporary password', 'كلمة المرور المؤقتة'))),
              const SizedBox(height: 12),
              TextField(key: const Key('forgot-new'), controller: _next, obscureText: !_show, decoration: deco(context.t('New password (8+ characters)', 'كلمة المرور الجديدة (8 أحرف أو أكثر)'), secret: true)),
              const SizedBox(height: 12),
              TextField(key: const Key('forgot-confirm'), controller: _confirm, obscureText: !_show, decoration: deco(context.t('Repeat the new password', 'أعد كتابة كلمة المرور الجديدة'), secret: true)),
              const SizedBox(height: 12),
              FilledButton(key: const Key('forgot-complete'), onPressed: _busy ? null : _complete, child: Text(context.t('Change password', 'تغيير كلمة المرور'))),
            ],
            if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, key: const Key('forgot-error'), style: const TextStyle(color: Colors.red))),
            TextButton(key: const Key('forgot-cancel'), onPressed: () => Navigator.of(context).pop(), child: Text(context.t('Cancel — I remember my password', 'إلغاء — أتذكر كلمة المرور'))),
          ],
        ]),
      ),
    );
  }
}
