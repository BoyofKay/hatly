import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en')
  ];

  /// No description provided for @appName.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي'**
  String get appName;

  /// No description provided for @home.
  ///
  /// In ar, this message translates to:
  /// **'الرئيسية'**
  String get home;

  /// No description provided for @search.
  ///
  /// In ar, this message translates to:
  /// **'بحث'**
  String get search;

  /// No description provided for @cart.
  ///
  /// In ar, this message translates to:
  /// **'السلة'**
  String get cart;

  /// No description provided for @orders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات'**
  String get orders;

  /// No description provided for @favorites.
  ///
  /// In ar, this message translates to:
  /// **'المفضلة'**
  String get favorites;

  /// No description provided for @favoritesAddAction.
  ///
  /// In ar, this message translates to:
  /// **'إضافة إلى المفضلة'**
  String get favoritesAddAction;

  /// No description provided for @favoritesRemoveAction.
  ///
  /// In ar, this message translates to:
  /// **'إزالة من المفضلة'**
  String get favoritesRemoveAction;

  /// No description provided for @favoritesEmptyState.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد متاجر مفضلة بعد'**
  String get favoritesEmptyState;

  /// No description provided for @favoritesEmptyStateSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'اضغط على القلب في أي متجر لحفظه هنا'**
  String get favoritesEmptyStateSubtitle;

  /// No description provided for @profile.
  ///
  /// In ar, this message translates to:
  /// **'حسابي'**
  String get profile;

  /// No description provided for @vendorsNearYou.
  ///
  /// In ar, this message translates to:
  /// **'متاجر بالقرب منك'**
  String get vendorsNearYou;

  /// No description provided for @addToCart.
  ///
  /// In ar, this message translates to:
  /// **'أضف إلى السلة'**
  String get addToCart;

  /// No description provided for @checkout.
  ///
  /// In ar, this message translates to:
  /// **'إتمام الطلب'**
  String get checkout;

  /// No description provided for @placeOrder.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب'**
  String get placeOrder;

  /// No description provided for @orderTracking.
  ///
  /// In ar, this message translates to:
  /// **'تتبع الطلب'**
  String get orderTracking;

  /// No description provided for @deliveryFee.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل'**
  String get deliveryFee;

  /// No description provided for @retry.
  ///
  /// In ar, this message translates to:
  /// **'إعادة المحاولة'**
  String get retry;

  /// No description provided for @somethingWentWrong.
  ///
  /// In ar, this message translates to:
  /// **'حدث خطأ ما'**
  String get somethingWentWrong;

  /// No description provided for @logout.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج'**
  String get logout;

  /// No description provided for @authWelcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'مرحبًا بك في هاتلي'**
  String get authWelcomeTitle;

  /// No description provided for @authWelcomeSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هاتفك للمتابعة'**
  String get authWelcomeSubtitle;

  /// No description provided for @fullNameLabel.
  ///
  /// In ar, this message translates to:
  /// **'الاسم الكامل'**
  String get fullNameLabel;

  /// No description provided for @fullNameHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: أحمد محمد'**
  String get fullNameHint;

  /// No description provided for @phoneNumberLabel.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف'**
  String get phoneNumberLabel;

  /// No description provided for @continueButton.
  ///
  /// In ar, this message translates to:
  /// **'متابعة'**
  String get continueButton;

  /// No description provided for @passwordLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور'**
  String get passwordLabel;

  /// No description provided for @passwordHint.
  ///
  /// In ar, this message translates to:
  /// **'8 أحرف على الأقل'**
  String get passwordHint;

  /// No description provided for @passwordRequired.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إدخال كلمة المرور'**
  String get passwordRequired;

  /// No description provided for @passwordCreateAccountInstead.
  ///
  /// In ar, this message translates to:
  /// **'جديد هنا؟ أنشئ حسابًا بدلاً من ذلك'**
  String get passwordCreateAccountInstead;

  /// No description provided for @passwordHaveAccountInstead.
  ///
  /// In ar, this message translates to:
  /// **'هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك'**
  String get passwordHaveAccountInstead;

  /// No description provided for @verifyPhonePromptTitle.
  ///
  /// In ar, this message translates to:
  /// **'تحقق من رقم هاتفك'**
  String get verifyPhonePromptTitle;

  /// No description provided for @verifyPhonePromptSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'احصل على أمان إضافي لحسابك بتأكيد رقمك.'**
  String get verifyPhonePromptSubtitle;

  /// No description provided for @verifyPhonePromptAction.
  ///
  /// In ar, this message translates to:
  /// **'تحقق'**
  String get verifyPhonePromptAction;

  /// No description provided for @verifyPhonePromptDismiss.
  ///
  /// In ar, this message translates to:
  /// **'ليس الآن'**
  String get verifyPhonePromptDismiss;

  /// No description provided for @verifyPhoneSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم التحقق من الهاتف.'**
  String get verifyPhoneSuccess;

  /// No description provided for @passwordSetupSectionTitle.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور'**
  String get passwordSetupSectionTitle;

  /// No description provided for @passwordSetupSectionSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'عيّن كلمة مرور لتتمكن من تسجيل الدخول أيضًا بدون رمز عبر رسالة نصية.'**
  String get passwordSetupSectionSubtitle;

  /// No description provided for @passwordSetupSaveButton.
  ///
  /// In ar, this message translates to:
  /// **'حفظ كلمة المرور'**
  String get passwordSetupSaveButton;

  /// No description provided for @passwordSetupSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم حفظ كلمة المرور.'**
  String get passwordSetupSuccess;

  /// No description provided for @phoneInvalid.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف غير صحيح'**
  String get phoneInvalid;

  /// No description provided for @fullNameRequired.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إدخال الاسم الكامل'**
  String get fullNameRequired;

  /// No description provided for @otpTitle.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رمز التحقق'**
  String get otpTitle;

  /// No description provided for @otpSubtitleWithPhone.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال رمز مكون من 6 أرقام إلى {phone}'**
  String otpSubtitleWithPhone(String phone);

  /// No description provided for @otpVerifyButton.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد'**
  String get otpVerifyButton;

  /// No description provided for @otpResendIn.
  ///
  /// In ar, this message translates to:
  /// **'إعادة الإرسال خلال {seconds} ثانية'**
  String otpResendIn(int seconds);

  /// No description provided for @otpResendAction.
  ///
  /// In ar, this message translates to:
  /// **'إعادة إرسال الرمز'**
  String get otpResendAction;

  /// No description provided for @otpChangeNumber.
  ///
  /// In ar, this message translates to:
  /// **'تغيير رقم الهاتف'**
  String get otpChangeNumber;

  /// No description provided for @errorNetwork.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى'**
  String get errorNetwork;

  /// No description provided for @errorInvalidOtp.
  ///
  /// In ar, this message translates to:
  /// **'رمز التحقق غير صحيح'**
  String get errorInvalidOtp;

  /// No description provided for @errorInvalidOrExpiredOtp.
  ///
  /// In ar, this message translates to:
  /// **'الرمز غير صحيح أو منتهي الصلاحية'**
  String get errorInvalidOrExpiredOtp;

  /// No description provided for @errorTooManyAttempts.
  ///
  /// In ar, this message translates to:
  /// **'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل'**
  String get errorTooManyAttempts;

  /// No description provided for @errorSmsProviderUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إرسال رمز التحقق حاليًا. برجاء المحاولة لاحقًا'**
  String get errorSmsProviderUnavailable;

  /// No description provided for @homeComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'قريبًا: تصفح المتاجر والمنتجات'**
  String get homeComingSoon;

  /// No description provided for @searchComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'قريبًا: البحث'**
  String get searchComingSoon;

  /// No description provided for @ordersComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'قريبًا: طلباتك'**
  String get ordersComingSoon;

  /// No description provided for @favoritesComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'قريبًا: المفضلة لديك'**
  String get favoritesComingSoon;

  /// No description provided for @profileComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'الملف الشخصي'**
  String get profileComingSoon;

  /// No description provided for @greetingGeneric.
  ///
  /// In ar, this message translates to:
  /// **'أهلًا بك 👋'**
  String get greetingGeneric;

  /// No description provided for @greetingWithName.
  ///
  /// In ar, this message translates to:
  /// **'أهلًا، {name} 👋'**
  String greetingWithName(String name);

  /// No description provided for @selectAddressCta.
  ///
  /// In ar, this message translates to:
  /// **'اختر عنوان التوصيل'**
  String get selectAddressCta;

  /// No description provided for @selectAddressTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختر عنوانًا'**
  String get selectAddressTitle;

  /// No description provided for @addressHome.
  ///
  /// In ar, this message translates to:
  /// **'المنزل'**
  String get addressHome;

  /// No description provided for @addressWork.
  ///
  /// In ar, this message translates to:
  /// **'العمل'**
  String get addressWork;

  /// No description provided for @searchHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن متاجر أو منتجات'**
  String get searchHint;

  /// No description provided for @searchComingSoonSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'ميزة البحث قيد التطوير'**
  String get searchComingSoonSubtitle;

  /// No description provided for @categoryRestaurants.
  ///
  /// In ar, this message translates to:
  /// **'مطاعم'**
  String get categoryRestaurants;

  /// No description provided for @categoryGroceries.
  ///
  /// In ar, this message translates to:
  /// **'بقالة'**
  String get categoryGroceries;

  /// No description provided for @categoryPharmacy.
  ///
  /// In ar, this message translates to:
  /// **'صيدلية'**
  String get categoryPharmacy;

  /// No description provided for @categoryBakery.
  ///
  /// In ar, this message translates to:
  /// **'مخبوزات'**
  String get categoryBakery;

  /// No description provided for @categoryDrinks.
  ///
  /// In ar, this message translates to:
  /// **'مشروبات'**
  String get categoryDrinks;

  /// No description provided for @categoryDesserts.
  ///
  /// In ar, this message translates to:
  /// **'حلويات'**
  String get categoryDesserts;

  /// No description provided for @categoryFastFood.
  ///
  /// In ar, this message translates to:
  /// **'وجبات سريعة'**
  String get categoryFastFood;

  /// No description provided for @seeAll.
  ///
  /// In ar, this message translates to:
  /// **'عرض الكل'**
  String get seeAll;

  /// No description provided for @cartSummaryItemCount.
  ///
  /// In ar, this message translates to:
  /// **'{count} عنصر'**
  String cartSummaryItemCount(int count);

  /// No description provided for @cartSummaryViewCart.
  ///
  /// In ar, this message translates to:
  /// **'عرض السلة'**
  String get cartSummaryViewCart;

  /// No description provided for @vendorClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق'**
  String get vendorClosed;

  /// No description provided for @vendorOpenNow.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح الآن'**
  String get vendorOpenNow;

  /// No description provided for @minutesAbbreviation.
  ///
  /// In ar, this message translates to:
  /// **'د'**
  String get minutesAbbreviation;

  /// No description provided for @noVendorsFound.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد متاجر حاليًا'**
  String get noVendorsFound;

  /// No description provided for @noVendorsFoundSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'جرّب فئة أخرى أو عد لاحقًا'**
  String get noVendorsFoundSubtitle;

  /// No description provided for @vendorDetailsComingSoon.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل المتجر — قريبًا'**
  String get vendorDetailsComingSoon;

  /// No description provided for @promotionBadge.
  ///
  /// In ar, this message translates to:
  /// **'عرض خاص'**
  String get promotionBadge;

  /// No description provided for @allProducts.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get allProducts;

  /// No description provided for @noProductsFound.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد منتجات في هذا القسم'**
  String get noProductsFound;

  /// No description provided for @searchSectionVendors.
  ///
  /// In ar, this message translates to:
  /// **'المتاجر'**
  String get searchSectionVendors;

  /// No description provided for @searchSectionProducts.
  ///
  /// In ar, this message translates to:
  /// **'المنتجات'**
  String get searchSectionProducts;

  /// No description provided for @searchPromptMinLength.
  ///
  /// In ar, this message translates to:
  /// **'اكتب حرفين على الأقل للبحث'**
  String get searchPromptMinLength;

  /// No description provided for @searchNoResultsForQuery.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد نتائج لـ \"{query}\"'**
  String searchNoResultsForQuery(String query);

  /// No description provided for @ratingRateAction.
  ///
  /// In ar, this message translates to:
  /// **'قيّم'**
  String get ratingRateAction;

  /// No description provided for @ratingYourRatingLabel.
  ///
  /// In ar, this message translates to:
  /// **'تقييمك'**
  String get ratingYourRatingLabel;

  /// No description provided for @ratingCommentHint.
  ///
  /// In ar, this message translates to:
  /// **'أضف تعليقًا (اختياري)'**
  String get ratingCommentHint;

  /// No description provided for @ratingSubmitButton.
  ///
  /// In ar, this message translates to:
  /// **'إرسال التقييم'**
  String get ratingSubmitButton;

  /// No description provided for @ratingSubmittedSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال التقييم'**
  String get ratingSubmittedSuccess;

  /// No description provided for @ratingSelectStarsPrompt.
  ///
  /// In ar, this message translates to:
  /// **'اختر تقييمًا'**
  String get ratingSelectStarsPrompt;

  /// No description provided for @flashSaleBadge.
  ///
  /// In ar, this message translates to:
  /// **'تخفيض سريع'**
  String get flashSaleBadge;

  /// No description provided for @cartSubtotalDiscountBanner.
  ///
  /// In ar, this message translates to:
  /// **'يوجد خصم على المنتجات المؤهلة من هذا المتجر'**
  String get cartSubtotalDiscountBanner;

  /// No description provided for @subtotalDiscountAvailable.
  ///
  /// In ar, this message translates to:
  /// **'يوجد خصم'**
  String get subtotalDiscountAvailable;

  /// No description provided for @checkoutErrorFlashSaleLimit.
  ///
  /// In ar, this message translates to:
  /// **'لم تعد هذه الكمية بسعر التخفيض السريع متاحة. يرجى مراجعة سلتك والمحاولة مرة أخرى.'**
  String get checkoutErrorFlashSaleLimit;

  /// No description provided for @checkoutErrorFlashSaleLimitWithRemaining.
  ///
  /// In ar, this message translates to:
  /// **'لم يتبق سوى {remaining} بسعر التخفيض السريع. يرجى تعديل الكمية والمحاولة مرة أخرى.'**
  String checkoutErrorFlashSaleLimitWithRemaining(String remaining);

  /// No description provided for @checkoutErrorInsufficientInventory.
  ///
  /// In ar, this message translates to:
  /// **'لا تتوفر كمية كافية لمنتج واحد أو أكثر في سلتك.'**
  String get checkoutErrorInsufficientInventory;

  /// No description provided for @checkoutErrorOfferConflict.
  ///
  /// In ar, this message translates to:
  /// **'هذا العرض لم يعد متاحًا. يرجى مراجعة سلتك والمحاولة مرة أخرى.'**
  String get checkoutErrorOfferConflict;

  /// No description provided for @orderHistoricalDiscountApplied.
  ///
  /// In ar, this message translates to:
  /// **'تم تطبيق خصم: {amount}'**
  String orderHistoricalDiscountApplied(String amount);

  /// No description provided for @orderHistoricalFlashSalePrice.
  ///
  /// In ar, this message translates to:
  /// **'سعر التخفيض السريع: {price}'**
  String orderHistoricalFlashSalePrice(String price);

  /// No description provided for @customRequestEntryPoint.
  ///
  /// In ar, this message translates to:
  /// **'لم تجد ما تبحث عنه؟'**
  String get customRequestEntryPoint;

  /// No description provided for @customRequestSheetTitle.
  ///
  /// In ar, this message translates to:
  /// **'اطلب صنفًا مخصصًا'**
  String get customRequestSheetTitle;

  /// No description provided for @customRequestSheetSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'صف ما تحتاجه و/أو أضف صورة — سنرسلها إلى المتجر.'**
  String get customRequestSheetSubtitle;

  /// No description provided for @customRequestTextHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: بانادول إكسترا 500 مجم، أي نوع متاح'**
  String get customRequestTextHint;

  /// No description provided for @customRequestImageLimitHint.
  ///
  /// In ar, this message translates to:
  /// **'حتى {max} صور'**
  String customRequestImageLimitHint(int max);

  /// No description provided for @customRequestSubmit.
  ///
  /// In ar, this message translates to:
  /// **'أضف إلى السلة'**
  String get customRequestSubmit;

  /// No description provided for @cartCustomRequestBadge.
  ///
  /// In ar, this message translates to:
  /// **'طلب مخصص'**
  String get cartCustomRequestBadge;

  /// No description provided for @cartCustomRequestPricePending.
  ///
  /// In ar, this message translates to:
  /// **'سيتم تأكيد السعر'**
  String get cartCustomRequestPricePending;

  /// No description provided for @productOptionsTitle.
  ///
  /// In ar, this message translates to:
  /// **'خيارات المنتج'**
  String get productOptionsTitle;

  /// No description provided for @productUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متوفر حاليًا'**
  String get productUnavailable;

  /// No description provided for @optionRequiredBadge.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب'**
  String get optionRequiredBadge;

  /// No description provided for @quantityLabel.
  ///
  /// In ar, this message translates to:
  /// **'الكمية'**
  String get quantityLabel;

  /// No description provided for @addToCartWithPrice.
  ///
  /// In ar, this message translates to:
  /// **'أضف إلى السلة — {price}'**
  String addToCartWithPrice(String price);

  /// No description provided for @addedToCartConfirmation.
  ///
  /// In ar, this message translates to:
  /// **'تمت الإضافة إلى السلة'**
  String get addedToCartConfirmation;

  /// No description provided for @cancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get cancel;

  /// No description provided for @cartEmpty.
  ///
  /// In ar, this message translates to:
  /// **'سلتك فارغة'**
  String get cartEmpty;

  /// No description provided for @cartSubtotal.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي الفرعي'**
  String get cartSubtotal;

  /// No description provided for @cartNotReadyForCheckout.
  ///
  /// In ar, this message translates to:
  /// **'الدفع غير جاهز بعد. يرجى إكمال العناصر المعلقة قبل تقديم الطلب.'**
  String get cartNotReadyForCheckout;

  /// No description provided for @cartItemNoLongerAvailable.
  ///
  /// In ar, this message translates to:
  /// **'لم يعد متوفرًا'**
  String get cartItemNoLongerAvailable;

  /// No description provided for @cartBranchConflictTitle.
  ///
  /// In ar, this message translates to:
  /// **'لديك عناصر من متجر آخر'**
  String get cartBranchConflictTitle;

  /// No description provided for @cartBranchConflictMessage.
  ///
  /// In ar, this message translates to:
  /// **'سلتك تحتوي على عناصر من متجر آخر. امسح السلة لإضافة عناصر من هذا المتجر.'**
  String get cartBranchConflictMessage;

  /// No description provided for @cartBranchConflictClearAndAdd.
  ///
  /// In ar, this message translates to:
  /// **'امسح وأضف'**
  String get cartBranchConflictClearAndAdd;

  /// No description provided for @cartErrorProductUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا المنتج غير متوفر حاليًا'**
  String get cartErrorProductUnavailable;

  /// No description provided for @cartErrorBranchUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا المتجر غير متاح حاليًا'**
  String get cartErrorBranchUnavailable;

  /// No description provided for @cartErrorOptionRequired.
  ///
  /// In ar, this message translates to:
  /// **'يرجى اختيار كل الخيارات المطلوبة'**
  String get cartErrorOptionRequired;

  /// No description provided for @cartErrorInvalidOption.
  ///
  /// In ar, this message translates to:
  /// **'أحد الخيارات المحددة غير صالح'**
  String get cartErrorInvalidOption;

  /// No description provided for @noOrdersYet.
  ///
  /// In ar, this message translates to:
  /// **'لم تقم بأي طلبات بعد'**
  String get noOrdersYet;

  /// No description provided for @orderVendorSummaryWithOthers.
  ///
  /// In ar, this message translates to:
  /// **'{vendorName} + {othersCount} آخرين'**
  String orderVendorSummaryWithOthers(String vendorName, int othersCount);

  /// No description provided for @orderDetailsTitle.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الطلب'**
  String get orderDetailsTitle;

  /// No description provided for @orderItemsTitle.
  ///
  /// In ar, this message translates to:
  /// **'العناصر'**
  String get orderItemsTitle;

  /// No description provided for @orderPaymentTitle.
  ///
  /// In ar, this message translates to:
  /// **'الدفع'**
  String get orderPaymentTitle;

  /// No description provided for @orderDriverTitle.
  ///
  /// In ar, this message translates to:
  /// **'سائق التوصيل'**
  String get orderDriverTitle;

  /// No description provided for @orderTotalLabel.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي'**
  String get orderTotalLabel;

  /// No description provided for @orderDiscountLabel.
  ///
  /// In ar, this message translates to:
  /// **'الخصم'**
  String get orderDiscountLabel;

  /// No description provided for @orderCancellationReasonLabel.
  ///
  /// In ar, this message translates to:
  /// **'سبب الإلغاء'**
  String get orderCancellationReasonLabel;

  /// No description provided for @orderFailureReasonLabel.
  ///
  /// In ar, this message translates to:
  /// **'فشل التوصيل'**
  String get orderFailureReasonLabel;

  /// No description provided for @orderRequestedWeightLabel.
  ///
  /// In ar, this message translates to:
  /// **'المطلوب'**
  String get orderRequestedWeightLabel;

  /// No description provided for @orderActualWeightLabel.
  ///
  /// In ar, this message translates to:
  /// **'الوزن الفعلي'**
  String get orderActualWeightLabel;

  /// No description provided for @orderStatusPending.
  ///
  /// In ar, this message translates to:
  /// **'تم تقديم الطلب'**
  String get orderStatusPending;

  /// No description provided for @orderStatusConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تم التأكيد'**
  String get orderStatusConfirmed;

  /// No description provided for @orderStatusPreparing.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ التحضير'**
  String get orderStatusPreparing;

  /// No description provided for @orderStatusReadyForPickup.
  ///
  /// In ar, this message translates to:
  /// **'جاهز للاستلام'**
  String get orderStatusReadyForPickup;

  /// No description provided for @orderStatusAssignedToDriver.
  ///
  /// In ar, this message translates to:
  /// **'تم تعيين السائق'**
  String get orderStatusAssignedToDriver;

  /// No description provided for @orderStatusPickedUp.
  ///
  /// In ar, this message translates to:
  /// **'تم الاستلام'**
  String get orderStatusPickedUp;

  /// No description provided for @orderStatusOnTheWay.
  ///
  /// In ar, this message translates to:
  /// **'في الطريق'**
  String get orderStatusOnTheWay;

  /// No description provided for @orderStatusDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التوصيل'**
  String get orderStatusDelivered;

  /// No description provided for @orderStatusCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغى'**
  String get orderStatusCancelled;

  /// No description provided for @orderStatusFailedDelivery.
  ///
  /// In ar, this message translates to:
  /// **'فشل التوصيل'**
  String get orderStatusFailedDelivery;

  /// No description provided for @sortLabel.
  ///
  /// In ar, this message translates to:
  /// **'الترتيب'**
  String get sortLabel;

  /// No description provided for @sortNewest.
  ///
  /// In ar, this message translates to:
  /// **'الأحدث'**
  String get sortNewest;

  /// No description provided for @sortHighestRated.
  ///
  /// In ar, this message translates to:
  /// **'الأعلى تقييمًا'**
  String get sortHighestRated;

  /// No description provided for @sortBestSelling.
  ///
  /// In ar, this message translates to:
  /// **'الأكثر مبيعًا'**
  String get sortBestSelling;

  /// No description provided for @sortPriceLowToHigh.
  ///
  /// In ar, this message translates to:
  /// **'السعر: من الأقل إلى الأعلى'**
  String get sortPriceLowToHigh;

  /// No description provided for @sortPriceHighToLow.
  ///
  /// In ar, this message translates to:
  /// **'السعر: من الأعلى إلى الأقل'**
  String get sortPriceHighToLow;

  /// No description provided for @checkoutTitle.
  ///
  /// In ar, this message translates to:
  /// **'إتمام الطلب'**
  String get checkoutTitle;

  /// No description provided for @checkoutAddressLabel.
  ///
  /// In ar, this message translates to:
  /// **'عنوان التوصيل'**
  String get checkoutAddressLabel;

  /// No description provided for @checkoutAddressLine1Hint.
  ///
  /// In ar, this message translates to:
  /// **'الشارع، المبنى، الطابق...'**
  String get checkoutAddressLine1Hint;

  /// No description provided for @checkoutAddressLatitudeHint.
  ///
  /// In ar, this message translates to:
  /// **'خط العرض'**
  String get checkoutAddressLatitudeHint;

  /// No description provided for @checkoutAddressLongitudeHint.
  ///
  /// In ar, this message translates to:
  /// **'خط الطول'**
  String get checkoutAddressLongitudeHint;

  /// No description provided for @checkoutAddressInstructionsHint.
  ///
  /// In ar, this message translates to:
  /// **'تعليمات التوصيل (اختياري)'**
  String get checkoutAddressInstructionsHint;

  /// No description provided for @checkoutPaymentMethodLabel.
  ///
  /// In ar, this message translates to:
  /// **'طريقة الدفع'**
  String get checkoutPaymentMethodLabel;

  /// No description provided for @checkoutPaymentCod.
  ///
  /// In ar, this message translates to:
  /// **'الدفع عند الاستلام'**
  String get checkoutPaymentCod;

  /// No description provided for @checkoutPaymentPayAtDelivery.
  ///
  /// In ar, this message translates to:
  /// **'الدفع إلكترونيًا عند التوصيل'**
  String get checkoutPaymentPayAtDelivery;

  /// No description provided for @checkoutPaymentInstapay.
  ///
  /// In ar, this message translates to:
  /// **'إنستاباي'**
  String get checkoutPaymentInstapay;

  /// No description provided for @checkoutPaymentWallet.
  ///
  /// In ar, this message translates to:
  /// **'تحويل محفظة إلكترونية'**
  String get checkoutPaymentWallet;

  /// No description provided for @checkoutSubtotalLabel.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي الفرعي'**
  String get checkoutSubtotalLabel;

  /// No description provided for @checkoutPlaceOrderButton.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب'**
  String get checkoutPlaceOrderButton;

  /// No description provided for @checkoutOrderPlacedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم تقديم الطلب'**
  String get checkoutOrderPlacedTitle;

  /// No description provided for @transferInstructionsTitle.
  ///
  /// In ar, this message translates to:
  /// **'أكمل عملية الدفع'**
  String get transferInstructionsTitle;

  /// No description provided for @transferDestinationLabel.
  ///
  /// In ar, this message translates to:
  /// **'أرسل المبلغ إلى'**
  String get transferDestinationLabel;

  /// No description provided for @transferAmountLabel.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ المطلوب إرساله'**
  String get transferAmountLabel;

  /// No description provided for @transferSendProofButton.
  ///
  /// In ar, this message translates to:
  /// **'إرسال إثبات الدفع عبر واتساب'**
  String get transferSendProofButton;

  /// No description provided for @transferAwaitingVerification.
  ///
  /// In ar, this message translates to:
  /// **'طلبك بانتظار التحقق من الدفع. سنقوم بتحديث حالة طلبك فور تأكيده.'**
  String get transferAwaitingVerification;

  /// No description provided for @transferNotAvailable.
  ///
  /// In ar, this message translates to:
  /// **'طريقة الدفع هذه غير متاحة حاليًا — يرجى اختيار طريقة أخرى.'**
  String get transferNotAvailable;

  /// No description provided for @checkoutSelectAddressCta.
  ///
  /// In ar, this message translates to:
  /// **'اختر عنوان التوصيل'**
  String get checkoutSelectAddressCta;

  /// No description provided for @checkoutSelectAddressError.
  ///
  /// In ar, this message translates to:
  /// **'يرجى اختيار عنوان للتوصيل'**
  String get checkoutSelectAddressError;

  /// No description provided for @checkoutCartChangedError.
  ///
  /// In ar, this message translates to:
  /// **'لقد تغيرت سلة مشترياتك — يرجى مراجعتها قبل المتابعة'**
  String get checkoutCartChangedError;

  /// No description provided for @addressSelectTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختر العنوان'**
  String get addressSelectTitle;

  /// No description provided for @addressAddNew.
  ///
  /// In ar, this message translates to:
  /// **'إضافة عنوان جديد'**
  String get addressAddNew;

  /// No description provided for @addressNoneSavedYet.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد عناوين محفوظة بعد'**
  String get addressNoneSavedYet;

  /// No description provided for @addressDeleteConfirmTitle.
  ///
  /// In ar, this message translates to:
  /// **'حذف العنوان؟'**
  String get addressDeleteConfirmTitle;

  /// No description provided for @addressDeleteConfirmMessage.
  ///
  /// In ar, this message translates to:
  /// **'سيتم إزالة هذا العنوان من عناوينك المحفوظة.'**
  String get addressDeleteConfirmMessage;

  /// No description provided for @addressDeleteAction.
  ///
  /// In ar, this message translates to:
  /// **'حذف'**
  String get addressDeleteAction;

  /// No description provided for @addressDeleteError.
  ///
  /// In ar, this message translates to:
  /// **'فشل حذف العنوان. يرجى المحاولة مرة أخرى.'**
  String get addressDeleteError;

  /// No description provided for @addAddressTitle.
  ///
  /// In ar, this message translates to:
  /// **'إضافة عنوان'**
  String get addAddressTitle;

  /// No description provided for @editAddressTitle.
  ///
  /// In ar, this message translates to:
  /// **'تعديل العنوان'**
  String get editAddressTitle;

  /// No description provided for @addressLabelHint.
  ///
  /// In ar, this message translates to:
  /// **'الاسم (مثال: المنزل، العمل)'**
  String get addressLabelHint;

  /// No description provided for @addressUseCurrentLocation.
  ///
  /// In ar, this message translates to:
  /// **'استخدام موقعي الحالي'**
  String get addressUseCurrentLocation;

  /// No description provided for @addressLocationCaptured.
  ///
  /// In ar, this message translates to:
  /// **'تم تحديد الموقع'**
  String get addressLocationCaptured;

  /// No description provided for @addressMissingLocationError.
  ///
  /// In ar, this message translates to:
  /// **'يرجى إدخال العنوان واستخدام الموقع الحالي'**
  String get addressMissingLocationError;

  /// No description provided for @addressSaveButton.
  ///
  /// In ar, this message translates to:
  /// **'حفظ العنوان'**
  String get addressSaveButton;

  /// No description provided for @navExplore.
  ///
  /// In ar, this message translates to:
  /// **'استكشف'**
  String get navExplore;

  /// No description provided for @homeSearchHint.
  ///
  /// In ar, this message translates to:
  /// **'بتدور على إيه؟'**
  String get homeSearchHint;

  /// No description provided for @homeSectionCategories.
  ///
  /// In ar, this message translates to:
  /// **'تسوّق حسب الفئة'**
  String get homeSectionCategories;

  /// No description provided for @homeSectionPopularNearYou.
  ///
  /// In ar, this message translates to:
  /// **'الأشهر بالقرب منك'**
  String get homeSectionPopularNearYou;

  /// No description provided for @homeSectionOffers.
  ///
  /// In ar, this message translates to:
  /// **'العروض'**
  String get homeSectionOffers;

  /// No description provided for @homeSectionPopularNew.
  ///
  /// In ar, this message translates to:
  /// **'الأكثر طلبًا والجديد'**
  String get homeSectionPopularNew;

  /// No description provided for @homeFavoritesShortcut.
  ///
  /// In ar, this message translates to:
  /// **'المفضلة'**
  String get homeFavoritesShortcut;

  /// No description provided for @homePromoCarouselLabel.
  ///
  /// In ar, this message translates to:
  /// **'عروض مميزة'**
  String get homePromoCarouselLabel;

  /// No description provided for @homePromoPageIndicator.
  ///
  /// In ar, this message translates to:
  /// **'العرض {current} من {total}'**
  String homePromoPageIndicator(int current, int total);

  /// No description provided for @promoCtaProduct.
  ///
  /// In ar, this message translates to:
  /// **'أضف للسلة'**
  String get promoCtaProduct;

  /// No description provided for @promoCtaVendor.
  ///
  /// In ar, this message translates to:
  /// **'تسوّق الآن'**
  String get promoCtaVendor;

  /// No description provided for @promoCtaOffer.
  ///
  /// In ar, this message translates to:
  /// **'اكتشف العرض'**
  String get promoCtaOffer;

  /// No description provided for @promoCtaFreeDelivery.
  ///
  /// In ar, this message translates to:
  /// **'اطلب الآن'**
  String get promoCtaFreeDelivery;

  /// No description provided for @promoCtaBundle.
  ///
  /// In ar, this message translates to:
  /// **'شوف الباكدج'**
  String get promoCtaBundle;

  /// No description provided for @badgeOffer.
  ///
  /// In ar, this message translates to:
  /// **'عرض'**
  String get badgeOffer;

  /// No description provided for @badgeFlashSale.
  ///
  /// In ar, this message translates to:
  /// **'عرض سريع'**
  String get badgeFlashSale;

  /// No description provided for @badgeFreeDelivery.
  ///
  /// In ar, this message translates to:
  /// **'توصيل مجاني'**
  String get badgeFreeDelivery;

  /// No description provided for @badgeBundle.
  ///
  /// In ar, this message translates to:
  /// **'باكدج'**
  String get badgeBundle;

  /// No description provided for @badgeNew.
  ///
  /// In ar, this message translates to:
  /// **'جديد'**
  String get badgeNew;

  /// No description provided for @badgePopular.
  ///
  /// In ar, this message translates to:
  /// **'الأكثر طلبًا'**
  String get badgePopular;

  /// No description provided for @badgeUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متاح'**
  String get badgeUnavailable;

  /// No description provided for @vendorEtaMinutes.
  ///
  /// In ar, this message translates to:
  /// **'{range} د'**
  String vendorEtaMinutes(String range);

  /// No description provided for @vendorRatingSemantics.
  ///
  /// In ar, this message translates to:
  /// **'التقييم {rating}'**
  String vendorRatingSemantics(String rating);

  /// No description provided for @homeDemoContentNotice.
  ///
  /// In ar, this message translates to:
  /// **'محتوى تجريبي'**
  String get homeDemoContentNotice;

  /// No description provided for @exploreSearchHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن منتجات أو متاجر أو فئات'**
  String get exploreSearchHint;

  /// No description provided for @exploreSearchClear.
  ///
  /// In ar, this message translates to:
  /// **'مسح البحث'**
  String get exploreSearchClear;

  /// No description provided for @exploreSearchCategories.
  ///
  /// In ar, this message translates to:
  /// **'الفئات'**
  String get exploreSearchCategories;

  /// No description provided for @exploreSectionFeaturedCategories.
  ///
  /// In ar, this message translates to:
  /// **'فئات مميزة'**
  String get exploreSectionFeaturedCategories;

  /// No description provided for @exploreSectionFeaturedVendors.
  ///
  /// In ar, this message translates to:
  /// **'متاجر مميزة'**
  String get exploreSectionFeaturedVendors;

  /// No description provided for @exploreSectionNew.
  ///
  /// In ar, this message translates to:
  /// **'جديد على هاتلي'**
  String get exploreSectionNew;

  /// No description provided for @exploreLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل الاستكشاف'**
  String get exploreLoadFailed;

  /// No description provided for @exploreSeeLess.
  ///
  /// In ar, this message translates to:
  /// **'عرض أقل'**
  String get exploreSeeLess;

  /// No description provided for @categoryProductsSearchHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث في المنتجات'**
  String get categoryProductsSearchHint;

  /// No description provided for @categoryProductsEmptySubtitle.
  ///
  /// In ar, this message translates to:
  /// **'جرّب كلمة بحث أخرى أو عد لاحقًا'**
  String get categoryProductsEmptySubtitle;

  /// No description provided for @catalogStartsFrom.
  ///
  /// In ar, this message translates to:
  /// **'يبدأ من {price}'**
  String catalogStartsFrom(String price);

  /// No description provided for @catalogStoreCount.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =1{متجر واحد} =2{متجران} few{{count} متاجر} many{{count} متجرًا} other{{count} متجر}}'**
  String catalogStoreCount(int count);

  /// No description provided for @catalogAvailableFromStores.
  ///
  /// In ar, this message translates to:
  /// **'متوفر من {count, plural, =1{متجر واحد} =2{متجرين} few{{count} متاجر} many{{count} متجرًا} other{{count} متجر}}'**
  String catalogAvailableFromStores(int count);

  /// No description provided for @catalogChooseStore.
  ///
  /// In ar, this message translates to:
  /// **'اختيار'**
  String get catalogChooseStore;

  /// No description provided for @catalogChangeStore.
  ///
  /// In ar, this message translates to:
  /// **'تغيير المتجر'**
  String get catalogChangeStore;

  /// No description provided for @descriptionReadMore.
  ///
  /// In ar, this message translates to:
  /// **'عرض المزيد'**
  String get descriptionReadMore;

  /// No description provided for @descriptionReadLess.
  ///
  /// In ar, this message translates to:
  /// **'عرض أقل'**
  String get descriptionReadLess;

  /// No description provided for @productAddToCart.
  ///
  /// In ar, this message translates to:
  /// **'أضف للسلة'**
  String get productAddToCart;

  /// No description provided for @productTotalLabel.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي'**
  String get productTotalLabel;

  /// No description provided for @optionRequiredError.
  ///
  /// In ar, this message translates to:
  /// **'اختر خيارًا واحدًا على الأقل'**
  String get optionRequiredError;

  /// No description provided for @cartMiniFromVendor.
  ///
  /// In ar, this message translates to:
  /// **'من {vendor}'**
  String cartMiniFromVendor(String vendor);

  /// No description provided for @cartMiniContinue.
  ///
  /// In ar, this message translates to:
  /// **'متابعة التسوق'**
  String get cartMiniContinue;

  /// No description provided for @cartMiniSummary.
  ///
  /// In ar, this message translates to:
  /// **'السلة: {items} · {total}'**
  String cartMiniSummary(String items, String total);

  /// No description provided for @quantityDecrease.
  ///
  /// In ar, this message translates to:
  /// **'تقليل الكمية'**
  String get quantityDecrease;

  /// No description provided for @quantityIncrease.
  ///
  /// In ar, this message translates to:
  /// **'زيادة الكمية'**
  String get quantityIncrease;

  /// No description provided for @cartErrorMaxVendors.
  ///
  /// In ar, this message translates to:
  /// **'وصلت إلى الحد الأقصى لعدد المتاجر في السلة الواحدة'**
  String get cartErrorMaxVendors;

  /// No description provided for @cartErrorPickupSingleVendor.
  ///
  /// In ar, this message translates to:
  /// **'الاستلام من المتجر متاح لمتجر واحد فقط. غيّر إلى التوصيل لإضافة متجر آخر.'**
  String get cartErrorPickupSingleVendor;

  /// No description provided for @cartErrorMixedCartTypes.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن الجمع بين منتجات المتاجر وخدمة هاتلي في سلة واحدة. أفرغ السلة للتبديل.'**
  String get cartErrorMixedCartTypes;

  /// No description provided for @cartEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'سلتك مستنيا طلبك'**
  String get cartEmptyTitle;

  /// No description provided for @cartEmptyCta.
  ///
  /// In ar, this message translates to:
  /// **'استكشف المنتجات'**
  String get cartEmptyCta;

  /// No description provided for @cartRemoveItem.
  ///
  /// In ar, this message translates to:
  /// **'حذف المنتج'**
  String get cartRemoveItem;

  /// No description provided for @cartEditItem.
  ///
  /// In ar, this message translates to:
  /// **'تعديل'**
  String get cartEditItem;

  /// No description provided for @cartEditHint.
  ///
  /// In ar, this message translates to:
  /// **'لتغيير خيارات منتج: اضغط «تعديل»، اضبط الخيارات وأضفه من جديد، ثم احذف السطر القديم.'**
  String get cartEditHint;

  /// No description provided for @cartSectionExpand.
  ///
  /// In ar, this message translates to:
  /// **'عرض منتجات {vendor}'**
  String cartSectionExpand(String vendor);

  /// No description provided for @cartSectionCollapse.
  ///
  /// In ar, this message translates to:
  /// **'إخفاء منتجات {vendor}'**
  String cartSectionCollapse(String vendor);

  /// No description provided for @cartItemUpdating.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ التحديث'**
  String get cartItemUpdating;

  /// No description provided for @cartContinueToCheckout.
  ///
  /// In ar, this message translates to:
  /// **'متابعة لإتمام الطلب'**
  String get cartContinueToCheckout;

  /// No description provided for @supportContactAction.
  ///
  /// In ar, this message translates to:
  /// **'تواصل مع Hatly'**
  String get supportContactAction;

  /// No description provided for @supportContactActionSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'نرد عليك عبر واتساب'**
  String get supportContactActionSubtitle;

  /// No description provided for @supportContactOrderAction.
  ///
  /// In ar, this message translates to:
  /// **'تواصل مع Hatly بخصوص الطلب'**
  String get supportContactOrderAction;

  /// No description provided for @supportContactUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التواصل مع Hatly غير متاح حاليًا'**
  String get supportContactUnavailable;

  /// No description provided for @supportContactLaunchFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر فتح واتساب. حاول مرة أخرى.'**
  String get supportContactLaunchFailed;

  /// No description provided for @supportMessageGeneral.
  ///
  /// In ar, this message translates to:
  /// **'مرحبًا Hatly، أحتاج إلى مساعدة.'**
  String get supportMessageGeneral;

  /// No description provided for @supportMessageOrder.
  ///
  /// In ar, this message translates to:
  /// **'مرحبًا Hatly، أحتاج إلى مساعدة بخصوص الطلب رقم {orderId}.'**
  String supportMessageOrder(String orderId);

  /// No description provided for @paymentMethodInstapay.
  ///
  /// In ar, this message translates to:
  /// **'إنستاباي'**
  String get paymentMethodInstapay;

  /// No description provided for @paymentMethodVodafoneCash.
  ///
  /// In ar, this message translates to:
  /// **'فودافون كاش'**
  String get paymentMethodVodafoneCash;

  /// No description provided for @paymentMethodOrangeCash.
  ///
  /// In ar, this message translates to:
  /// **'أورانج كاش'**
  String get paymentMethodOrangeCash;

  /// No description provided for @paymentMethodEtisalatCash.
  ///
  /// In ar, this message translates to:
  /// **'اتصالات كاش'**
  String get paymentMethodEtisalatCash;

  /// No description provided for @paymentMethodWePay.
  ///
  /// In ar, this message translates to:
  /// **'WE Pay'**
  String get paymentMethodWePay;

  /// No description provided for @paymentCodLabel.
  ///
  /// In ar, this message translates to:
  /// **'الدفع نقدًا عند الاستلام'**
  String get paymentCodLabel;

  /// No description provided for @paymentPayAtDeliveryLabel.
  ///
  /// In ar, this message translates to:
  /// **'الدفع إلكترونيًا عند الاستلام'**
  String get paymentPayAtDeliveryLabel;

  /// No description provided for @paymentPayAtDeliveryWith.
  ///
  /// In ar, this message translates to:
  /// **'الدفع عند الاستلام عبر {method}'**
  String paymentPayAtDeliveryWith(String method);

  /// No description provided for @paymentManualTransferLabel.
  ///
  /// In ar, this message translates to:
  /// **'تحويل يدوي مسبق'**
  String get paymentManualTransferLabel;

  /// No description provided for @paymentManualTransferWith.
  ///
  /// In ar, this message translates to:
  /// **'تحويل مسبق عبر {method}'**
  String paymentManualTransferWith(String method);

  /// No description provided for @paymentWalletLabel.
  ///
  /// In ar, this message translates to:
  /// **'محفظة هاتلي'**
  String get paymentWalletLabel;

  /// No description provided for @etaAboutMinutes.
  ///
  /// In ar, this message translates to:
  /// **'حوالي {minutes} دقيقة'**
  String etaAboutMinutes(int minutes);

  /// No description provided for @etaRangeMinutes.
  ///
  /// In ar, this message translates to:
  /// **'من {min} إلى {max} دقيقة'**
  String etaRangeMinutes(int min, int max);

  /// No description provided for @etaUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'وقت التوصيل المتوقع غير متاح حاليًا'**
  String get etaUnavailable;

  /// No description provided for @etaUnavailablePreparation.
  ///
  /// In ar, this message translates to:
  /// **'لم يحدد المتجر وقت التحضير بعد، لذلك لا يوجد وقت متوقع'**
  String get etaUnavailablePreparation;

  /// No description provided for @etaDeliveryAt.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل المتوقع حوالي {time}'**
  String etaDeliveryAt(String time);

  /// No description provided for @etaDeliveryBetween.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل المتوقع بين {from} و{until}'**
  String etaDeliveryBetween(String from, String until);

  /// No description provided for @etaReadyAt.
  ///
  /// In ar, this message translates to:
  /// **'يكون جاهزًا للاستلام حوالي {time}'**
  String etaReadyAt(String time);

  /// No description provided for @etaReadyBetween.
  ///
  /// In ar, this message translates to:
  /// **'يكون جاهزًا للاستلام بين {from} و{until}'**
  String etaReadyBetween(String from, String until);

  /// No description provided for @etaDelayed.
  ///
  /// In ar, this message translates to:
  /// **'الطلب متأخر قليلًا عن الوقت المتوقع'**
  String get etaDelayed;

  /// No description provided for @checkoutFulfillmentTitle.
  ///
  /// In ar, this message translates to:
  /// **'طريقة الاستلام'**
  String get checkoutFulfillmentTitle;

  /// No description provided for @checkoutFulfillmentDelivery.
  ///
  /// In ar, this message translates to:
  /// **'توصيل'**
  String get checkoutFulfillmentDelivery;

  /// No description provided for @checkoutFulfillmentPickup.
  ///
  /// In ar, this message translates to:
  /// **'استلام من الفرع'**
  String get checkoutFulfillmentPickup;

  /// No description provided for @checkoutPickupSingleVendorOnly.
  ///
  /// In ar, this message translates to:
  /// **'الاستلام من الفرع متاح لطلب من متجر واحد فقط'**
  String get checkoutPickupSingleVendorOnly;

  /// No description provided for @checkoutPickupBranchDisabled.
  ///
  /// In ar, this message translates to:
  /// **'هذا المتجر لا يوفّر الاستلام من الفرع'**
  String get checkoutPickupBranchDisabled;

  /// No description provided for @checkoutPickupUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الاستلام من الفرع غير متاح لهذا الطلب'**
  String get checkoutPickupUnavailable;

  /// No description provided for @checkoutPickupFrom.
  ///
  /// In ar, this message translates to:
  /// **'الاستلام من'**
  String get checkoutPickupFrom;

  /// No description provided for @checkoutPickupEstimate.
  ///
  /// In ar, this message translates to:
  /// **'وقت التجهيز'**
  String get checkoutPickupEstimate;

  /// No description provided for @checkoutPickupNoDeliveryFee.
  ///
  /// In ar, this message translates to:
  /// **'بدون رسوم توصيل'**
  String get checkoutPickupNoDeliveryFee;

  /// No description provided for @checkoutChangeAddress.
  ///
  /// In ar, this message translates to:
  /// **'تغيير'**
  String get checkoutChangeAddress;

  /// No description provided for @checkoutDefaultAddress.
  ///
  /// In ar, this message translates to:
  /// **'افتراضي'**
  String get checkoutDefaultAddress;

  /// No description provided for @checkoutAddressOutOfServiceArea.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي لا يوصّل إلى هذا العنوان حاليًا. اختر عنوانًا آخر.'**
  String get checkoutAddressOutOfServiceArea;

  /// No description provided for @checkoutAddressVendorDoesNotDeliver.
  ///
  /// In ar, this message translates to:
  /// **'أحد المتاجر في سلتك لا يوفّر التوصيل. يمكنك اختيار الاستلام من الفرع أو تعديل السلة.'**
  String get checkoutAddressVendorDoesNotDeliver;

  /// No description provided for @checkoutAddressVendorOutsideArea.
  ///
  /// In ar, this message translates to:
  /// **'أحد المتاجر في سلتك لا يوصّل إلى هذا العنوان. اختر عنوانًا آخر أو عدّل السلة.'**
  String get checkoutAddressVendorOutsideArea;

  /// No description provided for @checkoutDeliveryEstimate.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل'**
  String get checkoutDeliveryEstimate;

  /// No description provided for @checkoutDeliveryFeePending.
  ///
  /// In ar, this message translates to:
  /// **'يُحدَّد بعد اختيار العنوان'**
  String get checkoutDeliveryFeePending;

  /// No description provided for @checkoutBreakdownBase.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل الأساسية'**
  String get checkoutBreakdownBase;

  /// No description provided for @checkoutBreakdownAdditionalVendors.
  ///
  /// In ar, this message translates to:
  /// **'متاجر إضافية ({count})'**
  String checkoutBreakdownAdditionalVendors(int count);

  /// No description provided for @checkoutBreakdownDistance.
  ///
  /// In ar, this message translates to:
  /// **'المسافة'**
  String get checkoutBreakdownDistance;

  /// No description provided for @checkoutDistanceKm.
  ///
  /// In ar, this message translates to:
  /// **'{km} كم'**
  String checkoutDistanceKm(String km);

  /// No description provided for @checkoutVendorPreparation.
  ///
  /// In ar, this message translates to:
  /// **'وقت تجهيز كل متجر'**
  String get checkoutVendorPreparation;

  /// No description provided for @checkoutPreparationMinutes.
  ///
  /// In ar, this message translates to:
  /// **'حوالي {minutes} دقيقة'**
  String checkoutPreparationMinutes(int minutes);

  /// No description provided for @checkoutPreparationUnknown.
  ///
  /// In ar, this message translates to:
  /// **'غير محدد'**
  String get checkoutPreparationUnknown;

  /// No description provided for @checkoutPaymentManualTransfer.
  ///
  /// In ar, this message translates to:
  /// **'تحويل يدوي (دفع مسبق)'**
  String get checkoutPaymentManualTransfer;

  /// No description provided for @checkoutPaymentManualTransferHint.
  ///
  /// In ar, this message translates to:
  /// **'لا يبدأ تجهيز طلبك إلا بعد اعتماد التحويل'**
  String get checkoutPaymentManualTransferHint;

  /// No description provided for @checkoutPaymentPayAtDeliveryHint.
  ///
  /// In ar, this message translates to:
  /// **'تدفع للمندوب عند التسليم بوسيلة دفع إلكترونية'**
  String get checkoutPaymentPayAtDeliveryHint;

  /// No description provided for @checkoutChooseElectronicMethod.
  ///
  /// In ar, this message translates to:
  /// **'اختر وسيلة الدفع الإلكتروني'**
  String get checkoutChooseElectronicMethod;

  /// No description provided for @checkoutNoElectronicMethods.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد وسائل دفع إلكتروني متاحة حاليًا'**
  String get checkoutNoElectronicMethods;

  /// No description provided for @checkoutTransferUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التحويل اليدوي غير متاح حاليًا'**
  String get checkoutTransferUnavailable;

  /// No description provided for @checkoutTransferUnavailableWeighed.
  ///
  /// In ar, this message translates to:
  /// **'غير متاح للطلبات التي تحتوي على منتجات بالوزن لأن السعر النهائي يُحسب بعد الوزن'**
  String get checkoutTransferUnavailableWeighed;

  /// No description provided for @checkoutTransferUnavailableUnpriced.
  ///
  /// In ar, this message translates to:
  /// **'غير متاح لأن سعر الطلب لم يُحدَّد بعد'**
  String get checkoutTransferUnavailableUnpriced;

  /// No description provided for @checkoutPaidFullyByWallet.
  ///
  /// In ar, this message translates to:
  /// **'سيتم دفع الطلب بالكامل من محفظة هاتلي'**
  String get checkoutPaidFullyByWallet;

  /// No description provided for @checkoutWalletTitle.
  ///
  /// In ar, this message translates to:
  /// **'المحفظة'**
  String get checkoutWalletTitle;

  /// No description provided for @checkoutWalletUse.
  ///
  /// In ar, this message translates to:
  /// **'استخدام رصيد محفظة هاتلي'**
  String get checkoutWalletUse;

  /// No description provided for @checkoutWalletBalance.
  ///
  /// In ar, this message translates to:
  /// **'رصيدك: {amount}'**
  String checkoutWalletBalance(String amount);

  /// No description provided for @checkoutWalletApplied.
  ///
  /// In ar, this message translates to:
  /// **'المدفوع من المحفظة'**
  String get checkoutWalletApplied;

  /// No description provided for @checkoutAmountDue.
  ///
  /// In ar, this message translates to:
  /// **'المتبقي للدفع'**
  String get checkoutAmountDue;

  /// No description provided for @checkoutWalletAmountLabel.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ المخصوم من المحفظة (اختياري)'**
  String get checkoutWalletAmountLabel;

  /// No description provided for @checkoutWalletAmountHelp.
  ///
  /// In ar, this message translates to:
  /// **'اتركه فارغًا لاستخدام أكبر مبلغ ممكن'**
  String get checkoutWalletAmountHelp;

  /// No description provided for @checkoutWalletEmpty.
  ///
  /// In ar, this message translates to:
  /// **'رصيد المحفظة صفر'**
  String get checkoutWalletEmpty;

  /// No description provided for @checkoutWalletUnavailableForOrder.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن استخدام المحفظة مع هذا الطلب لأن سعره النهائي غير محدد بعد'**
  String get checkoutWalletUnavailableForOrder;

  /// No description provided for @checkoutCouponTitle.
  ///
  /// In ar, this message translates to:
  /// **'لديك كود خصم؟'**
  String get checkoutCouponTitle;

  /// No description provided for @checkoutCouponHint.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كود الخصم'**
  String get checkoutCouponHint;

  /// No description provided for @checkoutCouponApply.
  ///
  /// In ar, this message translates to:
  /// **'تطبيق'**
  String get checkoutCouponApply;

  /// No description provided for @checkoutCouponRemove.
  ///
  /// In ar, this message translates to:
  /// **'إزالة'**
  String get checkoutCouponRemove;

  /// No description provided for @checkoutCouponSaves.
  ///
  /// In ar, this message translates to:
  /// **'وفّرت {amount}'**
  String checkoutCouponSaves(String amount);

  /// No description provided for @checkoutCouponForVendor.
  ///
  /// In ar, this message translates to:
  /// **'من {vendor}'**
  String checkoutCouponForVendor(String vendor);

  /// No description provided for @checkoutCouponNotFound.
  ///
  /// In ar, this message translates to:
  /// **'كود الخصم غير صحيح'**
  String get checkoutCouponNotFound;

  /// No description provided for @checkoutCouponExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية كود الخصم'**
  String get checkoutCouponExpired;

  /// No description provided for @checkoutCouponNotStarted.
  ///
  /// In ar, this message translates to:
  /// **'كود الخصم لم يبدأ بعد'**
  String get checkoutCouponNotStarted;

  /// No description provided for @checkoutCouponMinimumNotMet.
  ///
  /// In ar, this message translates to:
  /// **'لم يصل طلبك إلى الحد الأدنى لاستخدام هذا الكود'**
  String get checkoutCouponMinimumNotMet;

  /// No description provided for @checkoutCouponNotApplicable.
  ///
  /// In ar, this message translates to:
  /// **'هذا الكود لا ينطبق على المنتجات في سلتك'**
  String get checkoutCouponNotApplicable;

  /// No description provided for @checkoutCouponConflictsWithOffer.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن استخدام الكود مع عرض مفعّل على نفس المتجر'**
  String get checkoutCouponConflictsWithOffer;

  /// No description provided for @checkoutCouponLimitReached.
  ///
  /// In ar, this message translates to:
  /// **'تم استهلاك هذا الكود بالكامل'**
  String get checkoutCouponLimitReached;

  /// No description provided for @checkoutCouponRejected.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن استخدام هذا الكود'**
  String get checkoutCouponRejected;

  /// No description provided for @checkoutOrderSummary.
  ///
  /// In ar, this message translates to:
  /// **'ملخص الطلب'**
  String get checkoutOrderSummary;

  /// No description provided for @checkoutTotalPending.
  ///
  /// In ar, this message translates to:
  /// **'يُحدَّد لاحقًا'**
  String get checkoutTotalPending;

  /// No description provided for @checkoutConfirmAndPay.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب ومتابعة الدفع'**
  String get checkoutConfirmAndPay;

  /// No description provided for @checkoutStaleChanged.
  ///
  /// In ar, this message translates to:
  /// **'تغيّر السعر أو تفاصيل التوصيل منذ آخر مراجعة. راجع الملخص المحدّث ثم أكّد الطلب مرة أخرى.'**
  String get checkoutStaleChanged;

  /// No description provided for @checkoutStaleExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية العرض السابق. راجع الملخص المحدّث ثم أكّد الطلب مرة أخرى.'**
  String get checkoutStaleExpired;

  /// No description provided for @checkoutErrorWalletInsufficient.
  ///
  /// In ar, this message translates to:
  /// **'رصيد المحفظة لا يغطي قيمة الطلب'**
  String get checkoutErrorWalletInsufficient;

  /// No description provided for @checkoutBlockerGeneric.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن إتمام الطلب حاليًا. راجع سلتك وحاول مرة أخرى.'**
  String get checkoutBlockerGeneric;

  /// No description provided for @checkoutBlockerUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'أحد المنتجات أو المتاجر في سلتك غير متاح حاليًا'**
  String get checkoutBlockerUnavailable;

  /// No description provided for @checkoutBlockerMultiVendorDisabled.
  ///
  /// In ar, this message translates to:
  /// **'الطلب من أكثر من متجر غير متاح حاليًا'**
  String get checkoutBlockerMultiVendorDisabled;

  /// No description provided for @checkoutBlockerFeeUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر حساب رسوم التوصيل الآن. حاول مرة أخرى بعد قليل.'**
  String get checkoutBlockerFeeUnavailable;

  /// No description provided for @checkoutBlockerInvalidAddress.
  ///
  /// In ar, this message translates to:
  /// **'موقع العنوان غير صالح. اختر موقعًا آخر.'**
  String get checkoutBlockerInvalidAddress;

  /// No description provided for @checkoutOrderPlacedButLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء طلبك، لكن تعذّر تحميل تفاصيله الآن'**
  String get checkoutOrderPlacedButLoadFailed;

  /// No description provided for @checkoutSuccessTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم استلام طلبك'**
  String get checkoutSuccessTitle;

  /// No description provided for @checkoutSuccessAwaitingTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء طلبك، والدفع قيد المراجعة'**
  String get checkoutSuccessAwaitingTitle;

  /// No description provided for @checkoutSuccessSendProof.
  ///
  /// In ar, this message translates to:
  /// **'أرسل إثبات التحويل'**
  String get checkoutSuccessSendProof;

  /// No description provided for @checkoutSuccessBackHome.
  ///
  /// In ar, this message translates to:
  /// **'العودة للرئيسية'**
  String get checkoutSuccessBackHome;

  /// No description provided for @orderNumberLabel.
  ///
  /// In ar, this message translates to:
  /// **'رقم الطلب'**
  String get orderNumberLabel;

  /// No description provided for @orderVendorsLabel.
  ///
  /// In ar, this message translates to:
  /// **'المتاجر'**
  String get orderVendorsLabel;

  /// No description provided for @orderTrackAction.
  ///
  /// In ar, this message translates to:
  /// **'تتبّع الطلب'**
  String get orderTrackAction;

  /// No description provided for @orderDetailsAction.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الطلب'**
  String get orderDetailsAction;

  /// No description provided for @orderPaymentAwaitingReview.
  ///
  /// In ar, this message translates to:
  /// **'دفعتك قيد المراجعة. سيبدأ تجهيز الطلب بعد اعتماد التحويل.'**
  String get orderPaymentAwaitingReview;

  /// No description provided for @orderPaymentAwaitingReviewShort.
  ///
  /// In ar, this message translates to:
  /// **'الدفع قيد المراجعة'**
  String get orderPaymentAwaitingReviewShort;

  /// No description provided for @orderTimelineTitle.
  ///
  /// In ar, this message translates to:
  /// **'مراحل الطلب'**
  String get orderTimelineTitle;

  /// No description provided for @orderPricingTitle.
  ///
  /// In ar, this message translates to:
  /// **'ملخص الحساب'**
  String get orderPricingTitle;

  /// No description provided for @orderDeliveryBreakdownTitle.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل رسوم التوصيل'**
  String get orderDeliveryBreakdownTitle;

  /// No description provided for @orderPaymentMethodLabel.
  ///
  /// In ar, this message translates to:
  /// **'طريقة الدفع'**
  String get orderPaymentMethodLabel;

  /// No description provided for @orderPaymentStatusLabel.
  ///
  /// In ar, this message translates to:
  /// **'حالة الدفع'**
  String get orderPaymentStatusLabel;

  /// No description provided for @orderPaymentStatusPending.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار إرسال إثبات التحويل'**
  String get orderPaymentStatusPending;

  /// No description provided for @orderPaymentStatusUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'قيد المراجعة'**
  String get orderPaymentStatusUnderReview;

  /// No description provided for @orderPaymentStatusPaid.
  ///
  /// In ar, this message translates to:
  /// **'تم الدفع'**
  String get orderPaymentStatusPaid;

  /// No description provided for @orderPaymentStatusRejected.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض التحويل'**
  String get orderPaymentStatusRejected;

  /// No description provided for @orderPaymentStatusDueOnDelivery.
  ///
  /// In ar, this message translates to:
  /// **'يُدفع عند الاستلام'**
  String get orderPaymentStatusDueOnDelivery;

  /// No description provided for @orderDeliveryAddressTitle.
  ///
  /// In ar, this message translates to:
  /// **'عنوان التوصيل'**
  String get orderDeliveryAddressTitle;

  /// No description provided for @orderCouponLine.
  ///
  /// In ar, this message translates to:
  /// **'كود الخصم {code}: وفّرت {amount}'**
  String orderCouponLine(String code, String amount);

  /// No description provided for @orderVendorReadyAt.
  ///
  /// In ar, this message translates to:
  /// **'يكون جاهزًا حوالي {time}'**
  String orderVendorReadyAt(String time);

  /// No description provided for @orderVendorPreparationMinutes.
  ///
  /// In ar, this message translates to:
  /// **'وقت التجهيز حوالي {minutes} دقيقة'**
  String orderVendorPreparationMinutes(int minutes);

  /// No description provided for @orderCancelAction.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get orderCancelAction;

  /// No description provided for @orderCancelConfirmTitle.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب بالكامل؟'**
  String get orderCancelConfirmTitle;

  /// No description provided for @orderCancelConfirmMessage.
  ///
  /// In ar, this message translates to:
  /// **'سيتم إلغاء الطلب من جميع المتاجر. إذا دفعت من المحفظة يعود المبلغ إليها.'**
  String get orderCancelConfirmMessage;

  /// No description provided for @orderCancelReasonHint.
  ///
  /// In ar, this message translates to:
  /// **'سبب الإلغاء (اختياري)'**
  String get orderCancelReasonHint;

  /// No description provided for @orderCancelKeep.
  ///
  /// In ar, this message translates to:
  /// **'الاحتفاظ بالطلب'**
  String get orderCancelKeep;

  /// No description provided for @orderCancelConfirmAction.
  ///
  /// In ar, this message translates to:
  /// **'نعم، ألغِ الطلب'**
  String get orderCancelConfirmAction;

  /// No description provided for @orderCancelDone.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطلب'**
  String get orderCancelDone;

  /// No description provided for @orderCancelNotAllowed.
  ///
  /// In ar, this message translates to:
  /// **'لم يعد بإمكانك إلغاء هذا الطلب لأن أحد المتاجر بدأ التجهيز'**
  String get orderCancelNotAllowed;

  /// No description provided for @orderCancelFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إلغاء الطلب. حاول مرة أخرى.'**
  String get orderCancelFailed;

  /// No description provided for @ordersTabActive.
  ///
  /// In ar, this message translates to:
  /// **'جارية'**
  String get ordersTabActive;

  /// No description provided for @ordersTabCompleted.
  ///
  /// In ar, this message translates to:
  /// **'مكتملة'**
  String get ordersTabCompleted;

  /// No description provided for @ordersTabCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغاة'**
  String get ordersTabCancelled;

  /// No description provided for @ordersEmptyActive.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات جارية'**
  String get ordersEmptyActive;

  /// No description provided for @ordersEmptyCompleted.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات مكتملة بعد'**
  String get ordersEmptyCompleted;

  /// No description provided for @ordersEmptyCancelled.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات ملغاة'**
  String get ordersEmptyCancelled;

  /// No description provided for @addressLocationSection.
  ///
  /// In ar, this message translates to:
  /// **'الموقع على الخريطة'**
  String get addressLocationSection;

  /// No description provided for @addressDetailsSection.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل العنوان'**
  String get addressDetailsSection;

  /// No description provided for @addressMapUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الخريطة غير مفعّلة في هذا الإصدار. حدّد موقعك بالـGPS أو ابحث عن عنوانك.'**
  String get addressMapUnavailable;

  /// No description provided for @addressConfirmPin.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد هذا الموقع'**
  String get addressConfirmPin;

  /// No description provided for @addressSearchLabel.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن عنوانك'**
  String get addressSearchLabel;

  /// No description provided for @addressSearchAction.
  ///
  /// In ar, this message translates to:
  /// **'بحث'**
  String get addressSearchAction;

  /// No description provided for @addressSearchNoResult.
  ///
  /// In ar, this message translates to:
  /// **'لم نجد هذا العنوان. جرّب صياغة أخرى أو استخدم موقعك الحالي.'**
  String get addressSearchNoResult;

  /// No description provided for @addressLocationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر الحصول على موقعك. فعّل خدمة الموقع وامنح التطبيق الإذن ثم حاول مرة أخرى.'**
  String get addressLocationUnavailable;

  /// No description provided for @addressSuggestionLabel.
  ///
  /// In ar, this message translates to:
  /// **'عنوان مقترح للموقع المحدد'**
  String get addressSuggestionLabel;

  /// No description provided for @addressUseSuggestion.
  ///
  /// In ar, this message translates to:
  /// **'استخدام'**
  String get addressUseSuggestion;

  /// No description provided for @addressLine1Label.
  ///
  /// In ar, this message translates to:
  /// **'العنوان (الشارع والمنطقة)'**
  String get addressLine1Label;

  /// No description provided for @addressLine1Required.
  ///
  /// In ar, this message translates to:
  /// **'اكتب عنوان التوصيل'**
  String get addressLine1Required;

  /// No description provided for @addressGovernorateLabel.
  ///
  /// In ar, this message translates to:
  /// **'المحافظة'**
  String get addressGovernorateLabel;

  /// No description provided for @addressCityLabel.
  ///
  /// In ar, this message translates to:
  /// **'المدينة'**
  String get addressCityLabel;

  /// No description provided for @addressBuildingLabel.
  ///
  /// In ar, this message translates to:
  /// **'رقم العقار'**
  String get addressBuildingLabel;

  /// No description provided for @addressFloorLabel.
  ///
  /// In ar, this message translates to:
  /// **'الدور'**
  String get addressFloorLabel;

  /// No description provided for @addressApartmentLabel.
  ///
  /// In ar, this message translates to:
  /// **'الشقة'**
  String get addressApartmentLabel;

  /// No description provided for @addressLandmarkLabel.
  ///
  /// In ar, this message translates to:
  /// **'علامة مميزة'**
  String get addressLandmarkLabel;

  /// No description provided for @addressLabelHome.
  ///
  /// In ar, this message translates to:
  /// **'المنزل'**
  String get addressLabelHome;

  /// No description provided for @addressLabelWork.
  ///
  /// In ar, this message translates to:
  /// **'العمل'**
  String get addressLabelWork;

  /// No description provided for @addressMakeDefault.
  ///
  /// In ar, this message translates to:
  /// **'اجعله عنواني الافتراضي'**
  String get addressMakeDefault;

  /// No description provided for @checkoutSuccessAppBar.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب'**
  String get checkoutSuccessAppBar;

  /// No description provided for @checkoutAmountDueByTransfer.
  ///
  /// In ar, this message translates to:
  /// **'المتبقي للدفع بالتحويل'**
  String get checkoutAmountDueByTransfer;

  /// No description provided for @addressLocationServicesDisabled.
  ///
  /// In ar, this message translates to:
  /// **'خدمة الموقع مغلقة على جهازك. فعّلها من إعدادات الجهاز ثم حاول مرة أخرى.'**
  String get addressLocationServicesDisabled;

  /// No description provided for @addressLocationPermissionDenied.
  ///
  /// In ar, this message translates to:
  /// **'لم يُسمح للتطبيق بالوصول لموقعك. حاول مرة أخرى أو أدخل عنوانك يدويًا.'**
  String get addressLocationPermissionDenied;

  /// No description provided for @addressLocationPermissionPermanentlyDenied.
  ///
  /// In ar, this message translates to:
  /// **'إذن الموقع مرفوض بشكل دائم. فعّله من إعدادات التطبيق على جهازك.'**
  String get addressLocationPermissionPermanentlyDenied;

  /// No description provided for @addressLocationPositionUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحديد موقعك الحالي. حاول مرة أخرى أو أدخل عنوانك يدويًا.'**
  String get addressLocationPositionUnavailable;

  /// No description provided for @addressOpenSettings.
  ///
  /// In ar, this message translates to:
  /// **'فتح إعدادات التطبيق'**
  String get addressOpenSettings;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
