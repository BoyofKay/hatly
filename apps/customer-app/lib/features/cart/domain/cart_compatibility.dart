/// The server's answer to "would this product fit in my cart?" (`POST /cart/items/check`). The app never decides this itself: the backend
/// applies the very rules `POST /cart/items` and checkout enforce and also says what the customer can do about it.
class CartCompatibility {
  const CartCompatibility({
    required this.compatible,
    this.code,
    this.message,
    this.resolution,
    this.alreadyInCart = false,
  });

  final bool compatible;
  final String? code;
  final String? message;

  /// `SWITCH_TO_DELIVERY` (pickup is what blocks it) or `START_NEW_CART` (the cart's contents block it); null = nothing the customer can do.
  final String? resolution;
  final bool alreadyInCart;

  factory CartCompatibility.fromJson(Map<String, dynamic> json) => CartCompatibility(
        compatible: json['compatible'] == true,
        code: json['code'] as String?,
        message: json['message'] as String?,
        resolution: json['resolution'] as String?,
        alreadyInCart: json['alreadyInCart'] == true,
      );
}
