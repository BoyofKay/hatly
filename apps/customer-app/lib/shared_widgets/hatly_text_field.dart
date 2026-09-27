import 'package:flutter/material.dart';

/// UI/UX-0 Design System. Thin wrapper over Flutter's `TextField` —
/// the real styling (radius/border/focus/error colors) already lives
/// centrally in `HatlyTheme.light()`'s `inputDecorationTheme`, so this
/// widget's only job is to offer the two documented variants
/// (normal/search) without every screen re-specifying decoration.
class HatlyTextField extends StatelessWidget {
  const HatlyTextField({
    super.key,
    this.controller,
    this.hintText,
    this.errorText,
    this.enabled = true,
    this.isSearch = false,
    this.obscureText = false,
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
  final TextInputType? keyboardType;
  final int maxLines;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      obscureText: obscureText,
      keyboardType: keyboardType,
      maxLines: maxLines,
      onChanged: onChanged,
      decoration: InputDecoration(
        hintText: hintText,
        errorText: errorText,
        prefixIcon: isSearch ? const Icon(Icons.search) : null,
        border: isSearch
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none)
            : null,
        enabledBorder: isSearch
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none)
            : null,
      ),
    );
  }
}
