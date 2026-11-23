// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'هاتلي';

  @override
  String get home => 'الرئيسية';

  @override
  String get search => 'بحث';

  @override
  String get cart => 'السلة';

  @override
  String get orders => 'الطلبات';

  @override
  String get favorites => 'المفضلة';

  @override
  String get favoritesAddAction => 'إضافة إلى المفضلة';

  @override
  String get favoritesRemoveAction => 'إزالة من المفضلة';

  @override
  String get favoritesEmptyState => 'لا توجد متاجر مفضلة بعد';

  @override
  String get favoritesEmptyStateSubtitle =>
      'اضغط على القلب في أي متجر لحفظه هنا';

  @override
  String get profile => 'حسابي';

  @override
  String get vendorsNearYou => 'متاجر بالقرب منك';

  @override
  String get addToCart => 'أضف إلى السلة';

  @override
  String get checkout => 'إتمام الطلب';

  @override
  String get placeOrder => 'تأكيد الطلب';

  @override
  String get orderTracking => 'تتبع الطلب';

  @override
  String get deliveryFee => 'رسوم التوصيل';

  @override
  String get retry => 'إعادة المحاولة';

  @override
  String get somethingWentWrong => 'حدث خطأ ما';

  @override
  String get routeNotFoundTitle => 'الصفحة غير موجودة';

  @override
  String get logout => 'تسجيل الخروج';

  @override
  String get authWelcomeTitle => 'مرحبًا بك في هاتلي';

  @override
  String get authWelcomeSubtitle => 'أدخل رقم هاتفك للمتابعة';

  @override
  String get fullNameLabel => 'الاسم الكامل';

  @override
  String get fullNameHint => 'مثال: أحمد محمد';

  @override
  String get phoneNumberLabel => 'رقم الهاتف';

  @override
  String get continueButton => 'متابعة';

  @override
  String get passwordLabel => 'كلمة المرور';

  @override
  String get passwordHint => '8 أحرف على الأقل';

  @override
  String get passwordRequired => 'يرجى إدخال كلمة المرور';

  @override
  String get passwordCreateAccountInstead =>
      'جديد هنا؟ أنشئ حسابًا بدلاً من ذلك';

  @override
  String get passwordHaveAccountInstead =>
      'هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك';

  @override
  String get verifyPhonePromptTitle => 'تحقق من رقم هاتفك';

  @override
  String get verifyPhonePromptSubtitle =>
      'احصل على أمان إضافي لحسابك بتأكيد رقمك.';

  @override
  String get verifyPhonePromptAction => 'تحقق';

  @override
  String get verifyPhonePromptDismiss => 'ليس الآن';

  @override
  String get verifyPhoneSuccess => 'تم التحقق من الهاتف.';

  @override
  String get passwordSetupSectionTitle => 'كلمة المرور';

  @override
  String get passwordSetupSectionSubtitle =>
      'غيّر كلمة المرور التي تسجّل بها الدخول.';

  @override
  String get passwordSetupSaveButton => 'حفظ كلمة المرور';

  @override
  String get passwordSetupSuccess => 'تم حفظ كلمة المرور.';

  @override
  String get phoneInvalid => 'رقم الهاتف غير صحيح';

  @override
  String get fullNameRequired => 'يرجى إدخال الاسم الكامل';

  @override
  String get otpTitle => 'أدخل رمز التحقق';

  @override
  String otpSubtitleWithPhone(String phone) {
    return 'تم إرسال رمز مكون من 6 أرقام إلى $phone';
  }

  @override
  String get otpVerifyButton => 'تأكيد';

  @override
  String otpResendIn(int seconds) {
    return 'إعادة الإرسال خلال $seconds ثانية';
  }

  @override
  String get otpResendAction => 'إعادة إرسال الرمز';

  @override
  String get otpChangeNumber => 'تغيير رقم الهاتف';

  @override
  String get errorNetwork =>
      'لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى';

  @override
  String get errorInvalidOtp => 'رمز التحقق غير صحيح';

  @override
  String get errorInvalidOrExpiredOtp => 'الرمز غير صحيح أو منتهي الصلاحية';

  @override
  String get errorTooManyAttempts =>
      'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل';

  @override
  String get errorSmsProviderUnavailable =>
      'تعذر إرسال رمز التحقق حاليًا. برجاء المحاولة لاحقًا';

  @override
  String get passwordTooShort => 'كلمة المرور يجب ألا تقل عن 8 أحرف';

  @override
  String get passwordConfirmLabel => 'تأكيد كلمة المرور';

  @override
  String get passwordMismatch => 'كلمتا المرور غير متطابقتين';

  @override
  String get errorInvalidCredentials => 'رقم الهاتف أو كلمة المرور غير صحيحة';

  @override
  String get errorRegistrationUnavailable =>
      'تعذر إكمال التسجيل. إذا كان لديك حساب بالفعل فسجّل الدخول.';

  @override
  String get errorTooManyFailedLogins =>
      'محاولات تسجيل دخول فاشلة كثيرة. حاول مرة أخرى بعد قليل';

  @override
  String get errorInvalidInput => 'تحقق من البيانات المدخلة وحاول مرة أخرى';

  @override
  String get errorPhoneVerificationUnavailable =>
      'التحقق من الهاتف غير متاح حاليًا';

  @override
  String get profileCurrentPasswordLabel => 'كلمة المرور الحالية';

  @override
  String get errorCurrentPasswordRequired =>
      'أدخل كلمة المرور الحالية لتغييرها';

  @override
  String get errorCurrentPasswordInvalid => 'كلمة المرور الحالية غير صحيحة';

  @override
  String get homeComingSoon => 'قريبًا: تصفح المتاجر والمنتجات';

  @override
  String get searchComingSoon => 'قريبًا: البحث';

  @override
  String get ordersComingSoon => 'قريبًا: طلباتك';

  @override
  String get favoritesComingSoon => 'قريبًا: المفضلة لديك';

  @override
  String get profileComingSoon => 'الملف الشخصي';

  @override
  String get greetingGeneric => 'أهلًا بك 👋';

  @override
  String greetingWithName(String name) {
    return 'أهلًا، $name 👋';
  }

  @override
  String get selectAddressCta => 'اختر عنوان التوصيل';

  @override
  String get selectAddressTitle => 'اختر عنوانًا';

  @override
  String get addressHome => 'المنزل';

  @override
  String get addressWork => 'العمل';

  @override
  String get searchHint => 'ابحث عن متاجر أو منتجات';

  @override
  String get searchComingSoonSubtitle => 'ميزة البحث قيد التطوير';

  @override
  String get categoryRestaurants => 'مطاعم';

  @override
  String get categoryGroceries => 'بقالة';

  @override
  String get categoryPharmacy => 'صيدلية';

  @override
  String get categoryBakery => 'مخبوزات';

  @override
  String get categoryDrinks => 'مشروبات';

  @override
  String get categoryDesserts => 'حلويات';

  @override
  String get categoryFastFood => 'وجبات سريعة';

  @override
  String get seeAll => 'عرض الكل';

  @override
  String cartSummaryItemCount(int count) {
    return '$count عنصر';
  }

  @override
  String get cartSummaryViewCart => 'عرض السلة';

  @override
  String get vendorClosed => 'مغلق';

  @override
  String get vendorOpenNow => 'مفتوح الآن';

  @override
  String get minutesAbbreviation => 'د';

  @override
  String get noVendorsFound => 'لا توجد متاجر حاليًا';

  @override
  String get noVendorsFoundSubtitle => 'جرّب فئة أخرى أو عد لاحقًا';

  @override
  String get vendorDetailsComingSoon => 'تفاصيل المتجر — قريبًا';

  @override
  String get promotionBadge => 'عرض خاص';

  @override
  String get allProducts => 'الكل';

  @override
  String get noProductsFound => 'لا توجد منتجات في هذا القسم';

  @override
  String get searchSectionVendors => 'المتاجر';

  @override
  String get searchSectionProducts => 'المنتجات';

  @override
  String get searchPromptMinLength => 'اكتب حرفين على الأقل للبحث';

  @override
  String searchNoResultsForQuery(String query) {
    return 'لا توجد نتائج لـ \"$query\"';
  }

  @override
  String get ratingRateAction => 'قيّم';

  @override
  String get ratingYourRatingLabel => 'تقييمك';

  @override
  String get ratingCommentHint => 'أضف تعليقًا (اختياري)';

  @override
  String get ratingSubmitButton => 'إرسال التقييم';

  @override
  String get ratingSubmittedSuccess => 'تم إرسال التقييم';

  @override
  String get ratingSelectStarsPrompt => 'اختر تقييمًا';

  @override
  String get flashSaleBadge => 'تخفيض سريع';

  @override
  String get cartSubtotalDiscountBanner =>
      'يوجد خصم على المنتجات المؤهلة من هذا المتجر';

  @override
  String get subtotalDiscountAvailable => 'يوجد خصم';

  @override
  String get checkoutErrorFlashSaleLimit =>
      'لم تعد هذه الكمية بسعر التخفيض السريع متاحة. يرجى مراجعة سلتك والمحاولة مرة أخرى.';

  @override
  String checkoutErrorFlashSaleLimitWithRemaining(String remaining) {
    return 'لم يتبق سوى $remaining بسعر التخفيض السريع. يرجى تعديل الكمية والمحاولة مرة أخرى.';
  }

  @override
  String get checkoutErrorInsufficientInventory =>
      'لا تتوفر كمية كافية لمنتج واحد أو أكثر في سلتك.';

  @override
  String get checkoutErrorOfferConflict =>
      'هذا العرض لم يعد متاحًا. يرجى مراجعة سلتك والمحاولة مرة أخرى.';

  @override
  String orderHistoricalDiscountApplied(String amount) {
    return 'تم تطبيق خصم: $amount';
  }

  @override
  String orderHistoricalFlashSalePrice(String price) {
    return 'سعر التخفيض السريع: $price';
  }

  @override
  String get customRequestEntryPoint => 'لم تجد ما تبحث عنه؟';

  @override
  String get customRequestSheetTitle => 'اطلب صنفًا غير موجود في القائمة';

  @override
  String get customRequestSheetSubtitle =>
      'صف ما تحتاجه و/أو أضف صورة. سيُضاف إلى سلتك ويصل إلى المتجر مع طلبك، ويؤكد المتجر توفر الصنف ويحدد سعره، وسيظهر لك المبلغ النهائي بعد ذلك.';

  @override
  String get customRequestTextHint =>
      'مثال: بانادول إكسترا 500 مجم، أي نوع متاح';

  @override
  String customRequestImageLimitHint(int max) {
    return 'حتى $max صور';
  }

  @override
  String get customRequestSubmit => 'أضف إلى السلة';

  @override
  String get customRequestAddImage => 'إضافة صورة';

  @override
  String get customRequestRemoveImage => 'إزالة الصورة';

  @override
  String get cartCustomRequestBadge => 'طلب مخصص';

  @override
  String get cartCustomRequestPricePending => 'سيتم تأكيد السعر';

  @override
  String get productOptionsTitle => 'خيارات المنتج';

  @override
  String get productUnavailable => 'غير متوفر حاليًا';

  @override
  String get optionRequiredBadge => 'مطلوب';

  @override
  String get quantityLabel => 'الكمية';

  @override
  String addToCartWithPrice(String price) {
    return 'أضف إلى السلة — $price';
  }

  @override
  String get addedToCartConfirmation => 'تمت الإضافة إلى السلة';

  @override
  String get cancel => 'إلغاء';

  @override
  String get cartEmpty => 'سلتك فارغة';

  @override
  String get cartSubtotal => 'الإجمالي الفرعي';

  @override
  String get cartNotReadyForCheckout =>
      'الدفع غير جاهز بعد. يرجى إكمال العناصر المعلقة قبل تقديم الطلب.';

  @override
  String get cartItemNoLongerAvailable => 'لم يعد متوفرًا';

  @override
  String get cartBranchConflictTitle => 'لديك عناصر من متجر آخر';

  @override
  String get cartBranchConflictMessage =>
      'سلتك تحتوي على عناصر من متجر آخر. امسح السلة لإضافة عناصر من هذا المتجر.';

  @override
  String get cartBranchConflictClearAndAdd => 'امسح وأضف';

  @override
  String get cartErrorProductUnavailable => 'هذا المنتج غير متوفر حاليًا';

  @override
  String get cartErrorBranchUnavailable => 'هذا المتجر غير متاح حاليًا';

  @override
  String get cartErrorOptionRequired => 'يرجى اختيار كل الخيارات المطلوبة';

  @override
  String get cartErrorInvalidOption => 'أحد الخيارات المحددة غير صالح';

  @override
  String get noOrdersYet => 'لم تقم بأي طلبات بعد';

  @override
  String orderVendorSummaryWithOthers(String vendorName, int othersCount) {
    return '$vendorName + $othersCount آخرين';
  }

  @override
  String get orderDetailsTitle => 'تفاصيل الطلب';

  @override
  String get orderItemsTitle => 'العناصر';

  @override
  String get orderPaymentTitle => 'الدفع';

  @override
  String get orderDriverTitle => 'سائق التوصيل';

  @override
  String get orderTotalLabel => 'الإجمالي';

  @override
  String get orderDiscountLabel => 'الخصم';

  @override
  String get orderCancellationReasonLabel => 'سبب الإلغاء';

  @override
  String get orderFailureReasonLabel => 'فشل التوصيل';

  @override
  String get orderRequestedWeightLabel => 'المطلوب';

  @override
  String get orderActualWeightLabel => 'الوزن الفعلي';

  @override
  String get orderStatusPending => 'تم تقديم الطلب';

  @override
  String get orderStatusConfirmed => 'تم التأكيد';

  @override
  String get orderStatusPreparing => 'جارٍ التحضير';

  @override
  String get orderStatusReadyForPickup => 'جاهز للاستلام';

  @override
  String get orderStatusAssignedToDriver => 'تم تعيين السائق';

  @override
  String get orderStatusPickedUp => 'تم الاستلام';

  @override
  String get orderStatusOnTheWay => 'في الطريق';

  @override
  String get orderStatusDelivered => 'تم التوصيل';

  @override
  String get orderStatusCollected => 'تم الاستلام';

  @override
  String get orderStatusCancelled => 'ملغى';

  @override
  String get orderStatusFailedDelivery => 'فشل التوصيل';

  @override
  String get sortLabel => 'الترتيب';

  @override
  String get sortNewest => 'الأحدث';

  @override
  String get sortHighestRated => 'الأعلى تقييمًا';

  @override
  String get sortBestSelling => 'الأكثر مبيعًا';

  @override
  String get sortPriceLowToHigh => 'السعر: من الأقل إلى الأعلى';

  @override
  String get sortPriceHighToLow => 'السعر: من الأعلى إلى الأقل';

  @override
  String get sortOffers => 'العروض';

  @override
  String get filterAction => 'فلترة';

  @override
  String get sortAction => 'ترتيب';

  @override
  String get clearAll => 'مسح الكل';

  @override
  String get apply => 'تطبيق';

  @override
  String get filterOpenNow => 'مفتوح الآن';

  @override
  String get filterHasOffers => 'عروض';

  @override
  String get filterRatingLabel => 'التقييم';

  @override
  String get filterRatingAny => 'الكل';

  @override
  String get filterRating4Plus => '4.0 فأعلى';

  @override
  String get filterRating3Plus => '3.0 فأعلى';

  @override
  String get filterAvailableOnly => 'متوفر فقط';

  @override
  String get filterPriceRangeLabel => 'نطاق السعر';

  @override
  String get filterPriceMinHint => 'من';

  @override
  String get filterPriceMaxHint => 'إلى';

  @override
  String get checkoutTitle => 'إتمام الطلب';

  @override
  String get checkoutAddressLabel => 'عنوان التوصيل';

  @override
  String get checkoutAddressLine1Hint => 'الشارع، المبنى، الطابق...';

  @override
  String get checkoutAddressLatitudeHint => 'خط العرض';

  @override
  String get checkoutAddressLongitudeHint => 'خط الطول';

  @override
  String get checkoutAddressInstructionsHint => 'تعليمات التوصيل (اختياري)';

  @override
  String get checkoutPaymentMethodLabel => 'طريقة الدفع';

  @override
  String get checkoutPaymentCod => 'الدفع عند الاستلام';

  @override
  String get checkoutPaymentPayAtDelivery => 'الدفع إلكترونيًا عند التوصيل';

  @override
  String get checkoutPaymentInstapay => 'إنستاباي';

  @override
  String get checkoutPaymentWallet => 'تحويل محفظة إلكترونية';

  @override
  String get checkoutSubtotalLabel => 'الإجمالي الفرعي';

  @override
  String get checkoutPlaceOrderButton => 'تأكيد الطلب';

  @override
  String get checkoutOrderPlacedTitle => 'تم تقديم الطلب';

  @override
  String get transferInstructionsTitle => 'أكمل عملية الدفع';

  @override
  String get transferDestinationLabel => 'أرسل المبلغ إلى';

  @override
  String get transferAmountLabel => 'المبلغ المطلوب إرساله';

  @override
  String get transferSendProofButton => 'إرسال إثبات الدفع عبر واتساب';

  @override
  String get transferAwaitingVerification =>
      'طلبك بانتظار التحقق من الدفع. سنقوم بتحديث حالة طلبك فور تأكيده.';

  @override
  String get transferNotAvailable =>
      'طريقة الدفع هذه غير متاحة حاليًا — يرجى اختيار طريقة أخرى.';

  @override
  String get checkoutSelectAddressCta => 'اختر عنوان التوصيل';

  @override
  String get checkoutSelectAddressError => 'يرجى اختيار عنوان للتوصيل';

  @override
  String get checkoutCartChangedError =>
      'لقد تغيرت سلة مشترياتك — يرجى مراجعتها قبل المتابعة';

  @override
  String get addressSelectTitle => 'اختر العنوان';

  @override
  String get addressAddNew => 'إضافة عنوان جديد';

  @override
  String get addressNoneSavedYet => 'لا توجد عناوين محفوظة بعد';

  @override
  String get addressDeleteConfirmTitle => 'حذف العنوان؟';

  @override
  String get addressDeleteConfirmMessage =>
      'سيتم إزالة هذا العنوان من عناوينك المحفوظة.';

  @override
  String get addressDeleteAction => 'حذف';

  @override
  String get addressDeleteError => 'فشل حذف العنوان. يرجى المحاولة مرة أخرى.';

  @override
  String get addAddressTitle => 'إضافة عنوان';

  @override
  String get editAddressTitle => 'تعديل العنوان';

  @override
  String get addressLabelHint => 'الاسم (مثال: المنزل، العمل)';

  @override
  String get addressUseCurrentLocation => 'استخدام موقعي الحالي';

  @override
  String get addressLocationCaptured => 'تم تحديد الموقع';

  @override
  String get addressMissingLocationError =>
      'يرجى إدخال العنوان واستخدام الموقع الحالي';

  @override
  String get addressSaveButton => 'حفظ العنوان';

  @override
  String get navExplore => 'استكشف';

  @override
  String get homeSearchHint => 'بتدور على إيه؟';

  @override
  String get homeSectionCategories => 'تسوّق حسب الفئة';

  @override
  String get homeSectionPopularNearYou => 'الأشهر بالقرب منك';

  @override
  String get homeSectionOffers => 'العروض';

  @override
  String get homeFavoritesShortcut => 'المفضلة';

  @override
  String get homePromoCarouselLabel => 'عروض مميزة';

  @override
  String homePromoPageIndicator(int current, int total) {
    return 'العرض $current من $total';
  }

  @override
  String get promoCtaProduct => 'أضف للسلة';

  @override
  String get promoCtaVendor => 'تسوّق الآن';

  @override
  String get promoCtaOffer => 'اكتشف العرض';

  @override
  String get promoCtaFreeDelivery => 'اطلب الآن';

  @override
  String get promoCtaBundle => 'شوف الباكدج';

  @override
  String get badgeOffer => 'عرض';

  @override
  String get badgeFlashSale => 'عرض سريع';

  @override
  String get badgeFreeDelivery => 'توصيل مجاني';

  @override
  String get badgeBundle => 'باكدج';

  @override
  String get badgeNew => 'جديد';

  @override
  String get badgePopular => 'الأكثر طلبًا';

  @override
  String get badgeUnavailable => 'غير متاح';

  @override
  String vendorEtaMinutes(String range) {
    return '$range د';
  }

  @override
  String vendorRatingSemantics(String rating) {
    return 'التقييم $rating';
  }

  @override
  String get homeDemoContentNotice => 'محتوى تجريبي';

  @override
  String get exploreSearchHint => 'ابحث عن منتجات أو متاجر أو فئات';

  @override
  String get exploreSearchClear => 'مسح البحث';

  @override
  String get exploreSearchCategories => 'الفئات';

  @override
  String get exploreSectionFeaturedCategories => 'فئات مميزة';

  @override
  String get exploreSectionFeaturedVendors => 'متاجر مميزة';

  @override
  String get exploreSectionNew => 'جديد على هاتلي';

  @override
  String get exploreLoadFailed => 'تعذّر تحميل الاستكشاف';

  @override
  String get exploreSeeLess => 'عرض أقل';

  @override
  String get categoryProductsSearchHint => 'ابحث في المنتجات';

  @override
  String get categoryProductsEmptySubtitle => 'جرّب كلمة بحث أخرى أو عد لاحقًا';

  @override
  String catalogStartsFrom(String price) {
    return 'يبدأ من $price';
  }

  @override
  String catalogStoreCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count متجر',
      many: '$count متجرًا',
      few: '$count متاجر',
      two: 'متجران',
      one: 'متجر واحد',
    );
    return '$_temp0';
  }

  @override
  String catalogAvailableFromStores(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count متجر',
      many: '$count متجرًا',
      few: '$count متاجر',
      two: 'متجرين',
      one: 'متجر واحد',
    );
    return 'متوفر من $_temp0';
  }

  @override
  String get catalogChooseStore => 'اختيار';

  @override
  String get catalogChangeStore => 'تغيير المتجر';

  @override
  String get descriptionReadMore => 'عرض المزيد';

  @override
  String get descriptionReadLess => 'عرض أقل';

  @override
  String get productAddToCart => 'أضف للسلة';

  @override
  String get productTotalLabel => 'الإجمالي';

  @override
  String get optionRequiredError => 'اختر خيارًا واحدًا على الأقل';

  @override
  String cartMiniFromVendor(String vendor) {
    return 'من $vendor';
  }

  @override
  String get cartMiniContinue => 'متابعة التسوق';

  @override
  String cartMiniSummary(String items, String total) {
    return 'السلة: $items · $total';
  }

  @override
  String get quantityDecrease => 'تقليل الكمية';

  @override
  String get quantityIncrease => 'زيادة الكمية';

  @override
  String get cartErrorMaxVendors =>
      'وصلت إلى الحد الأقصى لعدد المتاجر في السلة الواحدة';

  @override
  String get cartErrorPickupSingleVendor =>
      'الاستلام من المتجر متاح لمتجر واحد فقط. غيّر إلى التوصيل لإضافة متجر آخر.';

  @override
  String get cartErrorMixedCartTypes =>
      'لا يمكن الجمع بين منتجات المتاجر وطلبات خدمة هاتلي في سلة واحدة. امسح السلة للتبديل بينهما.';

  @override
  String get cartEmptyTitle => 'سلتك مستنيا طلبك';

  @override
  String get cartEmptyCta => 'استكشف المنتجات';

  @override
  String get cartRemoveItem => 'حذف المنتج';

  @override
  String get cartEditItem => 'تعديل';

  @override
  String get cartEditHint =>
      'لتغيير خيارات منتج: اضغط «تعديل»، اضبط الخيارات وأضفه من جديد، ثم احذف السطر القديم.';

  @override
  String cartSectionExpand(String vendor) {
    return 'عرض منتجات $vendor';
  }

  @override
  String cartSectionCollapse(String vendor) {
    return 'إخفاء منتجات $vendor';
  }

  @override
  String get cartItemUpdating => 'جارٍ التحديث';

  @override
  String get cartContinueToCheckout => 'متابعة لإتمام الطلب';

  @override
  String get supportContactAction => 'تواصل مع Hatly';

  @override
  String get supportContactActionSubtitle => 'نرد عليك عبر واتساب';

  @override
  String get supportContactOrderAction => 'تواصل مع Hatly بخصوص الطلب';

  @override
  String get supportContactUnavailable => 'التواصل مع Hatly غير متاح حاليًا';

  @override
  String get supportContactLaunchFailed => 'تعذّر فتح واتساب. حاول مرة أخرى.';

  @override
  String get supportMessageGeneral => 'مرحبًا Hatly، أحتاج إلى مساعدة.';

  @override
  String supportMessageOrder(String orderId) {
    return 'مرحبًا Hatly، أحتاج إلى مساعدة بخصوص الطلب رقم $orderId.';
  }

  @override
  String get paymentMethodInstapay => 'إنستاباي';

  @override
  String get paymentMethodVodafoneCash => 'فودافون كاش';

  @override
  String get paymentMethodOrangeCash => 'أورانج كاش';

  @override
  String get paymentMethodEtisalatCash => 'اتصالات كاش';

  @override
  String get paymentMethodWePay => 'WE Pay';

  @override
  String get paymentCodLabel => 'الدفع نقدًا عند الاستلام';

  @override
  String get paymentPayAtDeliveryLabel => 'الدفع إلكترونيًا عند الاستلام';

  @override
  String paymentPayAtDeliveryWith(String method) {
    return 'الدفع عند الاستلام عبر $method';
  }

  @override
  String get paymentManualTransferLabel => 'تحويل يدوي مسبق';

  @override
  String paymentManualTransferWith(String method) {
    return 'تحويل مسبق عبر $method';
  }

  @override
  String get paymentWalletLabel => 'محفظة هاتلي';

  @override
  String etaAboutMinutes(int minutes) {
    return 'حوالي $minutes دقيقة';
  }

  @override
  String etaRangeMinutes(int min, int max) {
    return 'من $min إلى $max دقيقة';
  }

  @override
  String get etaUnavailable => 'وقت التوصيل المتوقع غير متاح حاليًا';

  @override
  String get etaUnavailablePreparation =>
      'لم يحدد المتجر وقت التحضير بعد، لذلك لا يوجد وقت متوقع';

  @override
  String etaDeliveryAt(String time) {
    return 'التوصيل المتوقع حوالي $time';
  }

  @override
  String etaDeliveryBetween(String from, String until) {
    return 'التوصيل المتوقع بين $from و$until';
  }

  @override
  String etaReadyAt(String time) {
    return 'يكون جاهزًا للاستلام حوالي $time';
  }

  @override
  String etaReadyBetween(String from, String until) {
    return 'يكون جاهزًا للاستلام بين $from و$until';
  }

  @override
  String get etaDelayed => 'الطلب متأخر قليلًا عن الوقت المتوقع';

  @override
  String get checkoutFulfillmentTitle => 'طريقة الاستلام';

  @override
  String get checkoutFulfillmentDelivery => 'توصيل';

  @override
  String get checkoutFulfillmentPickup => 'استلام من الفرع';

  @override
  String get checkoutPickupSingleVendorOnly =>
      'الاستلام من الفرع متاح لطلب من متجر واحد فقط';

  @override
  String get checkoutPickupBranchDisabled =>
      'هذا المتجر لا يوفّر الاستلام من الفرع';

  @override
  String get checkoutPickupUnavailable =>
      'الاستلام من الفرع غير متاح لهذا الطلب';

  @override
  String get checkoutPickupFrom => 'الاستلام من';

  @override
  String get checkoutPickupEstimate => 'وقت التجهيز';

  @override
  String get checkoutPickupNoDeliveryFee => 'بدون رسوم توصيل';

  @override
  String get checkoutChangeAddress => 'تغيير';

  @override
  String get checkoutDefaultAddress => 'افتراضي';

  @override
  String get checkoutAddressOutOfServiceArea =>
      'هاتلي لا يوصّل إلى هذا العنوان حاليًا. اختر عنوانًا آخر.';

  @override
  String get checkoutAddressVendorDoesNotDeliver =>
      'أحد المتاجر في سلتك لا يوفّر التوصيل. يمكنك اختيار الاستلام من الفرع أو تعديل السلة.';

  @override
  String get checkoutAddressVendorOutsideArea =>
      'أحد المتاجر في سلتك لا يوصّل إلى هذا العنوان. اختر عنوانًا آخر أو عدّل السلة.';

  @override
  String get checkoutDeliveryEstimate => 'التوصيل';

  @override
  String get checkoutDeliveryFeePending => 'يُحدَّد بعد اختيار العنوان';

  @override
  String get checkoutBreakdownBase => 'رسوم التوصيل الأساسية';

  @override
  String checkoutBreakdownAdditionalVendors(int count) {
    return 'متاجر إضافية ($count)';
  }

  @override
  String get checkoutBreakdownDistance => 'المسافة';

  @override
  String checkoutDistanceKm(String km) {
    return '$km كم';
  }

  @override
  String get checkoutVendorPreparation => 'وقت تجهيز كل متجر';

  @override
  String checkoutPreparationMinutes(int minutes) {
    return 'حوالي $minutes دقيقة';
  }

  @override
  String get checkoutPreparationUnknown => 'غير محدد';

  @override
  String get checkoutPaymentManualTransfer => 'تحويل يدوي (دفع مسبق)';

  @override
  String get checkoutPaymentManualTransferHint =>
      'لا يبدأ تجهيز طلبك إلا بعد اعتماد التحويل';

  @override
  String get checkoutPaymentPayAtDeliveryHint =>
      'تدفع للمندوب عند التسليم بوسيلة دفع إلكترونية';

  @override
  String get checkoutChooseElectronicMethod => 'اختر وسيلة الدفع الإلكتروني';

  @override
  String get checkoutElectronicMethodHeading => 'وسيلة الدفع الإلكتروني';

  @override
  String get checkoutElectronicMethodUnavailable =>
      'وسيلة الدفع هذه غير متاحة حاليًا، اختر وسيلة أخرى';

  @override
  String get checkoutCannotConfirmYet =>
      'لم نتمكن من تأكيد الطلب بعد. راجع اختياراتك وحاول مرة أخرى';

  @override
  String get checkoutNoElectronicMethods =>
      'لا توجد وسائل دفع إلكتروني متاحة حاليًا';

  @override
  String get checkoutTransferUnavailable => 'التحويل اليدوي غير متاح حاليًا';

  @override
  String get checkoutPickupCashNote =>
      'طلبات الاستلام تُدفع نقدًا في الفرع عند استلامها.';

  @override
  String get checkoutTransferUnavailableWeighed =>
      'غير متاح للطلبات التي تحتوي على منتجات بالوزن لأن السعر النهائي يُحسب بعد الوزن';

  @override
  String get checkoutTransferUnavailableUnpriced =>
      'غير متاح لأن سعر الطلب لم يُحدَّد بعد';

  @override
  String get checkoutPaidFullyByWallet =>
      'سيتم دفع الطلب بالكامل من محفظة هاتلي';

  @override
  String get checkoutWalletTitle => 'المحفظة';

  @override
  String get checkoutWalletUse => 'استخدام رصيد محفظة هاتلي';

  @override
  String checkoutWalletBalance(String amount) {
    return 'رصيدك: $amount';
  }

  @override
  String get checkoutWalletApplied => 'المدفوع من المحفظة';

  @override
  String get checkoutAmountDue => 'المتبقي للدفع';

  @override
  String get checkoutWalletAmountLabel => 'المبلغ المخصوم من المحفظة (اختياري)';

  @override
  String get checkoutWalletAmountHelp => 'اتركه فارغًا لاستخدام أكبر مبلغ ممكن';

  @override
  String get checkoutWalletEmpty => 'رصيد المحفظة صفر';

  @override
  String get checkoutWalletUnavailableForOrder =>
      'لا يمكن استخدام المحفظة مع هذا الطلب لأن سعره النهائي غير محدد بعد';

  @override
  String get checkoutCouponTitle => 'لديك كود خصم؟';

  @override
  String get checkoutCouponHint => 'أدخل كود الخصم';

  @override
  String get checkoutCouponApply => 'تطبيق';

  @override
  String get checkoutCouponRemove => 'إزالة';

  @override
  String checkoutCouponSaves(String amount) {
    return 'وفّرت $amount';
  }

  @override
  String checkoutCouponForVendor(String vendor) {
    return 'من $vendor';
  }

  @override
  String get checkoutCouponNotFound => 'كود الخصم غير صحيح';

  @override
  String get checkoutCouponExpired => 'انتهت صلاحية كود الخصم';

  @override
  String get checkoutCouponNotStarted => 'كود الخصم لم يبدأ بعد';

  @override
  String get checkoutCouponMinimumNotMet =>
      'لم يصل طلبك إلى الحد الأدنى لاستخدام هذا الكود';

  @override
  String get checkoutCouponNotApplicable =>
      'هذا الكود لا ينطبق على المنتجات في سلتك';

  @override
  String get checkoutCouponConflictsWithOffer =>
      'لا يمكن استخدام الكود مع عرض مفعّل على نفس المتجر';

  @override
  String get checkoutCouponLimitReached => 'تم استهلاك هذا الكود بالكامل';

  @override
  String get checkoutCouponRejected => 'لا يمكن استخدام هذا الكود';

  @override
  String get checkoutOrderSummary => 'ملخص الطلب';

  @override
  String get checkoutTotalPending => 'يُحدَّد لاحقًا';

  @override
  String get checkoutConfirmAndPay => 'تأكيد الطلب ومتابعة الدفع';

  @override
  String get checkoutStaleChanged =>
      'تغيّر السعر أو تفاصيل التوصيل منذ آخر مراجعة. راجع الملخص المحدّث ثم أكّد الطلب مرة أخرى.';

  @override
  String get checkoutStaleExpired =>
      'انتهت صلاحية العرض السابق. راجع الملخص المحدّث ثم أكّد الطلب مرة أخرى.';

  @override
  String get checkoutErrorWalletInsufficient =>
      'رصيد المحفظة لا يغطي قيمة الطلب';

  @override
  String get checkoutBlockerGeneric =>
      'لا يمكن إتمام الطلب حاليًا. راجع سلتك وحاول مرة أخرى.';

  @override
  String get checkoutBlockerAdHocPickupRequired =>
      'طلب خدمة هاتلي هذا بدون موقع استلام. احذفه من السلة وأضفه مرة أخرى مع موقع المكان.';

  @override
  String get checkoutBlockerAdHocDestinationRequired =>
      'طلب خدمة هاتلي هذا بدون وجهة. احذفه من السلة وأضفه مرة أخرى مع الوجهة.';

  @override
  String get checkoutBlockerUnavailable =>
      'أحد المنتجات أو المتاجر في سلتك غير متاح حاليًا';

  @override
  String get checkoutBlockerMultiVendorDisabled =>
      'الطلب من أكثر من متجر غير متاح حاليًا';

  @override
  String get checkoutBlockerFeeUnavailable =>
      'تعذّر حساب رسوم التوصيل الآن. حاول مرة أخرى بعد قليل.';

  @override
  String get checkoutBlockerGpsUnavailable =>
      'التوصيل إلى موقع GPS غير متاح حاليًا. اختر عنوانًا بمنطقة توصيل أو أضف عنوانًا جديدًا.';

  @override
  String get checkoutBlockerInvalidAddress =>
      'موقع العنوان غير صالح. اختر موقعًا آخر.';

  @override
  String get checkoutOrderPlacedButLoadFailed =>
      'تم إنشاء طلبك، لكن تعذّر تحميل تفاصيله الآن';

  @override
  String get checkoutSuccessTitle => 'تم استلام طلبك';

  @override
  String get checkoutSuccessAwaitingTitle =>
      'تم إنشاء طلبك، والدفع قيد المراجعة';

  @override
  String get checkoutSuccessSendProof => 'أرسل إثبات التحويل';

  @override
  String get checkoutSuccessBackHome => 'العودة للرئيسية';

  @override
  String get orderNumberLabel => 'رقم الطلب';

  @override
  String get orderVendorsLabel => 'المتاجر';

  @override
  String get orderTrackAction => 'تتبّع الطلب';

  @override
  String get orderDetailsAction => 'تفاصيل الطلب';

  @override
  String get orderPaymentAwaitingReview =>
      'دفعتك قيد المراجعة. سيبدأ تجهيز الطلب بعد اعتماد التحويل.';

  @override
  String get orderPaymentAwaitingReviewShort => 'الدفع قيد المراجعة';

  @override
  String get orderTimelineTitle => 'مراحل الطلب';

  @override
  String get orderPricingTitle => 'ملخص الحساب';

  @override
  String get orderDeliveryBreakdownTitle => 'تفاصيل رسوم التوصيل';

  @override
  String get orderPaymentMethodLabel => 'طريقة الدفع';

  @override
  String get orderPaymentStatusLabel => 'حالة الدفع';

  @override
  String get orderPaymentStatusPending => 'بانتظار إرسال إثبات التحويل';

  @override
  String get orderPaymentStatusUnderReview => 'قيد المراجعة';

  @override
  String get orderPaymentStatusPaid => 'تم الدفع';

  @override
  String get orderPaymentStatusRejected => 'تم رفض التحويل';

  @override
  String get orderPaymentStatusDueOnDelivery => 'يُدفع عند الاستلام';

  @override
  String get orderDeliveryAddressTitle => 'عنوان التوصيل';

  @override
  String orderCouponLine(String code, String amount) {
    return 'كود الخصم $code: وفّرت $amount';
  }

  @override
  String orderVendorReadyAt(String time) {
    return 'يكون جاهزًا حوالي $time';
  }

  @override
  String orderVendorPreparationMinutes(int minutes) {
    return 'وقت التجهيز حوالي $minutes دقيقة';
  }

  @override
  String get orderCancelAction => 'إلغاء الطلب';

  @override
  String get orderCancelConfirmTitle => 'إلغاء الطلب بالكامل؟';

  @override
  String get orderCancelConfirmMessage =>
      'سيتم إلغاء الطلب من جميع المتاجر. إذا دفعت من المحفظة يعود المبلغ إليها.';

  @override
  String get orderCancelReasonHint => 'سبب الإلغاء (اختياري)';

  @override
  String get orderCancelKeep => 'الاحتفاظ بالطلب';

  @override
  String get orderCancelConfirmAction => 'نعم، ألغِ الطلب';

  @override
  String get orderCancelDone => 'تم إلغاء الطلب';

  @override
  String get orderCancelNotAllowed =>
      'لم يعد بإمكانك إلغاء هذا الطلب لأن أحد المتاجر بدأ التجهيز';

  @override
  String get orderCancelFailed => 'تعذّر إلغاء الطلب. حاول مرة أخرى.';

  @override
  String get ordersTabActive => 'جارية';

  @override
  String get ordersTabCompleted => 'مكتملة';

  @override
  String get ordersTabCancelled => 'ملغاة';

  @override
  String get ordersEmptyActive => 'لا توجد طلبات جارية';

  @override
  String get ordersEmptyCompleted => 'لا توجد طلبات مكتملة بعد';

  @override
  String get ordersEmptyCancelled => 'لا توجد طلبات ملغاة';

  @override
  String get addressLocationSection => 'الموقع على الخريطة';

  @override
  String get addressDetailsSection => 'تفاصيل العنوان';

  @override
  String get addressMapUnavailable =>
      'الخريطة غير مفعّلة في هذا الإصدار. حدّد موقعك بالـGPS أو ابحث عن عنوانك.';

  @override
  String get addressConfirmPin => 'تأكيد هذا الموقع';

  @override
  String get addressSearchLabel => 'ابحث عن عنوانك';

  @override
  String get addressSearchAction => 'بحث';

  @override
  String get addressSearchNoResult =>
      'لم نجد هذا العنوان. البحث عن العناوين غير متاح دائمًا — يمكنك كتابة عنوانك في التفاصيل أعلاه وحفظه بدون موقع على الخريطة، أو استخدام موقعك الحالي.';

  @override
  String get addressLocationUnavailable =>
      'تعذّر الحصول على موقعك. فعّل خدمة الموقع وامنح التطبيق الإذن ثم حاول مرة أخرى.';

  @override
  String get addressSuggestionLabel => 'عنوان مقترح للموقع المحدد';

  @override
  String get addressUseSuggestion => 'استخدام';

  @override
  String get addressLine1Label => 'العنوان (الشارع والمنطقة)';

  @override
  String get addressLine1Required => 'اكتب عنوان التوصيل';

  @override
  String get addressGovernorateLabel => 'المحافظة';

  @override
  String get addressCityLabel => 'المدينة';

  @override
  String get addressBuildingLabel => 'العمارة';

  @override
  String get addressFloorLabel => 'الدور';

  @override
  String get addressApartmentLabel => 'الشقة';

  @override
  String get addressLandmarkLabel => 'علامة مميزة';

  @override
  String get addressLabelHome => 'المنزل';

  @override
  String get addressLabelWork => 'العمل';

  @override
  String get addressMakeDefault => 'اجعله عنواني الافتراضي';

  @override
  String get checkoutSuccessAppBar => 'تأكيد الطلب';

  @override
  String get checkoutAmountDueByTransfer => 'المتبقي للدفع بالتحويل';

  @override
  String get addressLocationServicesDisabled =>
      'خدمة الموقع مغلقة على جهازك. فعّلها من إعدادات الجهاز ثم حاول مرة أخرى.';

  @override
  String get addressLocationPermissionDenied =>
      'لم يُسمح للتطبيق بالوصول لموقعك. حاول مرة أخرى أو أدخل عنوانك يدويًا.';

  @override
  String get addressLocationPermissionPermanentlyDenied =>
      'إذن الموقع مرفوض بشكل دائم. فعّله من إعدادات التطبيق على جهازك.';

  @override
  String get addressLocationPositionUnavailable =>
      'تعذّر تحديد موقعك الحالي. حاول مرة أخرى أو أدخل عنوانك يدويًا.';

  @override
  String get addressOpenSettings => 'فتح إعدادات التطبيق';

  @override
  String get hatlyServiceEntryTitle => 'خدمة هاتلي';

  @override
  String get hatlyServiceEntrySubtitle =>
      'محتاج حاجة من مكان مش موجود عندنا؟ اطلبها من هاتلي.';

  @override
  String get hatlyServiceScreenTitle => 'خدمة هاتلي';

  @override
  String get hatlyServiceTypeSectionTitle => 'محتاج إيه؟';

  @override
  String get hatlyServiceTypeBuyFromPlace => 'هاتلي من مكان';

  @override
  String get hatlyServiceTypeBuyFromPlaceHint =>
      'قولنا هاتلك إيه ومن فين، وإحنا هنجيبه لك.';

  @override
  String get hatlyServiceTypeDeliverToPlace => 'وصّلي لمكان';

  @override
  String get hatlyServiceTypeDeliverToPlaceHint =>
      'قولنا هنوصّل إيه وفين، وإحنا هنستلمه ونوصّله.';

  @override
  String get hatlyServiceExistingGroupNotice =>
      'عندك بالفعل طلب خدمة هاتلي في سلتك. هذا الصنف هيتضاف إليه.';

  @override
  String get hatlyServicePlaceNameLabel => 'اسم الطلب';

  @override
  String get hatlyServicePlaceNameHint => 'مثال: كارفور مول مصر، أو بيت ماما';

  @override
  String get hatlyServicePlaceNameRequired => 'اكتب اسمًا مختصرًا لهذا الطلب';

  @override
  String get hatlyServiceDescriptionLabel => 'اوصف اللي محتاجه';

  @override
  String get hatlyServiceDescriptionHint =>
      'كن محددًا قدر الإمكان — الصنف، الماركة، الكمية، أي تفاصيل تساعدنا.';

  @override
  String get hatlyServiceDescriptionRequired => 'اوصف اللي محتاجه';

  @override
  String get hatlyServiceImagesLabel => 'صور (اختياري)';

  @override
  String get hatlyServiceLocationPickupTitle => 'موقع الاستلام (مطلوب)';

  @override
  String get hatlyServiceLocationDestinationTitle => 'موقع التوصيل (مطلوب)';

  @override
  String get hatlyServiceLocationDestinationHint =>
      'حدد بالضبط أين يجب توصيل هذا الطلب — هاتلي لا يمكنه تخمين ذلك نيابة عنك.';

  @override
  String get hatlyServiceLocationPickupHint =>
      'حدد بالضبط المكان الذي يجب أن تشتري هاتلي منه — هاتلي لا يمكنه تخمين ذلك نيابة عنك.';

  @override
  String get hatlyServiceReviewTitle => 'راجع طلبك';

  @override
  String get hatlyServiceReviewEdit => 'تعديل';

  @override
  String get hatlyServiceReviewTypeLabel => 'الخدمة';

  @override
  String get hatlyServiceReviewPlaceLabel => 'اسم الطلب';

  @override
  String get hatlyServiceReviewDescriptionLabel => 'التفاصيل';

  @override
  String get hatlyServiceReviewImagesLabel => 'الصور';

  @override
  String get hatlyServiceReviewLocationLabel => 'الموقع';

  @override
  String get hatlyServiceReviewLocationSet => 'تم تحديده — سيُستخدم لهذا الطلب';

  @override
  String get hatlyServiceReviewLocationRequired =>
      'غير محدد — يجب تحديده قبل إمكانية إضافة هذا الطلب';

  @override
  String get hatlyServiceContinueToReview => 'مراجعة الطلب';

  @override
  String get hatlyServiceSubmit => 'أضف إلى السلة';

  @override
  String get hatlyServiceAddedConfirmation => 'تمت الإضافة إلى السلة';

  @override
  String get orderHatlyServiceTypeLabel => 'نوع الخدمة';

  @override
  String get orderHatlyServicePickupLocationLabel => 'موقع الاستلام';

  @override
  String get orderHatlyServiceDestinationLocationLabel => 'موقع التوصيل';

  @override
  String get orderHatlyServiceLocationCoordinates => 'محدد على الخريطة';

  @override
  String get cartErrorAdHocPlaceNameRequired =>
      'اكتب اسمًا مختصرًا لهذا الطلب.';

  @override
  String get cartErrorAdHocServiceTypeRequired => 'اختر نوع خدمة هاتلي.';

  @override
  String get cartErrorAdHocLocationMismatch =>
      'هذا الموقع لا ينطبق على نوع الخدمة هذا.';

  @override
  String get cartErrorAdHocIncompleteCoordinate =>
      'حدد الموقع مرة أخرى — لم يتم التقاطه بشكل صحيح.';

  @override
  String get cartErrorAdHocSingleLocationOnly =>
      'طلب خدمة هاتلي يمكن أن يشمل موقعًا واحدًا فقط. أفرغ السلة لبدء طلب جديد.';

  @override
  String get cartErrorAdHocPickupOnly =>
      'خدمة هاتلي غير متاحة مع الاستلام من المتجر — غيّر إلى التوصيل أولًا.';

  @override
  String get cartErrorAdHocDestinationRequired =>
      'من فضلك اختر وجهة لطلب التوصيل هذا قبل إضافته إلى السلة.';

  @override
  String get cartErrorAdHocPickupRequired =>
      'من فضلك اختر موقع المكان المطلوب الشراء منه قبل إضافة هذا الطلب إلى السلة.';

  @override
  String get profileMyAddresses => 'عناويني';

  @override
  String get profileDefaultAddressTitle => 'العنوان الافتراضي';

  @override
  String get profileNoDefaultAddress => 'لا يوجد عنوان افتراضي بعد';

  @override
  String get profileManageAddresses => 'إدارة';

  @override
  String get profileWalletCardTitle => 'محفظة هاتلي';

  @override
  String get walletTitle => 'المحفظة';

  @override
  String get walletBalanceLabel => 'رصيد المحفظة';

  @override
  String get walletHistoryTitle => 'سجل المعاملات';

  @override
  String get walletEmptyHistory => 'لا توجد معاملات بعد';

  @override
  String get walletTypeOrderPayment => 'دفع طلب';

  @override
  String get walletTypeOrderRefund => 'استرداد طلب';

  @override
  String get walletTypeAdminCredit => 'رصيد مضاف';

  @override
  String get walletTypeLoyaltyRedemption => 'استبدال نقاط';

  @override
  String get walletTypeDriverCashRemainder => 'باقي نقدي';

  @override
  String get walletTypeAdjustment => 'تسوية رصيد';

  @override
  String get walletTypeExpiration => 'رصيد منتهي الصلاحية';

  @override
  String get profileLoyaltyCardTitle => 'نقاط هاتلي';

  @override
  String get loyaltyTitle => 'نقاط هاتلي';

  @override
  String get loyaltyBalanceLabel => 'رصيد النقاط';

  @override
  String get loyaltyPointsSuffix => 'نقطة';

  @override
  String get loyaltyHistoryTitle => 'سجل النقاط';

  @override
  String get loyaltyEmptyHistory => 'لا يوجد نشاط نقاط بعد';

  @override
  String get loyaltyTypeEarning => 'نقاط مكتسبة';

  @override
  String get loyaltyTypeEarningReversed => 'نقاط معكوسة (استرداد)';

  @override
  String get loyaltyTypeRedemption => 'تم التحويل إلى المحفظة';

  @override
  String get loyaltyTypeAdminAdjustment => 'تسوية';

  @override
  String get loyaltyTypeExpiration => 'نقاط منتهية الصلاحية';

  @override
  String get loyaltyConvertAction => 'تحويل إلى المحفظة';

  @override
  String get loyaltyConvertSheetTitle => 'تحويل النقاط إلى المحفظة';

  @override
  String get loyaltyConvertSheetRule =>
      'كل 500 نقطة = 5 جنيه. حوّل بمضاعفات 100 نقطة، بحد أدنى 500 نقطة.';

  @override
  String get loyaltyConvertAvailableLabel => 'المتاح';

  @override
  String get loyaltyConvertAmountLabel => 'عدد النقاط للتحويل';

  @override
  String get loyaltyConvertAmountHint => 'مثال: 500';

  @override
  String get loyaltyConvertSubmit => 'تحويل';

  @override
  String get loyaltyConvertSuccess => 'تم التحويل إلى محفظة هاتلي';

  @override
  String get loyaltyErrorInsufficientPoints =>
      'لا يوجد لديك نقاط كافية لهذا التحويل.';

  @override
  String get loyaltyErrorBelowMinimum => 'أدخل 500 نقطة على الأقل.';

  @override
  String get loyaltyErrorInvalidMultiple => 'أدخل قيمة من مضاعفات 100 نقطة.';

  @override
  String get addressSetDefaultAction => 'اجعله الافتراضي';

  @override
  String get addressSetDefaultError =>
      'فشل تعيينه كعنوان افتراضي. حاول مرة أخرى.';

  @override
  String get profileAppearanceTitle => 'المظهر';

  @override
  String get themeModeSystem => 'النظام';

  @override
  String get themeModeLight => 'فاتح';

  @override
  String get themeModeDark => 'داكن';

  @override
  String get hatlyServicePricePending => 'سيتم تأكيد السعر أثناء تجهيز الطلب';

  @override
  String get checkoutHatlyServiceCodNote =>
      'طلبات خدمة هاتلي تُدفع عند الاستلام فقط. سيتم تأكيد السعر أثناء تجهيز الطلب، وسيظهر لك الإجمالي النهائي في تفاصيل الطلب.';

  @override
  String get cartErrorTooManyImages =>
      'عدد الصور أكبر من المسموح به لهذا الطلب.';

  @override
  String get cartErrorInvalidImage =>
      'تعذّر استخدام إحدى الصور. أعد رفعها وحاول مرة أخرى.';

  @override
  String get cartErrorContentRequired => 'اكتب وصف الطلب أو أرفق صورة.';

  @override
  String get serviceTemporarilyUnavailable =>
      'هذه الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا أو التواصل مع هاتلي.';

  @override
  String get checkoutErrorAddressRequired =>
      'اختر عنوان التوصيل أولًا ثم أعد المحاولة.';

  @override
  String get checkoutErrorEmptyCart =>
      'سلتك فارغة. أضف طلبًا ثم حاول مرة أخرى.';

  @override
  String get checkoutErrorNoActiveCart =>
      'لم نجد سلة نشطة لإتمام الطلب. ربما تم إرسال طلبك بالفعل — راجع قائمة الطلبات.';

  @override
  String get checkoutErrorQuoteRequired =>
      'راجع ملخص الطلب ثم أكّد الطلب مرة أخرى.';

  @override
  String get checkoutErrorPaymentMethodRequired => 'اختر طريقة الدفع.';

  @override
  String get checkoutErrorOnlinePaymentUnavailable =>
      'الدفع الإلكتروني غير متاح حاليًا.';

  @override
  String get addressZoneSection => 'منطقة التوصيل';

  @override
  String get addressZoneLabel => 'المنطقة';

  @override
  String get addressZoneHelp =>
      'المنطقة اللي بتختارها هي اللي بتحدد إذا كان التوصيل متاح وقيمة رسوم التوصيل.';

  @override
  String get addressZoneRequired => 'اختار المنطقة';

  @override
  String addressZoneFeeHint(String fee) {
    return 'رسوم التوصيل للمنطقة دي: $fee — الرسوم النهائية بتتأكد في صفحة الدفع.';
  }

  @override
  String get addressZonesLoadError => 'معرفناش نحمّل مناطق التوصيل. حاول تاني.';

  @override
  String get addressZonesEmpty =>
      'لا توجد مناطق توصيل متاحة بعد، لذلك لا يمكن حفظ عنوان الآن. حاول مرة أخرى لاحقًا.';

  @override
  String get addressDetailedLabel => 'العنوان بالتفصيل';

  @override
  String get addressDetailedHint =>
      'مثال: شارع أبو نصيب جنب جامع الكردي، منزل 15';

  @override
  String get addressLocationOptionalSection => 'الموقع على الخريطة (اختياري)';

  @override
  String get addressLocationOptionalHelp =>
      'تحديد الموقع بيساعد المندوب يوصلك أسرع، بس مش مطلوب عشان تحفظ العنوان.';

  @override
  String get addressRemoveLocation => 'شيل الموقع';

  @override
  String get addressZoneMissingBanner =>
      'العنوان ده محتاج تختار له منطقة التوصيل قبل ما تطلب عليه.';

  @override
  String get addressZoneUnavailableBanner =>
      'منطقة التوصيل بتاعة العنوان ده مش متاحة دلوقتي. اختار منطقة تانية.';

  @override
  String get addressChooseZoneAction => 'اختار المنطقة';

  @override
  String get checkoutAddressZoneRequired =>
      'اختار منطقة التوصيل للعنوان ده عشان نقدر نوصّلك.';

  @override
  String get checkoutAddressZoneUnavailable =>
      'هاتلي مش بيوصّل للمنطقة دي دلوقتي. اختار منطقة أو عنوان تاني.';

  @override
  String checkoutDeliveryZonePricing(String area) {
    return 'رسوم التوصيل حسب المنطقة: $area';
  }

  @override
  String get addressZoneAutoSelected =>
      'دي المنطقة الوحيدة المتاحة في المدينة دي، فاخترناها لك.';

  @override
  String get addressCityNoZones =>
      'مفيش مناطق توصيل متاحة في المدينة دي دلوقتي.';

  @override
  String get guestSignInTitle => 'سجّل الدخول للمتابعة';

  @override
  String get guestSignInBody =>
      'أنشئ حسابًا أو سجّل الدخول لاستخدام السلة والطلبات والملف الشخصي.';

  @override
  String get guestSignInAction => 'تسجيل الدخول أو إنشاء حساب';

  @override
  String get guestBrowseAction => 'تصفح بدون حساب';

  @override
  String get weightEntryTitle => 'أدخل الوزن';

  @override
  String get weightEntryHint => 'مثال: 1.5';

  @override
  String get weightEntryConfirm => 'تأكيد الوزن';

  @override
  String get weightEntryTooltip => 'اكتب الوزن';

  @override
  String weightEntryInvalid(String min, String max) {
    return 'أدخل وزنًا بين $min و$max';
  }

  @override
  String weightGramsShort(int grams) {
    return '$grams جم';
  }

  @override
  String weightKgShort(String kg) {
    return '$kg كجم';
  }

  @override
  String get addressPickerHint => 'اختر عنوانًا محفوظًا';

  @override
  String get addressPickerNoPin => 'لا يوجد موقع على الخريطة — أضفه من عناويني';

  @override
  String get addressPickerNeedsPin =>
      'هذا العنوان بلا موقع على الخريطة فلا يمكن استخدامه هنا. أضف له موقعًا أولًا.';

  @override
  String hatlyServiceRouteBuy(String place) {
    return 'هاتلي تشتري من $place وتوصّل إلى عنوان التوصيل الخاص بك';
  }

  @override
  String hatlyServiceRouteDeliver(String place) {
    return 'هاتلي تستلم من عنوان التوصيل الخاص بك وتوصّل إلى $place';
  }

  @override
  String get hatlyServiceRoutePlaceUnset => 'المكان الذي تختاره';

  @override
  String get hatlyServiceDeliveryOnly => 'رسوم التوصيل فقط';

  @override
  String get homeSectionMostOrdered => 'الأكثر طلبًا';

  @override
  String get homeSectionNew => 'الجديد';

  @override
  String get homeSeeAllOffersTitle => 'العروض';

  @override
  String get homeSeeAllEmpty => 'لا يوجد شيء هنا بعد';

  @override
  String get notificationsTitle => 'الإشعارات';

  @override
  String get notificationsEmptyTitle => 'لا توجد إشعارات بعد';

  @override
  String get notificationsEmptyBody => 'سنخبرك هنا بكل تحديث على طلباتك.';

  @override
  String get notificationsLoadError => 'تعذّر تحميل الإشعارات';

  @override
  String get notificationsMarkAllRead => 'تحديد الكل كمقروء';

  @override
  String get notificationsBellLabel => 'الإشعارات';

  @override
  String notificationsBellLabelUnread(int count) {
    return 'الإشعارات، $count غير مقروء';
  }

  @override
  String get notificationsUnread => 'غير مقروء';

  @override
  String get notificationOrderPlacedTitle => 'تم استلام طلبك';

  @override
  String notificationOrderPlacedBody(String orderNumber) {
    return 'استلمنا طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderConfirmedTitle => 'تم تأكيد طلبك';

  @override
  String notificationOrderConfirmedBody(String orderNumber) {
    return 'تم تأكيد طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderPreparingTitle => 'جارٍ تجهيز طلبك';

  @override
  String notificationOrderPreparingBody(String orderNumber) {
    return 'بدأ تجهيز طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderReadyForPickupTitle => 'طلبك جاهز للاستلام';

  @override
  String notificationOrderReadyForPickupBody(String orderNumber) {
    return 'طلبك رقم $orderNumber جاهز، يمكنك استلامه من الفرع.';
  }

  @override
  String get notificationOrderOnTheWayTitle => 'طلبك في الطريق';

  @override
  String notificationOrderOnTheWayBody(String orderNumber) {
    return 'طلبك رقم $orderNumber في الطريق إليك.';
  }

  @override
  String get notificationOrderDeliveredTitle => 'تم توصيل طلبك';

  @override
  String notificationOrderDeliveredBody(String orderNumber) {
    return 'تم توصيل طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderCollectedTitle => 'تم استلام طلبك';

  @override
  String notificationOrderCollectedBody(String orderNumber) {
    return 'تم استلام طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderCancelledTitle => 'تم إلغاء طلبك';

  @override
  String notificationOrderCancelledBody(String orderNumber) {
    return 'تم إلغاء طلبك رقم $orderNumber.';
  }

  @override
  String get notificationOrderFailedDeliveryTitle => 'تعذّر توصيل طلبك';

  @override
  String notificationOrderFailedDeliveryBody(String orderNumber) {
    return 'لم نتمكن من توصيل طلبك رقم $orderNumber.';
  }

  @override
  String get customRequestEntryHint =>
      'اكتب الصنف أو أضف صورة، وسيتأكد المتجر منه ويحدد سعره.';

  @override
  String get customRequestAdded =>
      'تمت الإضافة إلى سلتك — سيؤكد المتجر توفر الصنف ويحدد سعره.';

  @override
  String get cartErrorCustomRequestsUnavailable =>
      'هذا المتجر لا يقبل الطلبات المخصصة.';

  @override
  String optionChooseBetween(int min, int max) {
    return 'اختر من $min إلى $max';
  }

  @override
  String optionChooseAtLeast(int min) {
    return 'اختر $min على الأقل';
  }

  @override
  String optionChooseUpTo(int max) {
    return 'اختر حتى $max';
  }

  @override
  String optionMinError(int min) {
    return 'اختر $min على الأقل';
  }

  @override
  String optionMaxReached(int max) {
    return 'يمكنك اختيار $max كحد أقصى';
  }

  @override
  String get cartErrorOptionLimit =>
      'أحد الاختيارات خارج ما يسمح به هذا المنتج — راجع اختياراتك.';

  @override
  String get deleteAccountAction => 'حذف حسابي';

  @override
  String get deleteAccountTitle => 'حذف الحساب نهائيًا';

  @override
  String get deleteAccountExplanation =>
      'سيتم حذف بياناتك الشخصية (الاسم ورقم الهاتف والعناوين المحفوظة والإشعارات والمفضلة وسلة التسوق). تبقى سجلات الطلبات والمدفوعات المنتهية بدون أي بيانات تعرّف بك، لأن المتاجر والسائقين وهاتلي يحتاجونها للمحاسبة. ستفقد نقاط هاتلي. لا يمكن التراجع عن هذا الإجراء.';

  @override
  String get deleteAccountRequirements =>
      'لا يمكن حذف الحساب أثناء وجود طلب قيد التنفيذ أو رصيد في محفظة هاتلي.';

  @override
  String get deleteAccountPasswordHint => 'أدخل كلمة المرور للتأكيد';

  @override
  String get deleteAccountConfirm => 'حذف الحساب';

  @override
  String get deleteAccountCancel => 'إلغاء';

  @override
  String get deleteAccountPasswordRequired => 'أدخل كلمة المرور لتأكيد الحذف';

  @override
  String get deleteAccountErrorPassword => 'كلمة المرور غير صحيحة';

  @override
  String get deleteAccountErrorActiveOrders =>
      'لديك طلب قيد التنفيذ. يمكنك حذف حسابك بعد انتهائه.';

  @override
  String get deleteAccountErrorWalletBalance =>
      'محفظة هاتلي ليست فارغة. تواصل مع دعم هاتلي لتسويتها قبل حذف الحساب.';

  @override
  String get deleteAccountErrorGeneric => 'تعذّر حذف الحساب. حاول مرة أخرى.';

  @override
  String get homeNoStoresTitle => 'لا توجد متاجر متاحة بعد';

  @override
  String get homeNoStoresBody =>
      'ستظهر المتاجر والأقسام هنا بمجرد توفرها في منطقتك. تفقّد التطبيق مرة أخرى قريبًا.';

  @override
  String get phoneEgyptOnly =>
      'هاتلي تقبل حاليًا أرقام الموبايل المصرية فقط (+20).';

  @override
  String get addressMapLocationSaved => 'تم حفظ الموقع على الخريطة';

  @override
  String get addressTextOnly => 'عنوان نصي فقط — بدون موقع على الخريطة';

  @override
  String get addressMethodTitle => 'إزاي عايز تضيف عنوانك؟';

  @override
  String get addressMethodSubtitle =>
      'اختار طريقة واحدة بس — مش محتاج الاتنين.';

  @override
  String get addressMethodGpsTitle => 'استخدم موقعي الحالي (GPS)';

  @override
  String get addressMethodGpsHint =>
      'بنقرأ موقعك ونحسب التوصيل على حسب مسافة الطريق. مش محتاج تختار منطقة ولا تكتب عنوان.';

  @override
  String get addressMethodManualTitle => 'هكتب عنواني بنفسي';

  @override
  String get addressMethodManualHint =>
      'اختار منطقتك واكتب عنوانك بالتفصيل. التوصيل بسعر المنطقة الثابت. مفيش طلب لموقعك.';

  @override
  String get addressMethodGpsUnavailable =>
      'التوصيل بالموقع (GPS) مش متاح دلوقتي. اكتب عنوانك بنفسك.';

  @override
  String get addressChangeMethod => 'تغيير طريقة العنوان';

  @override
  String get addressChangeMethodTitle => 'تغيير طريقة العنوان؟';

  @override
  String get addressChangeMethodDiscardsGps => 'هيتم مسح الموقع اللي اتحدد.';

  @override
  String get addressChangeMethodDiscardsManual =>
      'هيتم مسح المنطقة المختارة والعنوان اللي كتبته.';

  @override
  String get addressChangeMethodConfirm => 'غيّر الطريقة';

  @override
  String get addressGpsJourneyTitle => 'موقعك';

  @override
  String get addressGpsHelp =>
      'اضغط على الزر لمشاركة موقعك الحالي. مش محتاج تختار منطقة ولا تكتب عنوان.';

  @override
  String get addressGpsDetected => 'تم تحديد موقعك';

  @override
  String get addressGpsFeeNote =>
      'سعر التوصيل بيتحسب عند إتمام الطلب من مسافة الطريق. أي مبلغ يظهر قبل كده هو تقدير فقط.';

  @override
  String get addressGpsNeedLocation => 'شارك موقعك الأول عشان تكمّل.';

  @override
  String get addressGpsOutsideCoverage => 'هاتلي لا توصّل للموقع ده لسه.';

  @override
  String get addressGpsInvalidLocation =>
      'مقدرناش نستخدم الموقع ده. جرّب تاني.';

  @override
  String get addressGpsSaved => 'موقع GPS';

  @override
  String get addressManualJourneyTitle => 'عنوان مكتوب';

  @override
  String get addressGpsJourneyBadge => 'طريقة GPS';

  @override
  String get addressManualJourneyBadge => 'طريقة العنوان المكتوب';

  @override
  String get addressMethodsLoading => 'بنجهّز طرق العنوان…';

  @override
  String get routeSectionTitle => 'مسار الطلب';

  @override
  String get routeFromLabel => 'من';

  @override
  String get routeToLabel => 'إلى';

  @override
  String get routeBadgeDefault => 'افتراضي';

  @override
  String get routeBadgeChosen => 'من اختيارك';

  @override
  String get routeChange => 'تغيير';

  @override
  String get routeChoose => 'اختيار';

  @override
  String get routeNotSet => 'لم يُحدد بعد';

  @override
  String get routeDefaultMissingHint =>
      'لا توجد نقطة افتراضية حاليًا — اختر نقطة.';

  @override
  String get routeOriginRequiredHint => 'اختر المكان اللي هيتم الاستلام منه.';

  @override
  String get routeSheetTitleOrigin => 'اختر نقطة البداية';

  @override
  String get routeSheetTitleDestination => 'اختر الوجهة';

  @override
  String get routeSheetPointSection => 'موقعك الحالي أو نقطة على الخريطة';

  @override
  String get routeSheetSavedSection => 'من عناويني المحفوظة';

  @override
  String get routeNameThisPlace => 'سمّ المكان (اختياري)';

  @override
  String get routeNameThisPlaceHint => 'مثال: بيت ماما';

  @override
  String get routeUseDefault => 'استخدام النقطة الافتراضية';

  @override
  String get routeConfirmPoint => 'تأكيد هذه النقطة';

  @override
  String get routeCurrentLocationLabel => 'موقعي الحالي';

  @override
  String get routeSelectedPointLabel => 'نقطة محددة';

  @override
  String get routeDirectionNote => 'الاتجاه: من النقطة الأولى إلى الثانية.';

  @override
  String get routeOrderSectionTitle => 'مسار الطلب';

  @override
  String get cartErrorAdHocOriginRequired =>
      'اختر مكان الاستلام لهذا الطلب قبل إضافته للسلة.';

  @override
  String get checkoutBlockerAdHocOriginRequired =>
      'طلب وصّلي لمكان ده من غير نقطة استلام. اختر نقطة الاستلام وأضفه تاني.';

  @override
  String get checkoutBlockerHatlyDefaultPickupMissing =>
      'نقطة البداية الافتراضية لهاتلي لسه متظبطتش. اختر نقطة بداية لطلبك.';

  @override
  String get checkoutBlockerHatlyDefaultDestinationMissing =>
      'الوجهة الافتراضية لهاتلي لسه متظبطتش. اختر وجهة لطلبك.';

  @override
  String get checkoutBlockerWasallyDefaultDestinationMissing =>
      'الوجهة الافتراضية لوصّلي لسه متظبطتش. اختر وجهة لطلبك.';

  @override
  String get orderPartCancelledTitle => 'تم إلغاء جزء من طلبك';

  @override
  String orderPartCancelledBody(int rejected, int total) {
    return 'تعذّر على $rejected من $total بائعين تجهيز جزئهم. يستمر باقي طلبك.';
  }

  @override
  String get orderPartCancelledNoCharge =>
      'لن يتم تحصيل مبلغ الجزء الملغي منك.';

  @override
  String orderRejectionReasonLine(String reason) {
    return 'السبب: $reason';
  }

  @override
  String orderRefundWalletLine(String amount) {
    return 'تمت إعادة $amount إلى محفظتك.';
  }

  @override
  String orderRefundTransferPendingLine(String amount) {
    return 'سيعيد لك هاتلي مبلغ $amount. سنحدّث الحالة عند إرساله.';
  }

  @override
  String orderRefundTransferSentLine(String amount) {
    return 'تم إرسال $amount إليك.';
  }

  @override
  String orderRefundReviewLine(String amount) {
    return 'سيتم تسوية $amount بعد مراجعة دفعتك.';
  }

  @override
  String get notificationOrderPartCancelledTitle => 'تم إلغاء جزء من طلبك';

  @override
  String notificationOrderPartCancelledBody(String orderNumber) {
    return 'تعذّر على أحد البائعين تجهيز جزئه من الطلب رقم $orderNumber. يستمر باقي طلبك.';
  }

  @override
  String get itemUnavailableTitle => 'بعض المنتجات غير متوفرة';

  @override
  String get itemUnavailableBody =>
      'لا يمكن تجهيز هذه المنتجات. اختر كيف تريد المتابعة — لن يتغير شيء حتى تقرر.';

  @override
  String get itemUnavailableContinue => 'المتابعة بدونها';

  @override
  String get itemUnavailableCancel => 'إلغاء الطلب كاملًا';

  @override
  String get itemUnavailableCancelConfirmTitle => 'إلغاء الطلب كاملًا؟';

  @override
  String get itemUnavailableCancelConfirmBody =>
      'سنحوّل طلبك إلى فريقنا لإلغاء هذا الطلب. تُرد المبالغ المدفوعة مسبقًا وفق قواعدنا المعتادة.';

  @override
  String get itemUnavailableCancelConfirmAction => 'نعم، ألغِ الطلب';

  @override
  String get itemUnavailableKeepOrder => 'الإبقاء على الطلب';

  @override
  String get itemUnavailableCancelRequested =>
      'استلمنا طلب الإلغاء. سيعالجه فريقنا ويتواصل معك عند الحاجة.';

  @override
  String get itemUnavailableTeamContact =>
      'سيتواصل معك فريقنا بخصوص هذا الطلب.';

  @override
  String get itemUnavailableDone => 'تم — يستمر طلبك بدون هذه المنتجات.';

  @override
  String get itemUnavailableError => 'تعذّر إرسال إجابتك. حاول مرة أخرى.';

  @override
  String get orderRemovedItemsTitle => 'تمت إزالتها من طلبك';

  @override
  String get notificationItemUnavailableTitle => 'منتج في طلبك غير متوفر';

  @override
  String notificationItemUnavailableBody(String orderNumber) {
    return 'افتح الطلب رقم $orderNumber للمتابعة بدون المنتج أو لإلغاء الطلب.';
  }

  @override
  String get cartCompatTitle => 'لا يمكن إضافة هذا المنتج الآن';

  @override
  String get cartCompatMultiVendorDisabled =>
      'الطلب من أكثر من متجر غير متاح حاليًا. أكمل طلبك الحالي أو أفرغ السلة لتطلب من متجر آخر.';

  @override
  String get cartCompatBranchPickupDisabled =>
      'هذا المتجر لا يوفّر الاستلام من الفرع.';

  @override
  String get cartCompatSwitchToDelivery => 'التحويل إلى التوصيل وإضافة المنتج';

  @override
  String get cartCompatStartNewCart => 'إفراغ السلة وإضافة المنتج';

  @override
  String get cartCompatKeepCart => 'الإبقاء على سلتي';

  @override
  String get cartCompatOk => 'حسنًا';

  @override
  String get addressOpenLocationSettings => 'فتح إعدادات الموقع';

  @override
  String get weightInlineLabel => 'أو اكتب الوزن بالكيلوغرام';

  @override
  String weightEstimateNote(String price) {
    return 'التقدير: $price — يُحدَّد السعر النهائي حسب الوزن الفعلي عند التجهيز.';
  }

  @override
  String get vendorClosedToday => 'مغلق اليوم';

  @override
  String get vendorOpen24Hours => 'مفتوح 24 ساعة';

  @override
  String vendorHoursToday(String hours) {
    return 'مواعيد اليوم: $hours';
  }

  @override
  String vendorClosedDialogTitle(String name) {
    return '$name مغلق الآن';
  }

  @override
  String get vendorClosedDialogBody =>
      'يمكنك تصفّح القائمة، لكن لا يمكن الطلب حتى يفتح المتجر.';

  @override
  String get vendorClosedDialogClose => 'إغلاق';

  @override
  String get vendorClosedDialogViewMenu => 'عرض القائمة';

  @override
  String get vendorClosedBanner =>
      'مغلق الآن — يمكنك تصفّح القائمة والطلب عند فتح المتجر.';

  @override
  String get checkoutErrorStoreClosed =>
      'أحد المتاجر في سلتك مغلق الآن. احذف منتجاته أو اطلب عند فتحه.';

  @override
  String get tempPasswordTitle => 'اختر كلمة مرور جديدة';

  @override
  String get tempPasswordExplanation =>
      'دخلت بكلمة مرور مؤقتة من هتلي. اختر كلمة مرور خاصة بك للمتابعة.';

  @override
  String get tempPasswordCurrentLabel => 'كلمة المرور المؤقتة';

  @override
  String get tempPasswordConfirmLabel => 'أعد كتابة كلمة المرور الجديدة';

  @override
  String get tempPasswordSave => 'حفظ ومتابعة';

  @override
  String get tempPasswordSignOut => 'تسجيل الخروج';

  @override
  String get tempPasswordMismatch => 'كلمتا المرور الجديدتان غير متطابقتين.';

  @override
  String get tempPasswordSameAsTemporary => 'اختر كلمة مرور مختلفة عن المؤقتة.';

  @override
  String get forgotPasswordLink => 'نسيت كلمة المرور؟';

  @override
  String get forgotTitle => 'نسيت كلمة المرور؟';

  @override
  String get forgotExplain =>
      'أرسل طلبًا إلى هتلي. سنتصل بك للتأكد أنك أنت ونعطيك كلمة مرور مؤقتة (صالحة 60 دقيقة).';

  @override
  String get forgotSend => 'إرسال الطلب';

  @override
  String get forgotHaveTemp => 'لدي كلمة مرور مؤقتة';

  @override
  String get forgotSent =>
      'تم إرسال الطلب. عندما تعطيك هتلي كلمة مرور مؤقتة، اكتبها هنا مع كلمة مرورك الجديدة.';

  @override
  String get forgotTempLabel => 'كلمة المرور المؤقتة';

  @override
  String get forgotNewLabel => 'كلمة المرور الجديدة';

  @override
  String get forgotConfirmLabel => 'أعد كتابة كلمة المرور الجديدة';

  @override
  String get forgotChange => 'تغيير كلمة المرور';

  @override
  String get forgotDone => 'تم تغيير كلمة المرور. ادخل بها الآن.';

  @override
  String get forgotBackToSignIn => 'العودة لتسجيل الدخول';

  @override
  String get forgotCancel => 'إلغاء — أتذكر كلمة المرور';

  @override
  String get forgotTempInvalid =>
      'كلمة المرور المؤقتة غير صحيحة (أو لم تُعطَ بعد).';

  @override
  String forgotTriesLeft(String n) {
    return 'متبقٍ $n محاولات.';
  }

  @override
  String get forgotExpired =>
      'انتهت صلاحية كلمة المرور المؤقتة. أرسل طلبًا جديدًا.';

  @override
  String get forgotLocked => 'محاولات خاطئة كثيرة. أرسل طلبًا جديدًا.';

  @override
  String get addressVillageLabel => 'القرية / الحي';

  @override
  String get addressVillageRequired => 'اختر قريتك أو حيّك';
  @override
  String get homeDeliverTo => 'التوصيل إلى';

  @override
  String get profileSettings => 'الإعدادات';

  @override
  String get settingsLanguage => 'اللغة';

  @override
  String get languageArabic => 'العربية';

  @override
  String get languageEnglish => 'English';

  @override
  String get settingsPasswordSection => 'كلمة المرور والأمان';

  @override
  String get settingsAccountSection => 'الحساب';

  @override
  String get settingsAppSection => 'التطبيق';

  @override
  String get searchFilterVendors => 'متاجر';

  @override
  String get searchFilterProducts => 'منتجات';
  @override
  String get vendorCustomBubbleLabel => 'اطلب صنف';

  @override
  String get sectorHatlyExistingWasaly => 'لديك طلب «وصّلي لمكان» موجود بالفعل في السلة. هذه الصفحة تتيح «هاتلي من مكان» فقط. راجع السلة أولاً؛ لن يتم تغيير طلبك الحالي.';

}
