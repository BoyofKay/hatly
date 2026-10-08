// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Hatly';

  @override
  String get home => 'Home';

  @override
  String get search => 'Search';

  @override
  String get cart => 'Cart';

  @override
  String get orders => 'Orders';

  @override
  String get favorites => 'Favorites';

  @override
  String get favoritesAddAction => 'Add to favorites';

  @override
  String get favoritesRemoveAction => 'Remove from favorites';

  @override
  String get favoritesEmptyState => 'No favorite vendors yet';

  @override
  String get favoritesEmptyStateSubtitle =>
      'Tap the heart on a vendor to save it here';

  @override
  String get profile => 'Profile';

  @override
  String get vendorsNearYou => 'Vendors near you';

  @override
  String get addToCart => 'Add to cart';

  @override
  String get checkout => 'Checkout';

  @override
  String get placeOrder => 'Place order';

  @override
  String get orderTracking => 'Order tracking';

  @override
  String get deliveryFee => 'Delivery fee';

  @override
  String get retry => 'Retry';

  @override
  String get somethingWentWrong => 'Something went wrong';

  @override
  String get routeNotFoundTitle => 'Page not found';

  @override
  String get logout => 'Log out';

  @override
  String get authWelcomeTitle => 'Welcome to Hatly';

  @override
  String get authWelcomeSubtitle => 'Enter your phone number to continue';

  @override
  String get fullNameLabel => 'Full name';

  @override
  String get fullNameHint => 'e.g. Ahmed Mohamed';

  @override
  String get phoneNumberLabel => 'Phone number';

  @override
  String get continueButton => 'Continue';

  @override
  String get passwordLabel => 'Password';

  @override
  String get passwordHint => 'At least 8 characters';

  @override
  String get passwordRequired => 'Please enter your password';

  @override
  String get passwordCreateAccountInstead =>
      'New here? Create an account instead';

  @override
  String get passwordHaveAccountInstead =>
      'Already have a password? Log in instead';

  @override
  String get verifyPhonePromptTitle => 'Verify your phone number';

  @override
  String get verifyPhonePromptSubtitle =>
      'Get extra account security by confirming your number.';

  @override
  String get verifyPhonePromptAction => 'Verify';

  @override
  String get verifyPhonePromptDismiss => 'Not now';

  @override
  String get verifyPhoneSuccess => 'Phone verified.';

  @override
  String get passwordSetupSectionTitle => 'Password';

  @override
  String get passwordSetupSectionSubtitle =>
      'Set a password so you can also sign in without a text message code.';

  @override
  String get passwordSetupSaveButton => 'Save password';

  @override
  String get passwordSetupSuccess => 'Password saved.';

  @override
  String get phoneInvalid => 'That phone number doesn\'t look right';

  @override
  String get fullNameRequired => 'Please enter your full name';

  @override
  String get otpTitle => 'Enter verification code';

  @override
  String otpSubtitleWithPhone(String phone) {
    return 'A 6-digit code was sent to $phone';
  }

  @override
  String get otpVerifyButton => 'Verify';

  @override
  String otpResendIn(int seconds) {
    return 'Resend in ${seconds}s';
  }

  @override
  String get otpResendAction => 'Resend code';

  @override
  String get otpChangeNumber => 'Change phone number';

  @override
  String get errorNetwork => 'No connection. Check your network and try again';

  @override
  String get errorInvalidOtp => 'That code isn\'t valid';

  @override
  String get errorInvalidOrExpiredOtp => 'That code is invalid or has expired';

  @override
  String get errorTooManyAttempts =>
      'Too many attempts. Please try again shortly';

  @override
  String get errorSmsProviderUnavailable =>
      'We couldn\'t send the verification code right now. Please try again shortly';

  @override
  String get homeComingSoon => 'Coming soon: browsing vendors and products';

  @override
  String get searchComingSoon => 'Coming soon: search';

  @override
  String get ordersComingSoon => 'Coming soon: your orders';

  @override
  String get favoritesComingSoon => 'Coming soon: your favorites';

  @override
  String get profileComingSoon => 'Profile';

  @override
  String get greetingGeneric => 'Welcome 👋';

  @override
  String greetingWithName(String name) {
    return 'Hello, $name 👋';
  }

  @override
  String get selectAddressCta => 'Select delivery address';

  @override
  String get selectAddressTitle => 'Choose an address';

  @override
  String get addressHome => 'Home';

  @override
  String get addressWork => 'Work';

  @override
  String get searchHint => 'Search vendors or products';

  @override
  String get searchComingSoonSubtitle => 'Search is still being built';

  @override
  String get categoryRestaurants => 'Restaurants';

  @override
  String get categoryGroceries => 'Groceries';

  @override
  String get categoryPharmacy => 'Pharmacy';

  @override
  String get categoryBakery => 'Bakery';

  @override
  String get categoryDrinks => 'Drinks';

  @override
  String get categoryDesserts => 'Desserts';

  @override
  String get categoryFastFood => 'Fast Food';

  @override
  String get seeAll => 'See all';

  @override
  String cartSummaryItemCount(int count) {
    return '$count items';
  }

  @override
  String get cartSummaryViewCart => 'View Cart';

  @override
  String get vendorClosed => 'Closed';

  @override
  String get vendorOpenNow => 'Open now';

  @override
  String get minutesAbbreviation => 'min';

  @override
  String get noVendorsFound => 'No vendors found';

  @override
  String get noVendorsFoundSubtitle =>
      'Try another category or check back later';

  @override
  String get vendorDetailsComingSoon => 'Vendor details — coming soon';

  @override
  String get promotionBadge => 'Special offer';

  @override
  String get allProducts => 'All';

  @override
  String get noProductsFound => 'No products in this section';

  @override
  String get searchSectionVendors => 'Vendors';

  @override
  String get searchSectionProducts => 'Products';

  @override
  String get searchPromptMinLength => 'Type at least 2 characters to search';

  @override
  String searchNoResultsForQuery(String query) {
    return 'No results for \"$query\"';
  }

  @override
  String get ratingRateAction => 'Rate';

  @override
  String get ratingYourRatingLabel => 'Your rating';

  @override
  String get ratingCommentHint => 'Add a comment (optional)';

  @override
  String get ratingSubmitButton => 'Submit rating';

  @override
  String get ratingSubmittedSuccess => 'Rating submitted';

  @override
  String get ratingSelectStarsPrompt => 'Select a rating';

  @override
  String get flashSaleBadge => 'Flash Sale';

  @override
  String get cartSubtotalDiscountBanner =>
      'A discount applies to eligible items from this vendor';

  @override
  String get subtotalDiscountAvailable => 'Discount available';

  @override
  String get checkoutErrorFlashSaleLimit =>
      'This Flash Sale quantity is no longer available. Please review your cart and try again.';

  @override
  String checkoutErrorFlashSaleLimitWithRemaining(String remaining) {
    return 'Only $remaining left at the Flash Sale price. Please adjust the quantity and try again.';
  }

  @override
  String get checkoutErrorInsufficientInventory =>
      'One or more items in your cart no longer have enough stock.';

  @override
  String get checkoutErrorOfferConflict =>
      'This offer is no longer available. Please review your cart and try again.';

  @override
  String orderHistoricalDiscountApplied(String amount) {
    return 'Discount applied: $amount';
  }

  @override
  String orderHistoricalFlashSalePrice(String price) {
    return 'Flash Sale price: $price';
  }

  @override
  String get customRequestEntryPoint => 'Can\'t find what you\'re looking for?';

  @override
  String get customRequestSheetTitle => 'Request a custom item';

  @override
  String get customRequestSheetSubtitle =>
      'Describe what you need and/or add a photo — we\'ll pass it on to the vendor.';

  @override
  String get customRequestTextHint => 'e.g. Panadol Extra 500mg, any brand';

  @override
  String customRequestImageLimitHint(int max) {
    return 'Up to $max images';
  }

  @override
  String get customRequestSubmit => 'Add to cart';

  @override
  String get customRequestAddImage => 'Add photo';

  @override
  String get customRequestRemoveImage => 'Remove photo';

  @override
  String get cartCustomRequestBadge => 'Custom Request';

  @override
  String get cartCustomRequestPricePending => 'Price will be confirmed';

  @override
  String get productOptionsTitle => 'Options';

  @override
  String get productUnavailable => 'Currently unavailable';

  @override
  String get optionRequiredBadge => 'required';

  @override
  String get quantityLabel => 'Quantity';

  @override
  String addToCartWithPrice(String price) {
    return 'Add to cart — $price';
  }

  @override
  String get addedToCartConfirmation => 'Added to cart';

  @override
  String get cancel => 'Cancel';

  @override
  String get cartEmpty => 'Your cart is empty';

  @override
  String get cartSubtotal => 'Subtotal';

  @override
  String get cartNotReadyForCheckout =>
      'Checkout is not ready yet. Please complete the pending items before placing your order.';

  @override
  String get cartItemNoLongerAvailable => 'No longer available';

  @override
  String get cartBranchConflictTitle => 'You have items from another vendor';

  @override
  String get cartBranchConflictMessage =>
      'Your cart has items from a different vendor. Clear your cart to add items from this one.';

  @override
  String get cartBranchConflictClearAndAdd => 'Clear & add';

  @override
  String get cartErrorProductUnavailable =>
      'This product is currently unavailable';

  @override
  String get cartErrorBranchUnavailable =>
      'This vendor is currently unavailable';

  @override
  String get cartErrorOptionRequired => 'Please select all required options';

  @override
  String get cartErrorInvalidOption =>
      'One of the selected options isn\'t valid';

  @override
  String get noOrdersYet => 'You haven\'t placed any orders yet';

  @override
  String orderVendorSummaryWithOthers(String vendorName, int othersCount) {
    return '$vendorName + $othersCount others';
  }

  @override
  String get orderDetailsTitle => 'Order details';

  @override
  String get orderItemsTitle => 'Items';

  @override
  String get orderPaymentTitle => 'Payment';

  @override
  String get orderDriverTitle => 'Delivery driver';

  @override
  String get orderTotalLabel => 'Total';

  @override
  String get orderDiscountLabel => 'Discount';

  @override
  String get orderCancellationReasonLabel => 'Cancellation reason';

  @override
  String get orderFailureReasonLabel => 'Delivery failed';

  @override
  String get orderRequestedWeightLabel => 'Requested';

  @override
  String get orderActualWeightLabel => 'Actual weight';

  @override
  String get orderStatusPending => 'Order placed';

  @override
  String get orderStatusConfirmed => 'Confirmed';

  @override
  String get orderStatusPreparing => 'Preparing';

  @override
  String get orderStatusReadyForPickup => 'Ready for pickup';

  @override
  String get orderStatusAssignedToDriver => 'Driver assigned';

  @override
  String get orderStatusPickedUp => 'Picked up';

  @override
  String get orderStatusOnTheWay => 'On the way';

  @override
  String get orderStatusDelivered => 'Delivered';

  @override
  String get orderStatusCollected => 'Collected';

  @override
  String get orderStatusCancelled => 'Cancelled';

  @override
  String get orderStatusFailedDelivery => 'Delivery failed';

  @override
  String get sortLabel => 'Sort';

  @override
  String get sortNewest => 'Newest';

  @override
  String get sortHighestRated => 'Highest Rated';

  @override
  String get sortBestSelling => 'Best Selling';

  @override
  String get sortPriceLowToHigh => 'Price: Low to High';

  @override
  String get sortPriceHighToLow => 'Price: High to Low';

  @override
  String get sortOffers => 'Offers';

  @override
  String get filterAction => 'Filter';

  @override
  String get sortAction => 'Sort';

  @override
  String get clearAll => 'Clear All';

  @override
  String get apply => 'Apply';

  @override
  String get filterOpenNow => 'Open Now';

  @override
  String get filterHasOffers => 'Offers';

  @override
  String get filterRatingLabel => 'Rating';

  @override
  String get filterRatingAny => 'Any';

  @override
  String get filterRating4Plus => '4.0+';

  @override
  String get filterRating3Plus => '3.0+';

  @override
  String get filterAvailableOnly => 'Available Only';

  @override
  String get filterPriceRangeLabel => 'Price Range';

  @override
  String get filterPriceMinHint => 'Min';

  @override
  String get filterPriceMaxHint => 'Max';

  @override
  String get checkoutTitle => 'Checkout';

  @override
  String get checkoutAddressLabel => 'Delivery address';

  @override
  String get checkoutAddressLine1Hint => 'Street, building, floor...';

  @override
  String get checkoutAddressLatitudeHint => 'Latitude';

  @override
  String get checkoutAddressLongitudeHint => 'Longitude';

  @override
  String get checkoutAddressInstructionsHint =>
      'Delivery instructions (optional)';

  @override
  String get checkoutPaymentMethodLabel => 'Payment method';

  @override
  String get checkoutPaymentCod => 'Cash on Delivery';

  @override
  String get checkoutPaymentPayAtDelivery => 'Pay Electronically at Delivery';

  @override
  String get checkoutPaymentInstapay => 'InstaPay';

  @override
  String get checkoutPaymentWallet => 'Wallet Transfer';

  @override
  String get checkoutSubtotalLabel => 'Subtotal';

  @override
  String get checkoutPlaceOrderButton => 'Place Order';

  @override
  String get checkoutOrderPlacedTitle => 'Order placed';

  @override
  String get transferInstructionsTitle => 'Complete your payment';

  @override
  String get transferDestinationLabel => 'Send payment to';

  @override
  String get transferAmountLabel => 'Amount to send';

  @override
  String get transferSendProofButton => 'Send payment proof via WhatsApp';

  @override
  String get transferAwaitingVerification =>
      'Your payment is awaiting verification. We\'ll update your order once it\'s confirmed.';

  @override
  String get transferNotAvailable =>
      'This payment method isn\'t available right now — please choose another.';

  @override
  String get checkoutSelectAddressCta => 'Select delivery address';

  @override
  String get checkoutSelectAddressError => 'Please select a delivery address';

  @override
  String get checkoutCartChangedError =>
      'Your cart has changed — please review it before continuing';

  @override
  String get addressSelectTitle => 'Select address';

  @override
  String get addressAddNew => 'Add new address';

  @override
  String get addressNoneSavedYet => 'No saved addresses yet';

  @override
  String get addressDeleteConfirmTitle => 'Delete address?';

  @override
  String get addressDeleteConfirmMessage =>
      'This address will be removed from your saved addresses.';

  @override
  String get addressDeleteAction => 'Delete';

  @override
  String get addressDeleteError =>
      'Failed to delete address. Please try again.';

  @override
  String get addAddressTitle => 'Add address';

  @override
  String get editAddressTitle => 'Edit address';

  @override
  String get addressLabelHint => 'Label (e.g. Home, Work)';

  @override
  String get addressUseCurrentLocation => 'Use my current location';

  @override
  String get addressLocationCaptured => 'Location captured';

  @override
  String get addressMissingLocationError =>
      'Please enter the address and use current location';

  @override
  String get addressSaveButton => 'Save address';

  @override
  String get navExplore => 'Explore';

  @override
  String get homeSearchHint => 'What are you looking for?';

  @override
  String get homeSectionCategories => 'Shop by category';

  @override
  String get homeSectionPopularNearYou => 'Popular near you';

  @override
  String get homeSectionOffers => 'Offers';

  @override
  String get homeSectionPopularNew => 'Popular & new';

  @override
  String get homeFavoritesShortcut => 'Favorites';

  @override
  String get homePromoCarouselLabel => 'Featured promotions';

  @override
  String homePromoPageIndicator(int current, int total) {
    return 'Promotion $current of $total';
  }

  @override
  String get promoCtaProduct => 'Add to cart';

  @override
  String get promoCtaVendor => 'Shop now';

  @override
  String get promoCtaOffer => 'Discover the offer';

  @override
  String get promoCtaFreeDelivery => 'Order now';

  @override
  String get promoCtaBundle => 'See the bundle';

  @override
  String get badgeOffer => 'Offer';

  @override
  String get badgeFlashSale => 'Flash sale';

  @override
  String get badgeFreeDelivery => 'Free delivery';

  @override
  String get badgeBundle => 'Bundle';

  @override
  String get badgeNew => 'New';

  @override
  String get badgePopular => 'Popular';

  @override
  String get badgeUnavailable => 'Unavailable';

  @override
  String vendorEtaMinutes(String range) {
    return '$range min';
  }

  @override
  String vendorRatingSemantics(String rating) {
    return 'Rating $rating';
  }

  @override
  String get homeDemoContentNotice => 'Demo content';

  @override
  String get exploreSearchHint => 'Search products, vendors or categories';

  @override
  String get exploreSearchClear => 'Clear search';

  @override
  String get exploreSearchCategories => 'Categories';

  @override
  String get exploreSectionFeaturedCategories => 'Featured Categories';

  @override
  String get exploreSectionFeaturedVendors => 'Featured Vendors';

  @override
  String get exploreSectionNew => 'New on Hatly';

  @override
  String get exploreLoadFailed => 'Couldn\'t load Explore';

  @override
  String get exploreSeeLess => 'Show less';

  @override
  String get categoryProductsSearchHint => 'Search products';

  @override
  String get categoryProductsEmptySubtitle =>
      'Try another search or check back later';

  @override
  String catalogStartsFrom(String price) {
    return 'From $price';
  }

  @override
  String catalogStoreCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count stores',
      one: '1 store',
    );
    return '$_temp0';
  }

  @override
  String catalogAvailableFromStores(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count stores',
      one: '1 store',
    );
    return 'Available from $_temp0';
  }

  @override
  String get catalogChooseStore => 'Choose';

  @override
  String get catalogChangeStore => 'Change store';

  @override
  String get descriptionReadMore => 'Show more';

  @override
  String get descriptionReadLess => 'Show less';

  @override
  String get productAddToCart => 'Add to cart';

  @override
  String get productTotalLabel => 'Total';

  @override
  String get optionRequiredError => 'Choose at least one option';

  @override
  String cartMiniFromVendor(String vendor) {
    return 'From $vendor';
  }

  @override
  String get cartMiniContinue => 'Continue shopping';

  @override
  String cartMiniSummary(String items, String total) {
    return 'Cart: $items · $total';
  }

  @override
  String get quantityDecrease => 'Decrease quantity';

  @override
  String get quantityIncrease => 'Increase quantity';

  @override
  String get cartErrorMaxVendors =>
      'You have reached the maximum number of stores in one cart';

  @override
  String get cartErrorPickupSingleVendor =>
      'Pickup is available for a single store only. Switch to delivery to add another store.';

  @override
  String get cartErrorMixedCartTypes =>
      'Store items and Hatly Service requests can\'t share a cart. Clear your cart to switch.';

  @override
  String get cartEmptyTitle => 'Your cart is waiting for your order';

  @override
  String get cartEmptyCta => 'Explore products';

  @override
  String get cartRemoveItem => 'Remove item';

  @override
  String get cartEditItem => 'Edit';

  @override
  String get cartEditHint =>
      'To change a product\'s options: tap Edit, choose the options and add it again, then remove the old line.';

  @override
  String cartSectionExpand(String vendor) {
    return 'Show $vendor items';
  }

  @override
  String cartSectionCollapse(String vendor) {
    return 'Hide $vendor items';
  }

  @override
  String get cartItemUpdating => 'Updating';

  @override
  String get cartContinueToCheckout => 'Continue to complete your order';

  @override
  String get supportContactAction => 'Contact Hatly';

  @override
  String get supportContactActionSubtitle => 'We reply on WhatsApp';

  @override
  String get supportContactOrderAction => 'Contact Hatly about this order';

  @override
  String get supportContactUnavailable =>
      'Contacting Hatly is currently unavailable';

  @override
  String get supportContactLaunchFailed =>
      'Couldn\'t open WhatsApp. Please try again.';

  @override
  String get supportMessageGeneral => 'Hi Hatly, I need some help.';

  @override
  String supportMessageOrder(String orderId) {
    return 'Hi Hatly, I need help with order $orderId.';
  }

  @override
  String get paymentMethodInstapay => 'InstaPay';

  @override
  String get paymentMethodVodafoneCash => 'Vodafone Cash';

  @override
  String get paymentMethodOrangeCash => 'Orange Cash';

  @override
  String get paymentMethodEtisalatCash => 'Etisalat Cash';

  @override
  String get paymentMethodWePay => 'WE Pay';

  @override
  String get paymentCodLabel => 'Cash on delivery';

  @override
  String get paymentPayAtDeliveryLabel => 'Pay electronically on delivery';

  @override
  String paymentPayAtDeliveryWith(String method) {
    return 'Pay on delivery via $method';
  }

  @override
  String get paymentManualTransferLabel => 'Manual transfer in advance';

  @override
  String paymentManualTransferWith(String method) {
    return 'Advance transfer via $method';
  }

  @override
  String get paymentWalletLabel => 'Hatly wallet';

  @override
  String etaAboutMinutes(int minutes) {
    return 'About $minutes min';
  }

  @override
  String etaRangeMinutes(int min, int max) {
    return '$min–$max min';
  }

  @override
  String get etaUnavailable => 'Estimated time is not available right now';

  @override
  String get etaUnavailablePreparation =>
      'The store hasn\'t set a preparation time yet, so there is no estimate';

  @override
  String etaDeliveryAt(String time) {
    return 'Expected delivery around $time';
  }

  @override
  String etaDeliveryBetween(String from, String until) {
    return 'Expected delivery between $from and $until';
  }

  @override
  String etaReadyAt(String time) {
    return 'Ready for pickup around $time';
  }

  @override
  String etaReadyBetween(String from, String until) {
    return 'Ready for pickup between $from and $until';
  }

  @override
  String get etaDelayed => 'Your order is running a little behind the estimate';

  @override
  String get checkoutFulfillmentTitle => 'How do you want it?';

  @override
  String get checkoutFulfillmentDelivery => 'Delivery';

  @override
  String get checkoutFulfillmentPickup => 'Pickup';

  @override
  String get checkoutPickupSingleVendorOnly =>
      'Pickup is only available for an order from a single store';

  @override
  String get checkoutPickupBranchDisabled => 'This store does not offer pickup';

  @override
  String get checkoutPickupUnavailable =>
      'Pickup is not available for this order';

  @override
  String get checkoutPickupFrom => 'Pick up from';

  @override
  String get checkoutPickupEstimate => 'Ready in';

  @override
  String get checkoutPickupNoDeliveryFee => 'No delivery fee';

  @override
  String get checkoutChangeAddress => 'Change';

  @override
  String get checkoutDefaultAddress => 'Default';

  @override
  String get checkoutAddressOutOfServiceArea =>
      'Hatly doesn\'t deliver to this address yet. Choose another address.';

  @override
  String get checkoutAddressVendorDoesNotDeliver =>
      'One of the stores in your cart does not offer delivery. You can choose pickup or change your cart.';

  @override
  String get checkoutAddressVendorOutsideArea =>
      'One of the stores in your cart does not deliver to this address. Choose another address or change your cart.';

  @override
  String get checkoutDeliveryEstimate => 'Delivery';

  @override
  String get checkoutDeliveryFeePending => 'Set once you choose an address';

  @override
  String get checkoutBreakdownBase => 'Base delivery fee';

  @override
  String checkoutBreakdownAdditionalVendors(int count) {
    return 'Additional stores ($count)';
  }

  @override
  String get checkoutBreakdownDistance => 'Distance';

  @override
  String checkoutDistanceKm(String km) {
    return '$km km';
  }

  @override
  String get checkoutVendorPreparation => 'Preparation time per store';

  @override
  String checkoutPreparationMinutes(int minutes) {
    return 'About $minutes min';
  }

  @override
  String get checkoutPreparationUnknown => 'Not set';

  @override
  String get checkoutPaymentManualTransfer =>
      'Manual transfer (pay in advance)';

  @override
  String get checkoutPaymentManualTransferHint =>
      'Your order isn\'t prepared until the transfer is approved';

  @override
  String get checkoutPaymentPayAtDeliveryHint =>
      'You pay the driver on arrival by an electronic method';

  @override
  String get checkoutChooseElectronicMethod =>
      'Choose the electronic payment method';

  @override
  String get checkoutNoElectronicMethods =>
      'No electronic payment methods are available right now';

  @override
  String get checkoutTransferUnavailable =>
      'Manual transfer is not available right now';

  @override
  String get checkoutPickupCashNote =>
      'Pickup orders are paid in cash at the branch when you collect them.';

  @override
  String get checkoutTransferUnavailableWeighed =>
      'Not available for orders with weighed items — the final price is known after weighing';

  @override
  String get checkoutTransferUnavailableUnpriced =>
      'Not available because the order\'s price isn\'t set yet';

  @override
  String get checkoutPaidFullyByWallet =>
      'This order will be paid entirely from your Hatly wallet';

  @override
  String get checkoutWalletTitle => 'Wallet';

  @override
  String get checkoutWalletUse => 'Use Hatly wallet balance';

  @override
  String checkoutWalletBalance(String amount) {
    return 'Your balance: $amount';
  }

  @override
  String get checkoutWalletApplied => 'Paid from wallet';

  @override
  String get checkoutAmountDue => 'Amount due';

  @override
  String get checkoutWalletAmountLabel => 'Amount from wallet (optional)';

  @override
  String get checkoutWalletAmountHelp =>
      'Leave empty to use as much as possible';

  @override
  String get checkoutWalletEmpty => 'Your wallet balance is zero';

  @override
  String get checkoutWalletUnavailableForOrder =>
      'The wallet can\'t be used for this order because its final price isn\'t known yet';

  @override
  String get checkoutCouponTitle => 'Have a coupon code?';

  @override
  String get checkoutCouponHint => 'Enter coupon code';

  @override
  String get checkoutCouponApply => 'Apply';

  @override
  String get checkoutCouponRemove => 'Remove';

  @override
  String checkoutCouponSaves(String amount) {
    return 'You save $amount';
  }

  @override
  String checkoutCouponForVendor(String vendor) {
    return 'at $vendor';
  }

  @override
  String get checkoutCouponNotFound => 'This coupon code is not valid';

  @override
  String get checkoutCouponExpired => 'This coupon has expired';

  @override
  String get checkoutCouponNotStarted => 'This coupon is not active yet';

  @override
  String get checkoutCouponMinimumNotMet =>
      'Your order doesn\'t reach the minimum for this coupon';

  @override
  String get checkoutCouponNotApplicable =>
      'This coupon doesn\'t apply to the items in your cart';

  @override
  String get checkoutCouponConflictsWithOffer =>
      'This coupon cannot be combined with an offer already applied at that store';

  @override
  String get checkoutCouponLimitReached =>
      'This coupon has reached its usage limit';

  @override
  String get checkoutCouponRejected => 'This coupon cannot be used';

  @override
  String get checkoutOrderSummary => 'Order summary';

  @override
  String get checkoutTotalPending => 'To be confirmed';

  @override
  String get checkoutConfirmAndPay => 'Confirm order and continue to payment';

  @override
  String get checkoutStaleChanged =>
      'The price or delivery details changed. Review the updated summary, then confirm again.';

  @override
  String get checkoutStaleExpired =>
      'The previous quote expired. Review the updated summary, then confirm again.';

  @override
  String get checkoutErrorWalletInsufficient =>
      'Your wallet balance doesn\'t cover this order';

  @override
  String get checkoutBlockerGeneric =>
      'This order can\'t be placed right now. Review your cart and try again.';

  @override
  String get checkoutBlockerAdHocPickupRequired =>
      'This Hatly Service request has no pickup location. Remove it from your cart and add it again with the place\'s location.';

  @override
  String get checkoutBlockerAdHocDestinationRequired =>
      'This Hatly Service request has no destination. Remove it from your cart and add it again with the destination.';

  @override
  String get checkoutBlockerUnavailable =>
      'An item or store in your cart is unavailable right now';

  @override
  String get checkoutBlockerMultiVendorDisabled =>
      'Ordering from several stores at once is not available right now';

  @override
  String get checkoutBlockerFeeUnavailable =>
      'Couldn\'t calculate the delivery fee. Please try again shortly.';

  @override
  String get checkoutBlockerInvalidAddress =>
      'The address location is not valid. Choose another location.';

  @override
  String get checkoutOrderPlacedButLoadFailed =>
      'Your order was placed, but we couldn\'t load its details right now';

  @override
  String get checkoutSuccessTitle => 'Order placed';

  @override
  String get checkoutSuccessAwaitingTitle =>
      'Order created — payment awaiting review';

  @override
  String get checkoutSuccessSendProof => 'Send transfer proof';

  @override
  String get checkoutSuccessBackHome => 'Back to home';

  @override
  String get orderNumberLabel => 'Order number';

  @override
  String get orderVendorsLabel => 'Stores';

  @override
  String get orderTrackAction => 'Track order';

  @override
  String get orderDetailsAction => 'Order details';

  @override
  String get orderPaymentAwaitingReview =>
      'Your payment is awaiting review. Preparation starts once the transfer is approved.';

  @override
  String get orderPaymentAwaitingReviewShort => 'Payment awaiting review';

  @override
  String get orderTimelineTitle => 'Order progress';

  @override
  String get orderPricingTitle => 'Price summary';

  @override
  String get orderDeliveryBreakdownTitle => 'Delivery fee details';

  @override
  String get orderPaymentMethodLabel => 'Payment method';

  @override
  String get orderPaymentStatusLabel => 'Payment status';

  @override
  String get orderPaymentStatusPending => 'Waiting for your transfer proof';

  @override
  String get orderPaymentStatusUnderReview => 'Under review';

  @override
  String get orderPaymentStatusPaid => 'Paid';

  @override
  String get orderPaymentStatusRejected => 'Transfer rejected';

  @override
  String get orderPaymentStatusDueOnDelivery => 'Due on delivery';

  @override
  String get orderDeliveryAddressTitle => 'Delivery address';

  @override
  String orderCouponLine(String code, String amount) {
    return 'Coupon $code: you saved $amount';
  }

  @override
  String orderVendorReadyAt(String time) {
    return 'Ready around $time';
  }

  @override
  String orderVendorPreparationMinutes(int minutes) {
    return 'Preparation about $minutes min';
  }

  @override
  String get orderCancelAction => 'Cancel order';

  @override
  String get orderCancelConfirmTitle => 'Cancel the whole order?';

  @override
  String get orderCancelConfirmMessage =>
      'The order will be cancelled at every store. Anything paid from your wallet goes back to it.';

  @override
  String get orderCancelReasonHint => 'Reason (optional)';

  @override
  String get orderCancelKeep => 'Keep order';

  @override
  String get orderCancelConfirmAction => 'Yes, cancel';

  @override
  String get orderCancelDone => 'Order cancelled';

  @override
  String get orderCancelNotAllowed =>
      'You can\'t cancel this order any more — a store has started preparing it';

  @override
  String get orderCancelFailed =>
      'Couldn\'t cancel the order. Please try again.';

  @override
  String get ordersTabActive => 'Ongoing';

  @override
  String get ordersTabCompleted => 'Completed';

  @override
  String get ordersTabCancelled => 'Cancelled';

  @override
  String get ordersEmptyActive => 'No ongoing orders';

  @override
  String get ordersEmptyCompleted => 'No completed orders yet';

  @override
  String get ordersEmptyCancelled => 'No cancelled orders';

  @override
  String get addressLocationSection => 'Location on the map';

  @override
  String get addressDetailsSection => 'Address details';

  @override
  String get addressMapUnavailable =>
      'The map is not enabled in this build. Set your location with GPS or search for your address.';

  @override
  String get addressConfirmPin => 'Confirm this location';

  @override
  String get addressSearchLabel => 'Search for your address';

  @override
  String get addressSearchAction => 'Search';

  @override
  String get addressSearchNoResult =>
      'We couldn\'t find that address. Try different words or use your current location.';

  @override
  String get addressLocationUnavailable =>
      'Couldn\'t get your location. Turn on location services, allow access, and try again.';

  @override
  String get addressSuggestionLabel => 'Suggested address for this location';

  @override
  String get addressUseSuggestion => 'Use';

  @override
  String get addressLine1Label => 'Address (street and area)';

  @override
  String get addressLine1Required => 'Enter the delivery address';

  @override
  String get addressGovernorateLabel => 'Governorate';

  @override
  String get addressCityLabel => 'City';

  @override
  String get addressBuildingLabel => 'Building';

  @override
  String get addressFloorLabel => 'Floor';

  @override
  String get addressApartmentLabel => 'Apartment';

  @override
  String get addressLandmarkLabel => 'Landmark';

  @override
  String get addressLabelHome => 'Home';

  @override
  String get addressLabelWork => 'Work';

  @override
  String get addressMakeDefault => 'Make this my default address';

  @override
  String get checkoutSuccessAppBar => 'Order confirmation';

  @override
  String get checkoutAmountDueByTransfer => 'Remainder to pay by transfer';

  @override
  String get addressLocationServicesDisabled =>
      'Location services are turned off on this device. Turn them on in your device settings and try again.';

  @override
  String get addressLocationPermissionDenied =>
      'Hatly wasn\'t allowed to access your location. Try again, or enter your address manually.';

  @override
  String get addressLocationPermissionPermanentlyDenied =>
      'Location permission is permanently denied. Enable it from this app’s settings on your device.';

  @override
  String get addressLocationPositionUnavailable =>
      'Couldn\'t determine your current location. Try again, or enter your address manually.';

  @override
  String get addressOpenSettings => 'Open app settings';

  @override
  String get hatlyServiceEntryTitle => 'Hatly Service';

  @override
  String get hatlyServiceEntrySubtitle =>
      'Need something from a place we don\'t list? Ask Hatly to get it.';

  @override
  String get hatlyServiceScreenTitle => 'Hatly Service';

  @override
  String get hatlyServiceTypeSectionTitle => 'What do you need?';

  @override
  String get hatlyServiceTypeBuyFromPlace => 'Buy from a place';

  @override
  String get hatlyServiceTypeBuyFromPlaceHint =>
      'Tell us what to get and where from — we\'ll buy and bring it to you.';

  @override
  String get hatlyServiceTypeDeliverToPlace => 'Deliver to a place';

  @override
  String get hatlyServiceTypeDeliverToPlaceHint =>
      'Tell us what to deliver and where to — we\'ll pick it up and drop it off.';

  @override
  String get hatlyServiceExistingGroupNotice =>
      'You already have a Hatly Service request in your cart. This item will be added to it.';

  @override
  String get hatlyServicePlaceNameLabel => 'Name this request';

  @override
  String get hatlyServicePlaceNameHint =>
      'e.g. Carrefour Mall of Egypt, or Mom\'s house';

  @override
  String get hatlyServicePlaceNameRequired => 'Give this request a short name';

  @override
  String get hatlyServiceDescriptionLabel => 'Describe what you need';

  @override
  String get hatlyServiceDescriptionHint =>
      'Be as specific as you can — item, brand, quantity, anything that helps.';

  @override
  String get hatlyServiceDescriptionRequired => 'Describe what you need';

  @override
  String get hatlyServiceImagesLabel => 'Photos (optional)';

  @override
  String get hatlyServiceLocationPickupTitle => 'Pickup location (required)';

  @override
  String get hatlyServiceLocationDestinationTitle =>
      'Destination location (required)';

  @override
  String get hatlyServiceLocationDestinationHint =>
      'Choose exactly where this should be delivered — Hatly can\'t guess this for you.';

  @override
  String get hatlyServiceLocationPickupHint =>
      'Choose exactly where Hatly should buy this from — Hatly can\'t guess this for you.';

  @override
  String get hatlyServiceReviewTitle => 'Review your request';

  @override
  String get hatlyServiceReviewEdit => 'Edit';

  @override
  String get hatlyServiceReviewTypeLabel => 'Service';

  @override
  String get hatlyServiceReviewPlaceLabel => 'Request name';

  @override
  String get hatlyServiceReviewDescriptionLabel => 'Details';

  @override
  String get hatlyServiceReviewImagesLabel => 'Photos';

  @override
  String get hatlyServiceReviewLocationLabel => 'Location';

  @override
  String get hatlyServiceReviewLocationSet =>
      'Set — will be used for this request';

  @override
  String get hatlyServiceReviewLocationRequired =>
      'Not set — required before this request can be added';

  @override
  String get hatlyServiceContinueToReview => 'Review request';

  @override
  String get hatlyServiceSubmit => 'Add to cart';

  @override
  String get hatlyServiceAddedConfirmation => 'Added to cart';

  @override
  String get orderHatlyServiceTypeLabel => 'Service type';

  @override
  String get orderHatlyServicePickupLocationLabel => 'Pickup location';

  @override
  String get orderHatlyServiceDestinationLocationLabel =>
      'Destination location';

  @override
  String get orderHatlyServiceLocationCoordinates => 'Set on the map';

  @override
  String get cartErrorAdHocPlaceNameRequired =>
      'Give this request a short name.';

  @override
  String get cartErrorAdHocServiceTypeRequired =>
      'Choose a Hatly Service type.';

  @override
  String get cartErrorAdHocLocationMismatch =>
      'That location doesn\'t apply to this service type.';

  @override
  String get cartErrorAdHocIncompleteCoordinate =>
      'Set the location again — it wasn\'t captured correctly.';

  @override
  String get cartErrorAdHocSingleLocationOnly =>
      'A Hatly Service request can only include one location. Clear your cart to start a new one.';

  @override
  String get cartErrorAdHocPickupOnly =>
      'Hatly Service isn\'t available for pickup — switch to delivery first.';

  @override
  String get cartErrorAdHocDestinationRequired =>
      'Please choose a destination for this delivery request before adding it to your cart.';

  @override
  String get cartErrorAdHocPickupRequired =>
      'Please choose the location of the place to buy from before adding this request to your cart.';

  @override
  String get profileMyAddresses => 'My Addresses';

  @override
  String get profileDefaultAddressTitle => 'Default Address';

  @override
  String get profileNoDefaultAddress => 'No default address yet';

  @override
  String get profileManageAddresses => 'Manage';

  @override
  String get profileWalletCardTitle => 'Hatly Wallet';

  @override
  String get walletTitle => 'Wallet';

  @override
  String get walletBalanceLabel => 'Wallet Balance';

  @override
  String get walletHistoryTitle => 'Transaction History';

  @override
  String get walletEmptyHistory => 'No transactions yet';

  @override
  String get walletTypeOrderPayment => 'Order payment';

  @override
  String get walletTypeOrderRefund => 'Order refund';

  @override
  String get walletTypeAdminCredit => 'Credit';

  @override
  String get walletTypeLoyaltyRedemption => 'Points redeemed';

  @override
  String get walletTypeDriverCashRemainder => 'Cash remainder';

  @override
  String get walletTypeAdjustment => 'Adjustment';

  @override
  String get walletTypeExpiration => 'Expired balance';

  @override
  String get profileLoyaltyCardTitle => 'Hatly Points';

  @override
  String get loyaltyTitle => 'Hatly Points';

  @override
  String get loyaltyBalanceLabel => 'Points Balance';

  @override
  String get loyaltyPointsSuffix => 'pts';

  @override
  String get loyaltyHistoryTitle => 'Points History';

  @override
  String get loyaltyEmptyHistory => 'No points activity yet';

  @override
  String get loyaltyTypeEarning => 'Points earned';

  @override
  String get loyaltyTypeEarningReversed => 'Points reversed (refund)';

  @override
  String get loyaltyTypeRedemption => 'Converted to Wallet';

  @override
  String get loyaltyTypeAdminAdjustment => 'Adjustment';

  @override
  String get loyaltyTypeExpiration => 'Expired points';

  @override
  String get loyaltyConvertAction => 'Convert to Wallet';

  @override
  String get loyaltyConvertSheetTitle => 'Convert Points to Wallet';

  @override
  String get loyaltyConvertSheetRule =>
      'Every 500 points = 5 EGP. Convert in multiples of 100 points, 500 minimum.';

  @override
  String get loyaltyConvertAvailableLabel => 'Available';

  @override
  String get loyaltyConvertAmountLabel => 'Points to convert';

  @override
  String get loyaltyConvertAmountHint => 'e.g. 500';

  @override
  String get loyaltyConvertSubmit => 'Convert';

  @override
  String get loyaltyConvertSuccess => 'Converted to your Hatly Wallet';

  @override
  String get loyaltyErrorInsufficientPoints =>
      'You don\'t have enough points for this conversion.';

  @override
  String get loyaltyErrorBelowMinimum => 'Enter at least 500 points.';

  @override
  String get loyaltyErrorInvalidMultiple =>
      'Enter an amount in multiples of 100 points.';

  @override
  String get addressSetDefaultAction => 'Set as default';

  @override
  String get addressSetDefaultError =>
      'Failed to set as default. Please try again.';

  @override
  String get profileAppearanceTitle => 'Appearance';

  @override
  String get themeModeSystem => 'System';

  @override
  String get themeModeLight => 'Light';

  @override
  String get themeModeDark => 'Dark';

  @override
  String get hatlyServicePricePending =>
      'The price will be confirmed while your order is being prepared';

  @override
  String get checkoutHatlyServiceCodNote =>
      'Hatly Service requests are paid on delivery only. The price is confirmed while your order is being prepared, and the final total appears in the order details.';

  @override
  String get cartErrorTooManyImages =>
      'There are more photos than allowed for this request.';

  @override
  String get cartErrorInvalidImage =>
      'One of the photos could not be used. Upload it again and retry.';

  @override
  String get cartErrorContentRequired =>
      'Describe the request or attach a photo.';

  @override
  String get serviceTemporarilyUnavailable =>
      'This service is not available right now. Please try again later or contact Hatly.';

  @override
  String get checkoutErrorAddressRequired =>
      'Choose a delivery address first, then try again.';

  @override
  String get checkoutErrorEmptyCart =>
      'Your cart is empty. Add a request and try again.';

  @override
  String get checkoutErrorNoActiveCart =>
      'There is no active cart to place. Your order may already have been sent — check your orders.';

  @override
  String get checkoutErrorQuoteRequired =>
      'Review the order summary, then confirm the order again.';

  @override
  String get checkoutErrorPaymentMethodRequired => 'Choose a payment method.';

  @override
  String get checkoutErrorOnlinePaymentUnavailable =>
      'Online payment is not available yet.';

  @override
  String get addressZoneSection => 'Delivery area';

  @override
  String get addressZoneLabel => 'Area';

  @override
  String get addressZoneHelp =>
      'The area you choose decides whether we can deliver there and the delivery fee.';

  @override
  String get addressZoneRequired => 'Choose your area';

  @override
  String addressZoneFeeHint(String fee) {
    return 'Delivery fee for this area: $fee — the final fee is confirmed at checkout.';
  }

  @override
  String get addressZonesLoadError =>
      'Couldn\'t load the delivery areas. Please try again.';

  @override
  String get addressZonesEmpty => 'No delivery areas are available right now.';

  @override
  String get addressDetailedLabel => 'Detailed address';

  @override
  String get addressDetailedHint =>
      'e.g. Abu Naseeb St., next to Al-Kurdi Mosque, house 15';

  @override
  String get addressLocationOptionalSection => 'Map location (optional)';

  @override
  String get addressLocationOptionalHelp =>
      'A pin helps the driver find you faster, but it isn\'t required to save the address.';

  @override
  String get addressRemoveLocation => 'Remove pin';

  @override
  String get addressZoneMissingBanner =>
      'Choose a delivery area for this address before ordering to it.';

  @override
  String get addressZoneUnavailableBanner =>
      'This address\'s delivery area isn\'t available right now. Choose another area.';

  @override
  String get addressChooseZoneAction => 'Choose area';

  @override
  String get checkoutAddressZoneRequired =>
      'Choose a delivery area for this address so we can deliver to you.';

  @override
  String get checkoutAddressZoneUnavailable =>
      'Hatly doesn\'t deliver to this area right now. Choose another area or address.';

  @override
  String checkoutDeliveryZonePricing(String area) {
    return 'Delivery fee by area: $area';
  }

  @override
  String checkoutHatlyServiceFeeFormula(String zoneFee, String multiplier) {
    return 'Your area\'s delivery fee $zoneFee × $multiplier';
  }

  @override
  String get addressZoneAutoSelected =>
      'This is the only delivery area in this city, so it\'s selected for you.';

  @override
  String get addressCityNoZones =>
      'No delivery areas are available in this city right now.';
}
