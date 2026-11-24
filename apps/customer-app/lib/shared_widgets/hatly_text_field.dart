import 'package:flutter/material.dart';

/// UI/UX-0 Design System. Thin wrapper over Flutter's `TextField` —
/// the real styling (radius/border/focus/error colors) already lives
/// centrally in `HatlyTheme.light()`'s `inputDecorationTheme`, so this
/// widget's only job is to offer the two documented variants
/// (normal/search) without every screen re-specifying decoration.
class HatlyTextField extends StatefulWidget {
  const HatlyTextField({
    super.key,
    this.controller,
    this.hintText,
    this.errorText,
    this.enabled = true,
    this.isSearch = false,
    this.obscureText = false,
    this.passwordVisibility = false,
    this.keyboardType,
    this.maxLines = 1,
    this.onChanged,
  });

  final TextEditingController? controller;
  final String? hintText;
  final String? errorText;
  final bool enabled;
  final bool isSearch;
  final bool obscureText;
  final bool passwordVisibility;
  final TextInputType? keyboardType;
  final int maxLines;
  final ValueChanged<String>? onChanged;

  @override
  State<HatlyTextField> createState() => _HatlyTextFieldState();
}

class _HatlyTextFieldState extends State<HatlyTextField> {
  bool _visible = false;
  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final isSearch = widget.isSearch;
    return TextField(
      controller: widget.controller,
      enabled: widget.enabled,
      obscureText: widget.passwordVisibility ? !_visible : widget.obscureText,
      enableSuggestions: !widget.passwordVisibility,
      autocorrect: !widget.passwordVisibility,
      keyboardType: widget.keyboardType,
      maxLines: widget.maxLines,
      onChanged: widget.onChanged,
      style: isSearch ? const TextStyle(fontSize: 13) : null,
      decoration: InputDecoration(
        hintText: widget.hintText,
        errorText: widget.errorText,
        suffixIcon: widget.passwordVisibility ? IconButton(
          tooltip: _visible ? (ar ? 'إخفاء كلمة المرور' : 'Hide password') : (ar ? 'إظهار كلمة المرور' : 'Show password'),
          icon: Icon(_visible ? Icons.visibility_off_outlined : Icons.visibility_outlined),
          onPressed: () => setState(() => _visible = !_visible),
        ) : null,
        prefixIcon: isSearch ? const Icon(Icons.search, size: 18) : null,
        prefixIconConstraints: isSearch ? const BoxConstraints(minWidth: 36, minHeight: 36) : null,
        isDense: isSearch ? true : null,
        hintStyle: isSearch ? const TextStyle(fontSize: 12) : null,
        contentPadding: isSearch ? const EdgeInsets.symmetric(vertical: 8, horizontal: 10) : null,
        border: isSearch
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none)
            : null,
        focusedBorder: isSearch ? OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: BorderSide.none) : null,
        enabledBorder: isSearch
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none)
            : null,
      ),
    );
  }
}
