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
      'Change the password you sign in with.';

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
  String get passwordTooShort => 'Your password must be at least 8 characters';

  @override
  String get passwordConfirmLabel => 'Confirm password';

  @override
  String get passwordMismatch => 'The two passwords don\'t match';

  @override
  String get errorInvalidCredentials =>
      'The phone number or password is incorrect';

  @override
  String get errorRegistrationUnavailable =>
      'We couldn\'t complete your registration. If you already have an account, log in.';

  @override
  String get errorTooManyFailedLogins =>
      'Too many failed login attempts. Please try again shortly';

  @override
  String get errorInvalidInput => 'Please check what you entered and try again';

  @override
  String get errorPhoneVerificationUnavailable =>
      'Phone verification isn\'t available right now';

  @override
  String get profileCurrentPasswordLabel => 'Current password';

  @override
  String get errorCurrentPasswordRequired =>
      'Enter your current password to change it';

  @override
  String get errorCurrentPasswordInvalid => 'The current password is incorrect';

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
  String get customRequestSheetTitle => 'Request an item that isn\'t listed';

  @override
  String get customRequestSheetSubtitle =>
      'Describe what you need and/or add a photo. It\'s added to your cart and sent to the store with your order. The store confirms the item and sets its price — you\'ll see the final amount once it does.';

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
  String get navExplore => 'Stores';

  @override
  String get homeSearchHint => 'What are you looking for?';

  @override
  String get homeSectionCategories => 'Shop by category';

  @override
  String get homeSectionPopularNearYou => 'Popular near you';

  @override
  String get homeSectionOffers => 'Offers';

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
  String get checkoutElectronicMethodHeading => 'Electronic payment method';

  @override
  String get checkoutElectronicMethodUnavailable =>
      'This payment method is not available right now — choose another one';

  @override
  String get checkoutCannotConfirmYet =>
      'We couldn\'t confirm the order yet. Check your choices and try again';

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
  String get checkoutBlockerGpsUnavailable =>
      'Delivery to a GPS location isn\'t available right now. Choose an address with a delivery area, or add one.';

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
      'We couldn\'t find that address. Address search isn\'t always available — you can type your address in the details above and save it without a map location, or use your current location.';

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
  String get addressZonesEmpty =>
      'No delivery areas are available yet, so an address can\'t be saved right now. Please try again later.';

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
  String get addressZoneAutoSelected =>
      'This is the only delivery area in this city, so it\'s selected for you.';

  @override
  String get addressCityNoZones =>
      'No delivery areas are available in this city right now.';

  @override
  String get guestSignInTitle => 'Sign in to continue';

  @override
  String get guestSignInBody =>
      'Create an account or sign in to use your cart, orders and profile.';

  @override
  String get guestSignInAction => 'Sign in or register';

  @override
  String get guestBrowseAction => 'Browse without an account';

  @override
  String get weightEntryTitle => 'Enter the weight';

  @override
  String get weightEntryHint => 'e.g. 1.5';

  @override
  String get weightEntryConfirm => 'Set weight';

  @override
  String get weightEntryTooltip => 'Type a weight';

  @override
  String weightEntryInvalid(String min, String max) {
    return 'Enter a weight between $min and $max';
  }

  @override
  String weightGramsShort(int grams) {
    return '$grams g';
  }

  @override
  String weightKgShort(String kg) {
    return '$kg kg';
  }

  @override
  String get addressPickerHint => 'Choose a saved address';

  @override
  String get addressPickerNoPin => 'No map location — add one in My Addresses';

  @override
  String get addressPickerNeedsPin =>
      'That address has no map location, so it can\'t be used here. Add a pin to it first.';

  @override
  String hatlyServiceRouteBuy(String place) {
    return 'Hatly buys from $place and delivers to your delivery address';
  }

  @override
  String hatlyServiceRouteDeliver(String place) {
    return 'Hatly picks up from your delivery address and delivers to $place';
  }

  @override
  String get hatlyServiceRoutePlaceUnset => 'the place you choose';

  @override
  String get hatlyServiceDeliveryOnly => 'Delivery fee only';

  @override
  String get homeSectionMostOrdered => 'Most ordered';

  @override
  String get homeSectionNew => 'New';

  @override
  String get homeSeeAllOffersTitle => 'Offers';

  @override
  String get homeSeeAllEmpty => 'Nothing here yet';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get notificationsEmptyTitle => 'No notifications yet';

  @override
  String get notificationsEmptyBody =>
      'We\'ll tell you here about every update on your orders.';

  @override
  String get notificationsLoadError => 'Couldn\'t load your notifications';

  @override
  String get notificationsMarkAllRead => 'Mark all as read';

  @override
  String get notificationsBellLabel => 'Notifications';

  @override
  String notificationsBellLabelUnread(int count) {
    return 'Notifications, $count unread';
  }

  @override
  String get notificationsUnread => 'Unread';

  @override
  String get notificationOrderPlacedTitle => 'Order received';

  @override
  String notificationOrderPlacedBody(String orderNumber) {
    return 'We received your order $orderNumber.';
  }

  @override
  String get notificationOrderConfirmedTitle => 'Order confirmed';

  @override
  String notificationOrderConfirmedBody(String orderNumber) {
    return 'Your order $orderNumber has been confirmed.';
  }

  @override
  String get notificationOrderPreparingTitle => 'Preparing your order';

  @override
  String notificationOrderPreparingBody(String orderNumber) {
    return 'Your order $orderNumber is being prepared.';
  }

  @override
  String get notificationOrderReadyForPickupTitle => 'Ready for pickup';

  @override
  String notificationOrderReadyForPickupBody(String orderNumber) {
    return 'Your order $orderNumber is ready to collect from the branch.';
  }

  @override
  String get notificationOrderOnTheWayTitle => 'Your order is on the way';

  @override
  String notificationOrderOnTheWayBody(String orderNumber) {
    return 'Order $orderNumber is on its way to you.';
  }

  @override
  String get notificationOrderDeliveredTitle => 'Order delivered';

  @override
  String notificationOrderDeliveredBody(String orderNumber) {
    return 'Your order $orderNumber has been delivered.';
  }

  @override
  String get notificationOrderCollectedTitle => 'Order collected';

  @override
  String notificationOrderCollectedBody(String orderNumber) {
    return 'You collected your order $orderNumber.';
  }

  @override
  String get notificationOrderCancelledTitle => 'Order cancelled';

  @override
  String notificationOrderCancelledBody(String orderNumber) {
    return 'Your order $orderNumber has been cancelled.';
  }

  @override
  String get notificationOrderFailedDeliveryTitle => 'Delivery failed';

  @override
  String notificationOrderFailedDeliveryBody(String orderNumber) {
    return 'We couldn\'t deliver your order $orderNumber.';
  }

  @override
  String get customRequestEntryHint =>
      'Describe the item or add a photo — the store will check it and set its price.';

  @override
  String get customRequestAdded =>
      'Added to your cart — the store will confirm the item and set its price.';

  @override
  String get cartErrorCustomRequestsUnavailable =>
      'This store doesn\'t take custom requests.';

  @override
  String optionChooseBetween(int min, int max) {
    return 'Choose $min to $max';
  }

  @override
  String optionChooseAtLeast(int min) {
    return 'Choose at least $min';
  }

  @override
  String optionChooseUpTo(int max) {
    return 'Choose up to $max';
  }

  @override
  String optionMinError(int min) {
    return 'Choose at least $min';
  }

  @override
  String optionMaxReached(int max) {
    return 'You can choose up to $max';
  }

  @override
  String get cartErrorOptionLimit =>
      'One of the options is outside what this item allows — review your choices.';

  @override
  String get deleteAccountAction => 'Delete my account';

  @override
  String get deleteAccountTitle => 'Delete your account permanently';

  @override
  String get deleteAccountExplanation =>
      'Your personal data will be deleted: name, phone number, saved addresses, notifications, favorites and cart. Finished order and payment records stay, with nothing that identifies you, because vendors, drivers and Hatly need them for accounting. You will lose your Hatly points. This cannot be undone.';

  @override
  String get deleteAccountRequirements =>
      'An account can\'t be deleted while an order is in progress or the Hatly wallet has a balance.';

  @override
  String get deleteAccountPasswordHint => 'Enter your password to confirm';

  @override
  String get deleteAccountConfirm => 'Delete account';

  @override
  String get deleteAccountCancel => 'Cancel';

  @override
  String get deleteAccountPasswordRequired =>
      'Enter your password to confirm the deletion';

  @override
  String get deleteAccountErrorPassword => 'The password is incorrect';

  @override
  String get deleteAccountErrorActiveOrders =>
      'You have an order in progress. You can delete your account after it is finished.';

  @override
  String get deleteAccountErrorWalletBalance =>
      'Your Hatly wallet is not empty. Please contact Hatly support to settle it before deleting your account.';

  @override
  String get deleteAccountErrorGeneric =>
      'Couldn\'t delete the account. Please try again.';

  @override
  String get homeNoStoresTitle => 'No stores are available yet';

  @override
  String get homeNoStoresBody =>
      'Stores and categories will appear here as soon as they open in your area. Please check again soon.';

  @override
  String get phoneEgyptOnly =>
      'Hatly currently accepts Egyptian mobile numbers only (+20).';

  @override
  String get addressMapLocationSaved => 'Map location saved';

  @override
  String get addressTextOnly => 'Address text only — no map location';

  @override
  String get addressMethodTitle => 'How do you want to add your address?';

  @override
  String get addressMethodSubtitle =>
      'Choose ONE method — you never need both.';

  @override
  String get addressMethodGpsTitle => 'Use my current location (GPS)';

  @override
  String get addressMethodGpsHint =>
      'We read your location and price delivery by the road distance. No area to choose and no address to type.';

  @override
  String get addressMethodManualTitle => 'Enter my address manually';

  @override
  String get addressMethodManualHint =>
      'Choose your area and write your address. Delivery uses your area\'s fixed fee. We never ask for your location.';

  @override
  String get addressMethodGpsUnavailable =>
      'Delivery by GPS location isn\'t available right now. Please enter your address manually.';

  @override
  String get addressChangeMethod => 'Change address method';

  @override
  String get addressChangeMethodTitle => 'Change address method?';

  @override
  String get addressChangeMethodDiscardsGps =>
      'The detected location will be discarded.';

  @override
  String get addressChangeMethodDiscardsManual =>
      'The selected area and the address you typed will be discarded.';

  @override
  String get addressChangeMethodConfirm => 'Change method';

  @override
  String get addressGpsJourneyTitle => 'Your location';

  @override
  String get addressGpsHelp =>
      'Tap the button to share your current location. You don\'t need to choose an area or type an address.';

  @override
  String get addressGpsDetected => 'Location detected';

  @override
  String get addressGpsFeeNote =>
      'The delivery fee is calculated at checkout from the road distance. Any amount shown before then is only an estimate.';

  @override
  String get addressGpsNeedLocation => 'Share your location first to continue.';

  @override
  String get addressGpsOutsideCoverage =>
      'Hatly doesn\'t deliver to this location yet.';

  @override
  String get addressGpsInvalidLocation =>
      'We couldn\'t use this location. Please try again.';

  @override
  String get addressGpsSaved => 'GPS location';

  @override
  String get addressManualJourneyTitle => 'Manual address';

  @override
  String get addressGpsJourneyBadge => 'GPS method';

  @override
  String get addressManualJourneyBadge => 'Manual method';

  @override
  String get addressMethodsLoading => 'Loading address methods…';

  @override
  String get routeSectionTitle => 'Request route';

  @override
  String get routeFromLabel => 'From';

  @override
  String get routeToLabel => 'To';

  @override
  String get routeBadgeDefault => 'Default';

  @override
  String get routeBadgeChosen => 'Your choice';

  @override
  String get routeChange => 'Change';

  @override
  String get routeChoose => 'Choose';

  @override
  String get routeNotSet => 'Not set yet';

  @override
  String get routeDefaultMissingHint =>
      'There is no default point right now — please choose one.';

  @override
  String get routeOriginRequiredHint =>
      'Choose where the pick-up should happen.';

  @override
  String get routeSheetTitleOrigin => 'Choose the starting point';

  @override
  String get routeSheetTitleDestination => 'Choose the destination';

  @override
  String get routeSheetPointSection =>
      'Your current location or a point on the map';

  @override
  String get routeSheetSavedSection => 'From my saved addresses';

  @override
  String get routeNameThisPlace => 'Name this place (optional)';

  @override
  String get routeNameThisPlaceHint => 'e.g. Mom\'s house';

  @override
  String get routeUseDefault => 'Use the default point';

  @override
  String get routeConfirmPoint => 'Confirm this point';

  @override
  String get routeCurrentLocationLabel => 'My current location';

  @override
  String get routeSelectedPointLabel => 'Selected point';

  @override
  String get routeDirectionNote =>
      'Direction: from the first point to the second.';

  @override
  String get routeOrderSectionTitle => 'Request route';

  @override
  String get cartErrorAdHocOriginRequired =>
      'Please choose where to pick up from before adding this request to your cart.';

  @override
  String get checkoutBlockerAdHocOriginRequired =>
      'This Wasally request has no pick-up point. Choose one and add it again.';

  @override
  String get checkoutBlockerHatlyDefaultPickupMissing =>
      'Hatly\'s default starting point isn\'t set up yet. Please choose a starting point for your request.';

  @override
  String get checkoutBlockerHatlyDefaultDestinationMissing =>
      'Hatly\'s default destination isn\'t set up yet. Please choose a destination for your request.';

  @override
  String get checkoutBlockerWasallyDefaultDestinationMissing =>
      'Wasally\'s default destination isn\'t set up yet. Please choose a destination for your request.';

  @override
  String get orderPartCancelledTitle => 'Part of your order was cancelled';

  @override
  String orderPartCancelledBody(int rejected, int total) {
    return '$rejected of $total vendors could not prepare their part. The rest of your order continues.';
  }

  @override
  String get orderPartCancelledNoCharge =>
      'You will not be charged for the cancelled part.';

  @override
  String orderRejectionReasonLine(String reason) {
    return 'Reason: $reason';
  }

  @override
  String orderRefundWalletLine(String amount) {
    return '$amount was returned to your wallet.';
  }

  @override
  String orderRefundTransferPendingLine(String amount) {
    return '$amount will be sent back to you by Hatly. We will mark it as sent once it is.';
  }

  @override
  String orderRefundTransferSentLine(String amount) {
    return '$amount was sent back to you.';
  }

  @override
  String orderRefundReviewLine(String amount) {
    return '$amount will be settled once your payment has been reviewed.';
  }

  @override
  String get notificationOrderPartCancelledTitle =>
      'Part of your order was cancelled';

  @override
  String notificationOrderPartCancelledBody(String orderNumber) {
    return 'A vendor could not prepare their part of order $orderNumber. The rest of your order continues.';
  }

  @override
  String get itemUnavailableTitle => 'Some items are unavailable';

  @override
  String get itemUnavailableBody =>
      'These items can\'t be prepared. Choose how to continue — nothing changes until you decide.';

  @override
  String get itemUnavailableContinue => 'Continue without them';

  @override
  String get itemUnavailableCancel => 'Cancel the whole order';

  @override
  String get itemUnavailableCancelConfirmTitle => 'Cancel the whole order?';

  @override
  String get itemUnavailableCancelConfirmBody =>
      'We will pass your request to our team to cancel this order. Money you paid in advance is returned under our usual rules.';

  @override
  String get itemUnavailableCancelConfirmAction => 'Yes, cancel the order';

  @override
  String get itemUnavailableKeepOrder => 'Keep my order';

  @override
  String get itemUnavailableCancelRequested =>
      'We received your request to cancel. Our team will process it and contact you if needed.';

  @override
  String get itemUnavailableTeamContact =>
      'Our team will contact you about this order.';

  @override
  String get itemUnavailableDone =>
      'Done — your order continues without these items.';

  @override
  String get itemUnavailableError =>
      'Couldn\'t send your answer. Please try again.';

  @override
  String get orderRemovedItemsTitle => 'Removed from your order';

  @override
  String get notificationItemUnavailableTitle =>
      'An item in your order is unavailable';

  @override
  String notificationItemUnavailableBody(String orderNumber) {
    return 'Open order $orderNumber to continue without the item or cancel the order.';
  }

  @override
  String get cartCompatTitle => 'This item can\'t be added right now';

  @override
  String get cartCompatMultiVendorDisabled =>
      'Ordering from more than one vendor is not available right now. Finish your current order or empty the cart to order from another vendor.';

  @override
  String get cartCompatBranchPickupDisabled =>
      'This vendor does not offer pickup.';

  @override
  String get cartCompatSwitchToDelivery => 'Switch to delivery and add';

  @override
  String get cartCompatStartNewCart => 'Empty the cart and add this';

  @override
  String get cartCompatKeepCart => 'Keep my cart';

  @override
  String get cartCompatOk => 'OK';

  @override
  String get addressOpenLocationSettings => 'Open location settings';

  @override
  String get weightInlineLabel => 'Or type the weight in kilograms';

  @override
  String weightEstimateNote(String price) {
    return 'Estimated: $price — the final price is set by the actual weight when your order is prepared.';
  }

  @override
  String get homeDeliverTo => 'Deliver to';

  @override
  String get profileSettings => 'Settings';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get languageArabic => 'العربية';

  @override
  String get languageEnglish => 'English';

  @override
  String get settingsPasswordSection => 'Password & security';

  @override
  String get settingsAccountSection => 'Account';

  @override
  String get settingsAppSection => 'App';

  @override
  String get searchFilterVendors => 'Stores only';

  @override
  String get searchFilterProducts => 'Products only';
}
