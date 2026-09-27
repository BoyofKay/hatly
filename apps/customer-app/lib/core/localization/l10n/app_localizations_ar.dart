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
      'عيّن كلمة مرور لتتمكن من تسجيل الدخول أيضًا بدون رمز عبر رسالة نصية.';

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
  String get customRequestSheetTitle => 'اطلب صنفًا مخصصًا';

  @override
  String get customRequestSheetSubtitle =>
      'صف ما تحتاجه و/أو أضف صورة — سنرسلها إلى المتجر.';

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
  String get homeSectionPopularNew => 'الأكثر طلبًا والجديد';

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
      'لا يمكن الجمع بين منتجات المتاجر وخدمة هاتلي في سلة واحدة. أفرغ السلة للتبديل.';

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
  String get checkoutNoElectronicMethods =>
      'لا توجد وسائل دفع إلكتروني متاحة حاليًا';

  @override
  String get checkoutTransferUnavailable => 'التحويل اليدوي غير متاح حاليًا';

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
  String get checkoutBlockerUnavailable =>
      'أحد المنتجات أو المتاجر في سلتك غير متاح حاليًا';

  @override
  String get checkoutBlockerMultiVendorDisabled =>
      'الطلب من أكثر من متجر غير متاح حاليًا';

  @override
  String get checkoutBlockerFeeUnavailable =>
      'تعذّر حساب رسوم التوصيل الآن. حاول مرة أخرى بعد قليل.';

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
      'لم نجد هذا العنوان. جرّب صياغة أخرى أو استخدم موقعك الحالي.';

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
  String get addressBuildingLabel => 'رقم العقار';

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
}
