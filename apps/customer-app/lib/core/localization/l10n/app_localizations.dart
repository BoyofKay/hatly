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

  /// No description provided for @routeNotFoundTitle.
  ///
  /// In ar, this message translates to:
  /// **'الصفحة غير موجودة'**
  String get routeNotFoundTitle;

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
  /// **'غيّر كلمة المرور التي تسجّل بها الدخول.'**
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

  /// No description provided for @passwordTooShort.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور يجب ألا تقل عن 8 أحرف'**
  String get passwordTooShort;

  /// No description provided for @passwordConfirmLabel.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد كلمة المرور'**
  String get passwordConfirmLabel;

  /// No description provided for @passwordMismatch.
  ///
  /// In ar, this message translates to:
  /// **'كلمتا المرور غير متطابقتين'**
  String get passwordMismatch;

  /// No description provided for @errorInvalidCredentials.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف أو كلمة المرور غير صحيحة'**
  String get errorInvalidCredentials;

  /// No description provided for @errorRegistrationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إكمال التسجيل. إذا كان لديك حساب بالفعل فسجّل الدخول.'**
  String get errorRegistrationUnavailable;

  /// No description provided for @errorTooManyFailedLogins.
  ///
  /// In ar, this message translates to:
  /// **'محاولات تسجيل دخول فاشلة كثيرة. حاول مرة أخرى بعد قليل'**
  String get errorTooManyFailedLogins;

  /// No description provided for @errorInvalidInput.
  ///
  /// In ar, this message translates to:
  /// **'تحقق من البيانات المدخلة وحاول مرة أخرى'**
  String get errorInvalidInput;

  /// No description provided for @errorPhoneVerificationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التحقق من الهاتف غير متاح حاليًا'**
  String get errorPhoneVerificationUnavailable;

  /// No description provided for @profileCurrentPasswordLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الحالية'**
  String get profileCurrentPasswordLabel;

  /// No description provided for @errorCurrentPasswordRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور الحالية لتغييرها'**
  String get errorCurrentPasswordRequired;

  /// No description provided for @errorCurrentPasswordInvalid.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الحالية غير صحيحة'**
  String get errorCurrentPasswordInvalid;

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
  /// **'اطلب صنفًا غير موجود في القائمة'**
  String get customRequestSheetTitle;

  /// No description provided for @customRequestSheetSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'صف ما تحتاجه و/أو أضف صورة. سيُضاف إلى سلتك ويصل إلى المتجر مع طلبك، ويؤكد المتجر توفر الصنف ويحدد سعره، وسيظهر لك المبلغ النهائي بعد ذلك.'**
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

  /// No description provided for @customRequestAddImage.
  ///
  /// In ar, this message translates to:
  /// **'إضافة صورة'**
  String get customRequestAddImage;

  /// No description provided for @customRequestRemoveImage.
  ///
  /// In ar, this message translates to:
  /// **'إزالة الصورة'**
  String get customRequestRemoveImage;

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

  /// No description provided for @orderStatusCollected.
  ///
  /// In ar, this message translates to:
  /// **'تم الاستلام'**
  String get orderStatusCollected;

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

  /// No description provided for @sortOffers.
  ///
  /// In ar, this message translates to:
  /// **'العروض'**
  String get sortOffers;

  /// No description provided for @filterAction.
  ///
  /// In ar, this message translates to:
  /// **'فلترة'**
  String get filterAction;

  /// No description provided for @sortAction.
  ///
  /// In ar, this message translates to:
  /// **'ترتيب'**
  String get sortAction;

  /// No description provided for @clearAll.
  ///
  /// In ar, this message translates to:
  /// **'مسح الكل'**
  String get clearAll;

  /// No description provided for @apply.
  ///
  /// In ar, this message translates to:
  /// **'تطبيق'**
  String get apply;

  /// No description provided for @filterOpenNow.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح الآن'**
  String get filterOpenNow;

  /// No description provided for @filterHasOffers.
  ///
  /// In ar, this message translates to:
  /// **'عروض'**
  String get filterHasOffers;

  /// No description provided for @filterRatingLabel.
  ///
  /// In ar, this message translates to:
  /// **'التقييم'**
  String get filterRatingLabel;

  /// No description provided for @filterRatingAny.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get filterRatingAny;

  /// No description provided for @filterRating4Plus.
  ///
  /// In ar, this message translates to:
  /// **'4.0 فأعلى'**
  String get filterRating4Plus;

  /// No description provided for @filterRating3Plus.
  ///
  /// In ar, this message translates to:
  /// **'3.0 فأعلى'**
  String get filterRating3Plus;

  /// No description provided for @filterAvailableOnly.
  ///
  /// In ar, this message translates to:
  /// **'متوفر فقط'**
  String get filterAvailableOnly;

  /// No description provided for @filterPriceRangeLabel.
  ///
  /// In ar, this message translates to:
  /// **'نطاق السعر'**
  String get filterPriceRangeLabel;

  /// No description provided for @filterPriceMinHint.
  ///
  /// In ar, this message translates to:
  /// **'من'**
  String get filterPriceMinHint;

  /// No description provided for @filterPriceMaxHint.
  ///
  /// In ar, this message translates to:
  /// **'إلى'**
  String get filterPriceMaxHint;

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
  /// **'لا يمكن الجمع بين منتجات المتاجر وطلبات خدمة هاتلي في سلة واحدة. امسح السلة للتبديل بينهما.'**
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

  /// No description provided for @checkoutElectronicMethodHeading.
  ///
  /// In ar, this message translates to:
  /// **'وسيلة الدفع الإلكتروني'**
  String get checkoutElectronicMethodHeading;

  /// No description provided for @checkoutElectronicMethodUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'وسيلة الدفع هذه غير متاحة حاليًا، اختر وسيلة أخرى'**
  String get checkoutElectronicMethodUnavailable;

  /// No description provided for @checkoutCannotConfirmYet.
  ///
  /// In ar, this message translates to:
  /// **'لم نتمكن من تأكيد الطلب بعد. راجع اختياراتك وحاول مرة أخرى'**
  String get checkoutCannotConfirmYet;

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

  /// No description provided for @checkoutPickupCashNote.
  ///
  /// In ar, this message translates to:
  /// **'طلبات الاستلام تُدفع نقدًا في الفرع عند استلامها.'**
  String get checkoutPickupCashNote;

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

  /// No description provided for @checkoutBlockerAdHocPickupRequired.
  ///
  /// In ar, this message translates to:
  /// **'طلب خدمة هاتلي هذا بدون موقع استلام. احذفه من السلة وأضفه مرة أخرى مع موقع المكان.'**
  String get checkoutBlockerAdHocPickupRequired;

  /// No description provided for @checkoutBlockerAdHocDestinationRequired.
  ///
  /// In ar, this message translates to:
  /// **'طلب خدمة هاتلي هذا بدون وجهة. احذفه من السلة وأضفه مرة أخرى مع الوجهة.'**
  String get checkoutBlockerAdHocDestinationRequired;

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

  /// No description provided for @checkoutBlockerGpsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل إلى موقع GPS غير متاح حاليًا. اختر عنوانًا بمنطقة توصيل أو أضف عنوانًا جديدًا.'**
  String get checkoutBlockerGpsUnavailable;

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
  /// **'لم نجد هذا العنوان. البحث عن العناوين غير متاح دائمًا — يمكنك كتابة عنوانك في التفاصيل أعلاه وحفظه بدون موقع على الخريطة، أو استخدام موقعك الحالي.'**
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
  /// **'العمارة'**
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

  /// No description provided for @hatlyServiceEntryTitle.
  ///
  /// In ar, this message translates to:
  /// **'خدمة هاتلي'**
  String get hatlyServiceEntryTitle;

  /// No description provided for @hatlyServiceEntrySubtitle.
  ///
  /// In ar, this message translates to:
  /// **'محتاج حاجة من مكان مش موجود عندنا؟ اطلبها من هاتلي.'**
  String get hatlyServiceEntrySubtitle;

  /// No description provided for @hatlyServiceScreenTitle.
  ///
  /// In ar, this message translates to:
  /// **'خدمة هاتلي'**
  String get hatlyServiceScreenTitle;

  /// No description provided for @hatlyServiceTypeSectionTitle.
  ///
  /// In ar, this message translates to:
  /// **'محتاج إيه؟'**
  String get hatlyServiceTypeSectionTitle;

  /// No description provided for @hatlyServiceTypeBuyFromPlace.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي من مكان'**
  String get hatlyServiceTypeBuyFromPlace;

  /// No description provided for @hatlyServiceTypeBuyFromPlaceHint.
  ///
  /// In ar, this message translates to:
  /// **'قولنا هاتلك إيه ومن فين، وإحنا هنجيبه لك.'**
  String get hatlyServiceTypeBuyFromPlaceHint;

  /// No description provided for @hatlyServiceTypeDeliverToPlace.
  ///
  /// In ar, this message translates to:
  /// **'وصّلي لمكان'**
  String get hatlyServiceTypeDeliverToPlace;

  /// No description provided for @hatlyServiceTypeDeliverToPlaceHint.
  ///
  /// In ar, this message translates to:
  /// **'قولنا هنوصّل إيه وفين، وإحنا هنستلمه ونوصّله.'**
  String get hatlyServiceTypeDeliverToPlaceHint;

  /// No description provided for @hatlyServiceExistingGroupNotice.
  ///
  /// In ar, this message translates to:
  /// **'عندك بالفعل طلب خدمة هاتلي في سلتك. هذا الصنف هيتضاف إليه.'**
  String get hatlyServiceExistingGroupNotice;

  /// No description provided for @hatlyServicePlaceNameLabel.
  ///
  /// In ar, this message translates to:
  /// **'اسم الطلب'**
  String get hatlyServicePlaceNameLabel;

  /// No description provided for @hatlyServicePlaceNameHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: كارفور مول مصر، أو بيت ماما'**
  String get hatlyServicePlaceNameHint;

  /// No description provided for @hatlyServicePlaceNameRequired.
  ///
  /// In ar, this message translates to:
  /// **'اكتب اسمًا مختصرًا لهذا الطلب'**
  String get hatlyServicePlaceNameRequired;

  /// No description provided for @hatlyServiceDescriptionLabel.
  ///
  /// In ar, this message translates to:
  /// **'اوصف اللي محتاجه'**
  String get hatlyServiceDescriptionLabel;

  /// No description provided for @hatlyServiceDescriptionHint.
  ///
  /// In ar, this message translates to:
  /// **'كن محددًا قدر الإمكان — الصنف، الماركة، الكمية، أي تفاصيل تساعدنا.'**
  String get hatlyServiceDescriptionHint;

  /// No description provided for @hatlyServiceDescriptionRequired.
  ///
  /// In ar, this message translates to:
  /// **'اوصف اللي محتاجه'**
  String get hatlyServiceDescriptionRequired;

  /// No description provided for @hatlyServiceImagesLabel.
  ///
  /// In ar, this message translates to:
  /// **'صور (اختياري)'**
  String get hatlyServiceImagesLabel;

  /// No description provided for @hatlyServiceLocationPickupTitle.
  ///
  /// In ar, this message translates to:
  /// **'موقع الاستلام (مطلوب)'**
  String get hatlyServiceLocationPickupTitle;

  /// No description provided for @hatlyServiceLocationDestinationTitle.
  ///
  /// In ar, this message translates to:
  /// **'موقع التوصيل (مطلوب)'**
  String get hatlyServiceLocationDestinationTitle;

  /// No description provided for @hatlyServiceLocationDestinationHint.
  ///
  /// In ar, this message translates to:
  /// **'حدد بالضبط أين يجب توصيل هذا الطلب — هاتلي لا يمكنه تخمين ذلك نيابة عنك.'**
  String get hatlyServiceLocationDestinationHint;

  /// No description provided for @hatlyServiceLocationPickupHint.
  ///
  /// In ar, this message translates to:
  /// **'حدد بالضبط المكان الذي يجب أن تشتري هاتلي منه — هاتلي لا يمكنه تخمين ذلك نيابة عنك.'**
  String get hatlyServiceLocationPickupHint;

  /// No description provided for @hatlyServiceReviewTitle.
  ///
  /// In ar, this message translates to:
  /// **'راجع طلبك'**
  String get hatlyServiceReviewTitle;

  /// No description provided for @hatlyServiceReviewEdit.
  ///
  /// In ar, this message translates to:
  /// **'تعديل'**
  String get hatlyServiceReviewEdit;

  /// No description provided for @hatlyServiceReviewTypeLabel.
  ///
  /// In ar, this message translates to:
  /// **'الخدمة'**
  String get hatlyServiceReviewTypeLabel;

  /// No description provided for @hatlyServiceReviewPlaceLabel.
  ///
  /// In ar, this message translates to:
  /// **'اسم الطلب'**
  String get hatlyServiceReviewPlaceLabel;

  /// No description provided for @hatlyServiceReviewDescriptionLabel.
  ///
  /// In ar, this message translates to:
  /// **'التفاصيل'**
  String get hatlyServiceReviewDescriptionLabel;

  /// No description provided for @hatlyServiceReviewImagesLabel.
  ///
  /// In ar, this message translates to:
  /// **'الصور'**
  String get hatlyServiceReviewImagesLabel;

  /// No description provided for @hatlyServiceReviewLocationLabel.
  ///
  /// In ar, this message translates to:
  /// **'الموقع'**
  String get hatlyServiceReviewLocationLabel;

  /// No description provided for @hatlyServiceReviewLocationSet.
  ///
  /// In ar, this message translates to:
  /// **'تم تحديده — سيُستخدم لهذا الطلب'**
  String get hatlyServiceReviewLocationSet;

  /// No description provided for @hatlyServiceReviewLocationRequired.
  ///
  /// In ar, this message translates to:
  /// **'غير محدد — يجب تحديده قبل إمكانية إضافة هذا الطلب'**
  String get hatlyServiceReviewLocationRequired;

  /// No description provided for @hatlyServiceContinueToReview.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة الطلب'**
  String get hatlyServiceContinueToReview;

  /// No description provided for @hatlyServiceSubmit.
  ///
  /// In ar, this message translates to:
  /// **'أضف إلى السلة'**
  String get hatlyServiceSubmit;

  /// No description provided for @hatlyServiceAddedConfirmation.
  ///
  /// In ar, this message translates to:
  /// **'تمت الإضافة إلى السلة'**
  String get hatlyServiceAddedConfirmation;

  /// No description provided for @orderHatlyServiceTypeLabel.
  ///
  /// In ar, this message translates to:
  /// **'نوع الخدمة'**
  String get orderHatlyServiceTypeLabel;

  /// No description provided for @orderHatlyServicePickupLocationLabel.
  ///
  /// In ar, this message translates to:
  /// **'موقع الاستلام'**
  String get orderHatlyServicePickupLocationLabel;

  /// No description provided for @orderHatlyServiceDestinationLocationLabel.
  ///
  /// In ar, this message translates to:
  /// **'موقع التوصيل'**
  String get orderHatlyServiceDestinationLocationLabel;

  /// No description provided for @orderHatlyServiceLocationCoordinates.
  ///
  /// In ar, this message translates to:
  /// **'محدد على الخريطة'**
  String get orderHatlyServiceLocationCoordinates;

  /// No description provided for @cartErrorAdHocPlaceNameRequired.
  ///
  /// In ar, this message translates to:
  /// **'اكتب اسمًا مختصرًا لهذا الطلب.'**
  String get cartErrorAdHocPlaceNameRequired;

  /// No description provided for @cartErrorAdHocServiceTypeRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر نوع خدمة هاتلي.'**
  String get cartErrorAdHocServiceTypeRequired;

  /// No description provided for @cartErrorAdHocLocationMismatch.
  ///
  /// In ar, this message translates to:
  /// **'هذا الموقع لا ينطبق على نوع الخدمة هذا.'**
  String get cartErrorAdHocLocationMismatch;

  /// No description provided for @cartErrorAdHocIncompleteCoordinate.
  ///
  /// In ar, this message translates to:
  /// **'حدد الموقع مرة أخرى — لم يتم التقاطه بشكل صحيح.'**
  String get cartErrorAdHocIncompleteCoordinate;

  /// No description provided for @cartErrorAdHocSingleLocationOnly.
  ///
  /// In ar, this message translates to:
  /// **'طلب خدمة هاتلي يمكن أن يشمل موقعًا واحدًا فقط. أفرغ السلة لبدء طلب جديد.'**
  String get cartErrorAdHocSingleLocationOnly;

  /// No description provided for @cartErrorAdHocPickupOnly.
  ///
  /// In ar, this message translates to:
  /// **'خدمة هاتلي غير متاحة مع الاستلام من المتجر — غيّر إلى التوصيل أولًا.'**
  String get cartErrorAdHocPickupOnly;

  /// No description provided for @cartErrorAdHocDestinationRequired.
  ///
  /// In ar, this message translates to:
  /// **'من فضلك اختر وجهة لطلب التوصيل هذا قبل إضافته إلى السلة.'**
  String get cartErrorAdHocDestinationRequired;

  /// No description provided for @cartErrorAdHocPickupRequired.
  ///
  /// In ar, this message translates to:
  /// **'من فضلك اختر موقع المكان المطلوب الشراء منه قبل إضافة هذا الطلب إلى السلة.'**
  String get cartErrorAdHocPickupRequired;

  /// No description provided for @profileMyAddresses.
  ///
  /// In ar, this message translates to:
  /// **'عناويني'**
  String get profileMyAddresses;

  /// No description provided for @profileDefaultAddressTitle.
  ///
  /// In ar, this message translates to:
  /// **'العنوان الافتراضي'**
  String get profileDefaultAddressTitle;

  /// No description provided for @profileNoDefaultAddress.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد عنوان افتراضي بعد'**
  String get profileNoDefaultAddress;

  /// No description provided for @profileManageAddresses.
  ///
  /// In ar, this message translates to:
  /// **'إدارة'**
  String get profileManageAddresses;

  /// No description provided for @profileWalletCardTitle.
  ///
  /// In ar, this message translates to:
  /// **'محفظة هاتلي'**
  String get profileWalletCardTitle;

  /// No description provided for @walletTitle.
  ///
  /// In ar, this message translates to:
  /// **'المحفظة'**
  String get walletTitle;

  /// No description provided for @walletBalanceLabel.
  ///
  /// In ar, this message translates to:
  /// **'رصيد المحفظة'**
  String get walletBalanceLabel;

  /// No description provided for @walletHistoryTitle.
  ///
  /// In ar, this message translates to:
  /// **'سجل المعاملات'**
  String get walletHistoryTitle;

  /// No description provided for @walletEmptyHistory.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد معاملات بعد'**
  String get walletEmptyHistory;

  /// No description provided for @walletTypeOrderPayment.
  ///
  /// In ar, this message translates to:
  /// **'دفع طلب'**
  String get walletTypeOrderPayment;

  /// No description provided for @walletTypeOrderRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد طلب'**
  String get walletTypeOrderRefund;

  /// No description provided for @walletTypeAdminCredit.
  ///
  /// In ar, this message translates to:
  /// **'رصيد مضاف'**
  String get walletTypeAdminCredit;

  /// No description provided for @walletTypeLoyaltyRedemption.
  ///
  /// In ar, this message translates to:
  /// **'استبدال نقاط'**
  String get walletTypeLoyaltyRedemption;

  /// No description provided for @walletTypeDriverCashRemainder.
  ///
  /// In ar, this message translates to:
  /// **'باقي نقدي'**
  String get walletTypeDriverCashRemainder;

  /// No description provided for @walletTypeAdjustment.
  ///
  /// In ar, this message translates to:
  /// **'تسوية رصيد'**
  String get walletTypeAdjustment;

  /// No description provided for @walletTypeExpiration.
  ///
  /// In ar, this message translates to:
  /// **'رصيد منتهي الصلاحية'**
  String get walletTypeExpiration;

  /// No description provided for @profileLoyaltyCardTitle.
  ///
  /// In ar, this message translates to:
  /// **'نقاط هاتلي'**
  String get profileLoyaltyCardTitle;

  /// No description provided for @loyaltyTitle.
  ///
  /// In ar, this message translates to:
  /// **'نقاط هاتلي'**
  String get loyaltyTitle;

  /// No description provided for @loyaltyBalanceLabel.
  ///
  /// In ar, this message translates to:
  /// **'رصيد النقاط'**
  String get loyaltyBalanceLabel;

  /// No description provided for @loyaltyPointsSuffix.
  ///
  /// In ar, this message translates to:
  /// **'نقطة'**
  String get loyaltyPointsSuffix;

  /// No description provided for @loyaltyHistoryTitle.
  ///
  /// In ar, this message translates to:
  /// **'سجل النقاط'**
  String get loyaltyHistoryTitle;

  /// No description provided for @loyaltyEmptyHistory.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد نشاط نقاط بعد'**
  String get loyaltyEmptyHistory;

  /// No description provided for @loyaltyTypeEarning.
  ///
  /// In ar, this message translates to:
  /// **'نقاط مكتسبة'**
  String get loyaltyTypeEarning;

  /// No description provided for @loyaltyTypeEarningReversed.
  ///
  /// In ar, this message translates to:
  /// **'نقاط معكوسة (استرداد)'**
  String get loyaltyTypeEarningReversed;

  /// No description provided for @loyaltyTypeRedemption.
  ///
  /// In ar, this message translates to:
  /// **'تم التحويل إلى المحفظة'**
  String get loyaltyTypeRedemption;

  /// No description provided for @loyaltyTypeAdminAdjustment.
  ///
  /// In ar, this message translates to:
  /// **'تسوية'**
  String get loyaltyTypeAdminAdjustment;

  /// No description provided for @loyaltyTypeExpiration.
  ///
  /// In ar, this message translates to:
  /// **'نقاط منتهية الصلاحية'**
  String get loyaltyTypeExpiration;

  /// No description provided for @loyaltyConvertAction.
  ///
  /// In ar, this message translates to:
  /// **'تحويل إلى المحفظة'**
  String get loyaltyConvertAction;

  /// No description provided for @loyaltyConvertSheetTitle.
  ///
  /// In ar, this message translates to:
  /// **'تحويل النقاط إلى المحفظة'**
  String get loyaltyConvertSheetTitle;

  /// No description provided for @loyaltyConvertSheetRule.
  ///
  /// In ar, this message translates to:
  /// **'كل 500 نقطة = 5 جنيه. حوّل بمضاعفات 100 نقطة، بحد أدنى 500 نقطة.'**
  String get loyaltyConvertSheetRule;

  /// No description provided for @loyaltyConvertAvailableLabel.
  ///
  /// In ar, this message translates to:
  /// **'المتاح'**
  String get loyaltyConvertAvailableLabel;

  /// No description provided for @loyaltyConvertAmountLabel.
  ///
  /// In ar, this message translates to:
  /// **'عدد النقاط للتحويل'**
  String get loyaltyConvertAmountLabel;

  /// No description provided for @loyaltyConvertAmountHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: 500'**
  String get loyaltyConvertAmountHint;

  /// No description provided for @loyaltyConvertSubmit.
  ///
  /// In ar, this message translates to:
  /// **'تحويل'**
  String get loyaltyConvertSubmit;

  /// No description provided for @loyaltyConvertSuccess.
  ///
  /// In ar, this message translates to:
  /// **'تم التحويل إلى محفظة هاتلي'**
  String get loyaltyConvertSuccess;

  /// No description provided for @loyaltyErrorInsufficientPoints.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد لديك نقاط كافية لهذا التحويل.'**
  String get loyaltyErrorInsufficientPoints;

  /// No description provided for @loyaltyErrorBelowMinimum.
  ///
  /// In ar, this message translates to:
  /// **'أدخل 500 نقطة على الأقل.'**
  String get loyaltyErrorBelowMinimum;

  /// No description provided for @loyaltyErrorInvalidMultiple.
  ///
  /// In ar, this message translates to:
  /// **'أدخل قيمة من مضاعفات 100 نقطة.'**
  String get loyaltyErrorInvalidMultiple;

  /// No description provided for @addressSetDefaultAction.
  ///
  /// In ar, this message translates to:
  /// **'اجعله الافتراضي'**
  String get addressSetDefaultAction;

  /// No description provided for @addressSetDefaultError.
  ///
  /// In ar, this message translates to:
  /// **'فشل تعيينه كعنوان افتراضي. حاول مرة أخرى.'**
  String get addressSetDefaultError;

  /// No description provided for @profileAppearanceTitle.
  ///
  /// In ar, this message translates to:
  /// **'المظهر'**
  String get profileAppearanceTitle;

  /// No description provided for @themeModeSystem.
  ///
  /// In ar, this message translates to:
  /// **'النظام'**
  String get themeModeSystem;

  /// No description provided for @themeModeLight.
  ///
  /// In ar, this message translates to:
  /// **'فاتح'**
  String get themeModeLight;

  /// No description provided for @themeModeDark.
  ///
  /// In ar, this message translates to:
  /// **'داكن'**
  String get themeModeDark;

  /// No description provided for @hatlyServicePricePending.
  ///
  /// In ar, this message translates to:
  /// **'سيتم تأكيد السعر أثناء تجهيز الطلب'**
  String get hatlyServicePricePending;

  /// No description provided for @checkoutHatlyServiceCodNote.
  ///
  /// In ar, this message translates to:
  /// **'طلبات خدمة هاتلي تُدفع عند الاستلام فقط. سيتم تأكيد السعر أثناء تجهيز الطلب، وسيظهر لك الإجمالي النهائي في تفاصيل الطلب.'**
  String get checkoutHatlyServiceCodNote;

  /// No description provided for @cartErrorTooManyImages.
  ///
  /// In ar, this message translates to:
  /// **'عدد الصور أكبر من المسموح به لهذا الطلب.'**
  String get cartErrorTooManyImages;

  /// No description provided for @cartErrorInvalidImage.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر استخدام إحدى الصور. أعد رفعها وحاول مرة أخرى.'**
  String get cartErrorInvalidImage;

  /// No description provided for @cartErrorContentRequired.
  ///
  /// In ar, this message translates to:
  /// **'اكتب وصف الطلب أو أرفق صورة.'**
  String get cartErrorContentRequired;

  /// No description provided for @serviceTemporarilyUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذه الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا أو التواصل مع هاتلي.'**
  String get serviceTemporarilyUnavailable;

  /// No description provided for @checkoutErrorAddressRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر عنوان التوصيل أولًا ثم أعد المحاولة.'**
  String get checkoutErrorAddressRequired;

  /// No description provided for @checkoutErrorEmptyCart.
  ///
  /// In ar, this message translates to:
  /// **'سلتك فارغة. أضف طلبًا ثم حاول مرة أخرى.'**
  String get checkoutErrorEmptyCart;

  /// No description provided for @checkoutErrorNoActiveCart.
  ///
  /// In ar, this message translates to:
  /// **'لم نجد سلة نشطة لإتمام الطلب. ربما تم إرسال طلبك بالفعل — راجع قائمة الطلبات.'**
  String get checkoutErrorNoActiveCart;

  /// No description provided for @checkoutErrorQuoteRequired.
  ///
  /// In ar, this message translates to:
  /// **'راجع ملخص الطلب ثم أكّد الطلب مرة أخرى.'**
  String get checkoutErrorQuoteRequired;

  /// No description provided for @checkoutErrorPaymentMethodRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر طريقة الدفع.'**
  String get checkoutErrorPaymentMethodRequired;

  /// No description provided for @checkoutErrorOnlinePaymentUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الدفع الإلكتروني غير متاح حاليًا.'**
  String get checkoutErrorOnlinePaymentUnavailable;

  /// No description provided for @addressZoneSection.
  ///
  /// In ar, this message translates to:
  /// **'منطقة التوصيل'**
  String get addressZoneSection;

  /// No description provided for @addressZoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'المنطقة'**
  String get addressZoneLabel;

  /// No description provided for @addressZoneHelp.
  ///
  /// In ar, this message translates to:
  /// **'المنطقة اللي بتختارها هي اللي بتحدد إذا كان التوصيل متاح وقيمة رسوم التوصيل.'**
  String get addressZoneHelp;

  /// No description provided for @addressZoneRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختار المنطقة'**
  String get addressZoneRequired;

  /// No description provided for @addressZoneFeeHint.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل للمنطقة دي: {fee} — الرسوم النهائية بتتأكد في صفحة الدفع.'**
  String addressZoneFeeHint(String fee);

  /// No description provided for @addressZonesLoadError.
  ///
  /// In ar, this message translates to:
  /// **'معرفناش نحمّل مناطق التوصيل. حاول تاني.'**
  String get addressZonesLoadError;

  /// No description provided for @addressZonesEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مناطق توصيل متاحة بعد، لذلك لا يمكن حفظ عنوان الآن. حاول مرة أخرى لاحقًا.'**
  String get addressZonesEmpty;

  /// No description provided for @addressDetailedLabel.
  ///
  /// In ar, this message translates to:
  /// **'العنوان بالتفصيل'**
  String get addressDetailedLabel;

  /// No description provided for @addressDetailedHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: شارع أبو نصيب جنب جامع الكردي، منزل 15'**
  String get addressDetailedHint;

  /// No description provided for @addressLocationOptionalSection.
  ///
  /// In ar, this message translates to:
  /// **'الموقع على الخريطة (اختياري)'**
  String get addressLocationOptionalSection;

  /// No description provided for @addressLocationOptionalHelp.
  ///
  /// In ar, this message translates to:
  /// **'تحديد الموقع بيساعد المندوب يوصلك أسرع، بس مش مطلوب عشان تحفظ العنوان.'**
  String get addressLocationOptionalHelp;

  /// No description provided for @addressRemoveLocation.
  ///
  /// In ar, this message translates to:
  /// **'شيل الموقع'**
  String get addressRemoveLocation;

  /// No description provided for @addressZoneMissingBanner.
  ///
  /// In ar, this message translates to:
  /// **'العنوان ده محتاج تختار له منطقة التوصيل قبل ما تطلب عليه.'**
  String get addressZoneMissingBanner;

  /// No description provided for @addressZoneUnavailableBanner.
  ///
  /// In ar, this message translates to:
  /// **'منطقة التوصيل بتاعة العنوان ده مش متاحة دلوقتي. اختار منطقة تانية.'**
  String get addressZoneUnavailableBanner;

  /// No description provided for @addressChooseZoneAction.
  ///
  /// In ar, this message translates to:
  /// **'اختار المنطقة'**
  String get addressChooseZoneAction;

  /// No description provided for @checkoutAddressZoneRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختار منطقة التوصيل للعنوان ده عشان نقدر نوصّلك.'**
  String get checkoutAddressZoneRequired;

  /// No description provided for @checkoutAddressZoneUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي مش بيوصّل للمنطقة دي دلوقتي. اختار منطقة أو عنوان تاني.'**
  String get checkoutAddressZoneUnavailable;

  /// No description provided for @checkoutDeliveryZonePricing.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل حسب المنطقة: {area}'**
  String checkoutDeliveryZonePricing(String area);

  /// No description provided for @addressZoneAutoSelected.
  ///
  /// In ar, this message translates to:
  /// **'دي المنطقة الوحيدة المتاحة في المدينة دي، فاخترناها لك.'**
  String get addressZoneAutoSelected;

  /// No description provided for @addressCityNoZones.
  ///
  /// In ar, this message translates to:
  /// **'مفيش مناطق توصيل متاحة في المدينة دي دلوقتي.'**
  String get addressCityNoZones;

  /// No description provided for @guestSignInTitle.
  ///
  /// In ar, this message translates to:
  /// **'سجّل الدخول للمتابعة'**
  String get guestSignInTitle;

  /// No description provided for @guestSignInBody.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ حسابًا أو سجّل الدخول لاستخدام السلة والطلبات والملف الشخصي.'**
  String get guestSignInBody;

  /// No description provided for @guestSignInAction.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول أو إنشاء حساب'**
  String get guestSignInAction;

  /// No description provided for @guestBrowseAction.
  ///
  /// In ar, this message translates to:
  /// **'تصفح بدون حساب'**
  String get guestBrowseAction;

  /// No description provided for @weightEntryTitle.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الوزن'**
  String get weightEntryTitle;

  /// No description provided for @weightEntryHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: 1.5'**
  String get weightEntryHint;

  /// No description provided for @weightEntryConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الوزن'**
  String get weightEntryConfirm;

  /// No description provided for @weightEntryTooltip.
  ///
  /// In ar, this message translates to:
  /// **'اكتب الوزن'**
  String get weightEntryTooltip;

  /// No description provided for @weightEntryInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل وزنًا بين {min} و{max}'**
  String weightEntryInvalid(String min, String max);

  /// No description provided for @weightGramsShort.
  ///
  /// In ar, this message translates to:
  /// **'{grams} جم'**
  String weightGramsShort(int grams);

  /// No description provided for @weightKgShort.
  ///
  /// In ar, this message translates to:
  /// **'{kg} كجم'**
  String weightKgShort(String kg);

  /// No description provided for @addressPickerHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر عنوانًا محفوظًا'**
  String get addressPickerHint;

  /// No description provided for @addressPickerNoPin.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد موقع على الخريطة — أضفه من عناويني'**
  String get addressPickerNoPin;

  /// No description provided for @addressPickerNeedsPin.
  ///
  /// In ar, this message translates to:
  /// **'هذا العنوان بلا موقع على الخريطة فلا يمكن استخدامه هنا. أضف له موقعًا أولًا.'**
  String get addressPickerNeedsPin;

  /// No description provided for @hatlyServiceRouteBuy.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي تشتري من {place} وتوصّل إلى عنوان التوصيل الخاص بك'**
  String hatlyServiceRouteBuy(String place);

  /// No description provided for @hatlyServiceRouteDeliver.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي تستلم من عنوان التوصيل الخاص بك وتوصّل إلى {place}'**
  String hatlyServiceRouteDeliver(String place);

  /// No description provided for @hatlyServiceRoutePlaceUnset.
  ///
  /// In ar, this message translates to:
  /// **'المكان الذي تختاره'**
  String get hatlyServiceRoutePlaceUnset;

  /// No description provided for @hatlyServiceDeliveryOnly.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل فقط'**
  String get hatlyServiceDeliveryOnly;

  /// No description provided for @homeSectionMostOrdered.
  ///
  /// In ar, this message translates to:
  /// **'الأكثر طلبًا'**
  String get homeSectionMostOrdered;

  /// No description provided for @homeSectionNew.
  ///
  /// In ar, this message translates to:
  /// **'الجديد'**
  String get homeSectionNew;

  /// No description provided for @homeSeeAllOffersTitle.
  ///
  /// In ar, this message translates to:
  /// **'العروض'**
  String get homeSeeAllOffersTitle;

  /// No description provided for @homeSeeAllEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد شيء هنا بعد'**
  String get homeSeeAllEmpty;

  /// No description provided for @notificationsTitle.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notificationsTitle;

  /// No description provided for @notificationsEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد إشعارات بعد'**
  String get notificationsEmptyTitle;

  /// No description provided for @notificationsEmptyBody.
  ///
  /// In ar, this message translates to:
  /// **'سنخبرك هنا بكل تحديث على طلباتك.'**
  String get notificationsEmptyBody;

  /// No description provided for @notificationsLoadError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل الإشعارات'**
  String get notificationsLoadError;

  /// No description provided for @notificationsMarkAllRead.
  ///
  /// In ar, this message translates to:
  /// **'تحديد الكل كمقروء'**
  String get notificationsMarkAllRead;

  /// No description provided for @notificationsBellLabel.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notificationsBellLabel;

  /// No description provided for @notificationsBellLabelUnread.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات، {count} غير مقروء'**
  String notificationsBellLabelUnread(int count);

  /// No description provided for @notificationsUnread.
  ///
  /// In ar, this message translates to:
  /// **'غير مقروء'**
  String get notificationsUnread;

  /// No description provided for @notificationOrderPlacedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم استلام طلبك'**
  String get notificationOrderPlacedTitle;

  /// No description provided for @notificationOrderPlacedBody.
  ///
  /// In ar, this message translates to:
  /// **'استلمنا طلبك رقم {orderNumber}.'**
  String notificationOrderPlacedBody(String orderNumber);

  /// No description provided for @notificationOrderConfirmedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد طلبك'**
  String get notificationOrderConfirmedTitle;

  /// No description provided for @notificationOrderConfirmedBody.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد طلبك رقم {orderNumber}.'**
  String notificationOrderConfirmedBody(String orderNumber);

  /// No description provided for @notificationOrderPreparingTitle.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تجهيز طلبك'**
  String get notificationOrderPreparingTitle;

  /// No description provided for @notificationOrderPreparingBody.
  ///
  /// In ar, this message translates to:
  /// **'بدأ تجهيز طلبك رقم {orderNumber}.'**
  String notificationOrderPreparingBody(String orderNumber);

  /// No description provided for @notificationOrderReadyForPickupTitle.
  ///
  /// In ar, this message translates to:
  /// **'طلبك جاهز للاستلام'**
  String get notificationOrderReadyForPickupTitle;

  /// No description provided for @notificationOrderReadyForPickupBody.
  ///
  /// In ar, this message translates to:
  /// **'طلبك رقم {orderNumber} جاهز، يمكنك استلامه من الفرع.'**
  String notificationOrderReadyForPickupBody(String orderNumber);

  /// No description provided for @notificationOrderOnTheWayTitle.
  ///
  /// In ar, this message translates to:
  /// **'طلبك في الطريق'**
  String get notificationOrderOnTheWayTitle;

  /// No description provided for @notificationOrderOnTheWayBody.
  ///
  /// In ar, this message translates to:
  /// **'طلبك رقم {orderNumber} في الطريق إليك.'**
  String notificationOrderOnTheWayBody(String orderNumber);

  /// No description provided for @notificationOrderDeliveredTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم توصيل طلبك'**
  String get notificationOrderDeliveredTitle;

  /// No description provided for @notificationOrderDeliveredBody.
  ///
  /// In ar, this message translates to:
  /// **'تم توصيل طلبك رقم {orderNumber}.'**
  String notificationOrderDeliveredBody(String orderNumber);

  /// No description provided for @notificationOrderCollectedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم استلام طلبك'**
  String get notificationOrderCollectedTitle;

  /// No description provided for @notificationOrderCollectedBody.
  ///
  /// In ar, this message translates to:
  /// **'تم استلام طلبك رقم {orderNumber}.'**
  String notificationOrderCollectedBody(String orderNumber);

  /// No description provided for @notificationOrderCancelledTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء طلبك'**
  String get notificationOrderCancelledTitle;

  /// No description provided for @notificationOrderCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء طلبك رقم {orderNumber}.'**
  String notificationOrderCancelledBody(String orderNumber);

  /// No description provided for @notificationOrderFailedDeliveryTitle.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر توصيل طلبك'**
  String get notificationOrderFailedDeliveryTitle;

  /// No description provided for @notificationOrderFailedDeliveryBody.
  ///
  /// In ar, this message translates to:
  /// **'لم نتمكن من توصيل طلبك رقم {orderNumber}.'**
  String notificationOrderFailedDeliveryBody(String orderNumber);

  /// No description provided for @customRequestEntryHint.
  ///
  /// In ar, this message translates to:
  /// **'اكتب الصنف أو أضف صورة، وسيتأكد المتجر منه ويحدد سعره.'**
  String get customRequestEntryHint;

  /// No description provided for @customRequestAdded.
  ///
  /// In ar, this message translates to:
  /// **'تمت الإضافة إلى سلتك — سيؤكد المتجر توفر الصنف ويحدد سعره.'**
  String get customRequestAdded;

  /// No description provided for @cartErrorCustomRequestsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا المتجر لا يقبل الطلبات المخصصة.'**
  String get cartErrorCustomRequestsUnavailable;

  /// No description provided for @optionChooseBetween.
  ///
  /// In ar, this message translates to:
  /// **'اختر من {min} إلى {max}'**
  String optionChooseBetween(int min, int max);

  /// No description provided for @optionChooseAtLeast.
  ///
  /// In ar, this message translates to:
  /// **'اختر {min} على الأقل'**
  String optionChooseAtLeast(int min);

  /// No description provided for @optionChooseUpTo.
  ///
  /// In ar, this message translates to:
  /// **'اختر حتى {max}'**
  String optionChooseUpTo(int max);

  /// No description provided for @optionMinError.
  ///
  /// In ar, this message translates to:
  /// **'اختر {min} على الأقل'**
  String optionMinError(int min);

  /// No description provided for @optionMaxReached.
  ///
  /// In ar, this message translates to:
  /// **'يمكنك اختيار {max} كحد أقصى'**
  String optionMaxReached(int max);

  /// No description provided for @cartErrorOptionLimit.
  ///
  /// In ar, this message translates to:
  /// **'أحد الاختيارات خارج ما يسمح به هذا المنتج — راجع اختياراتك.'**
  String get cartErrorOptionLimit;

  /// No description provided for @deleteAccountAction.
  ///
  /// In ar, this message translates to:
  /// **'حذف حسابي'**
  String get deleteAccountAction;

  /// No description provided for @deleteAccountTitle.
  ///
  /// In ar, this message translates to:
  /// **'حذف الحساب نهائيًا'**
  String get deleteAccountTitle;

  /// No description provided for @deleteAccountExplanation.
  ///
  /// In ar, this message translates to:
  /// **'سيتم حذف بياناتك الشخصية (الاسم ورقم الهاتف والعناوين المحفوظة والإشعارات والمفضلة وسلة التسوق). تبقى سجلات الطلبات والمدفوعات المنتهية بدون أي بيانات تعرّف بك، لأن المتاجر والسائقين وهاتلي يحتاجونها للمحاسبة. ستفقد نقاط هاتلي. لا يمكن التراجع عن هذا الإجراء.'**
  String get deleteAccountExplanation;

  /// No description provided for @deleteAccountRequirements.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن حذف الحساب أثناء وجود طلب قيد التنفيذ أو رصيد في محفظة هاتلي.'**
  String get deleteAccountRequirements;

  /// No description provided for @deleteAccountPasswordHint.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور للتأكيد'**
  String get deleteAccountPasswordHint;

  /// No description provided for @deleteAccountConfirm.
  ///
  /// In ar, this message translates to:
  /// **'حذف الحساب'**
  String get deleteAccountConfirm;

  /// No description provided for @deleteAccountCancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get deleteAccountCancel;

  /// No description provided for @deleteAccountPasswordRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور لتأكيد الحذف'**
  String get deleteAccountPasswordRequired;

  /// No description provided for @deleteAccountErrorPassword.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور غير صحيحة'**
  String get deleteAccountErrorPassword;

  /// No description provided for @deleteAccountErrorActiveOrders.
  ///
  /// In ar, this message translates to:
  /// **'لديك طلب قيد التنفيذ. يمكنك حذف حسابك بعد انتهائه.'**
  String get deleteAccountErrorActiveOrders;

  /// No description provided for @deleteAccountErrorWalletBalance.
  ///
  /// In ar, this message translates to:
  /// **'محفظة هاتلي ليست فارغة. تواصل مع دعم هاتلي لتسويتها قبل حذف الحساب.'**
  String get deleteAccountErrorWalletBalance;

  /// No description provided for @deleteAccountErrorGeneric.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر حذف الحساب. حاول مرة أخرى.'**
  String get deleteAccountErrorGeneric;

  /// No description provided for @homeNoStoresTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد متاجر متاحة بعد'**
  String get homeNoStoresTitle;

  /// No description provided for @homeNoStoresBody.
  ///
  /// In ar, this message translates to:
  /// **'ستظهر المتاجر والأقسام هنا بمجرد توفرها في منطقتك. تفقّد التطبيق مرة أخرى قريبًا.'**
  String get homeNoStoresBody;

  /// No description provided for @phoneEgyptOnly.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي تقبل حاليًا أرقام الموبايل المصرية فقط (+20).'**
  String get phoneEgyptOnly;

  /// No description provided for @addressMapLocationSaved.
  ///
  /// In ar, this message translates to:
  /// **'تم حفظ الموقع على الخريطة'**
  String get addressMapLocationSaved;

  /// No description provided for @addressTextOnly.
  ///
  /// In ar, this message translates to:
  /// **'عنوان نصي فقط — بدون موقع على الخريطة'**
  String get addressTextOnly;

  /// No description provided for @addressMethodTitle.
  ///
  /// In ar, this message translates to:
  /// **'إزاي عايز تضيف عنوانك؟'**
  String get addressMethodTitle;

  /// No description provided for @addressMethodSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'اختار طريقة واحدة بس — مش محتاج الاتنين.'**
  String get addressMethodSubtitle;

  /// No description provided for @addressMethodGpsTitle.
  ///
  /// In ar, this message translates to:
  /// **'استخدم موقعي الحالي (GPS)'**
  String get addressMethodGpsTitle;

  /// No description provided for @addressMethodGpsHint.
  ///
  /// In ar, this message translates to:
  /// **'بنقرأ موقعك ونحسب التوصيل على حسب مسافة الطريق. مش محتاج تختار منطقة ولا تكتب عنوان.'**
  String get addressMethodGpsHint;

  /// No description provided for @addressMethodManualTitle.
  ///
  /// In ar, this message translates to:
  /// **'هكتب عنواني بنفسي'**
  String get addressMethodManualTitle;

  /// No description provided for @addressMethodManualHint.
  ///
  /// In ar, this message translates to:
  /// **'اختار منطقتك واكتب عنوانك بالتفصيل. التوصيل بسعر المنطقة الثابت. مفيش طلب لموقعك.'**
  String get addressMethodManualHint;

  /// No description provided for @addressMethodGpsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل بالموقع (GPS) مش متاح دلوقتي. اكتب عنوانك بنفسك.'**
  String get addressMethodGpsUnavailable;

  /// No description provided for @addressChangeMethod.
  ///
  /// In ar, this message translates to:
  /// **'تغيير طريقة العنوان'**
  String get addressChangeMethod;

  /// No description provided for @addressChangeMethodTitle.
  ///
  /// In ar, this message translates to:
  /// **'تغيير طريقة العنوان؟'**
  String get addressChangeMethodTitle;

  /// No description provided for @addressChangeMethodDiscardsGps.
  ///
  /// In ar, this message translates to:
  /// **'هيتم مسح الموقع اللي اتحدد.'**
  String get addressChangeMethodDiscardsGps;

  /// No description provided for @addressChangeMethodDiscardsManual.
  ///
  /// In ar, this message translates to:
  /// **'هيتم مسح المنطقة المختارة والعنوان اللي كتبته.'**
  String get addressChangeMethodDiscardsManual;

  /// No description provided for @addressChangeMethodConfirm.
  ///
  /// In ar, this message translates to:
  /// **'غيّر الطريقة'**
  String get addressChangeMethodConfirm;

  /// No description provided for @addressGpsJourneyTitle.
  ///
  /// In ar, this message translates to:
  /// **'موقعك'**
  String get addressGpsJourneyTitle;

  /// No description provided for @addressGpsHelp.
  ///
  /// In ar, this message translates to:
  /// **'اضغط على الزر لمشاركة موقعك الحالي. مش محتاج تختار منطقة ولا تكتب عنوان.'**
  String get addressGpsHelp;

  /// No description provided for @addressGpsDetected.
  ///
  /// In ar, this message translates to:
  /// **'تم تحديد موقعك'**
  String get addressGpsDetected;

  /// No description provided for @addressGpsFeeNote.
  ///
  /// In ar, this message translates to:
  /// **'سعر التوصيل بيتحسب عند إتمام الطلب من مسافة الطريق. أي مبلغ يظهر قبل كده هو تقدير فقط.'**
  String get addressGpsFeeNote;

  /// No description provided for @addressGpsNeedLocation.
  ///
  /// In ar, this message translates to:
  /// **'شارك موقعك الأول عشان تكمّل.'**
  String get addressGpsNeedLocation;

  /// No description provided for @addressGpsOutsideCoverage.
  ///
  /// In ar, this message translates to:
  /// **'هاتلي لا توصّل للموقع ده لسه.'**
  String get addressGpsOutsideCoverage;

  /// No description provided for @addressGpsInvalidLocation.
  ///
  /// In ar, this message translates to:
  /// **'مقدرناش نستخدم الموقع ده. جرّب تاني.'**
  String get addressGpsInvalidLocation;

  /// No description provided for @addressGpsSaved.
  ///
  /// In ar, this message translates to:
  /// **'موقع GPS'**
  String get addressGpsSaved;

  /// No description provided for @addressManualJourneyTitle.
  ///
  /// In ar, this message translates to:
  /// **'عنوان مكتوب'**
  String get addressManualJourneyTitle;

  /// No description provided for @addressGpsJourneyBadge.
  ///
  /// In ar, this message translates to:
  /// **'طريقة GPS'**
  String get addressGpsJourneyBadge;

  /// No description provided for @addressManualJourneyBadge.
  ///
  /// In ar, this message translates to:
  /// **'طريقة العنوان المكتوب'**
  String get addressManualJourneyBadge;

  /// No description provided for @addressMethodsLoading.
  ///
  /// In ar, this message translates to:
  /// **'بنجهّز طرق العنوان…'**
  String get addressMethodsLoading;

  /// No description provided for @routeSectionTitle.
  ///
  /// In ar, this message translates to:
  /// **'مسار الطلب'**
  String get routeSectionTitle;

  /// No description provided for @routeFromLabel.
  ///
  /// In ar, this message translates to:
  /// **'من'**
  String get routeFromLabel;

  /// No description provided for @routeToLabel.
  ///
  /// In ar, this message translates to:
  /// **'إلى'**
  String get routeToLabel;

  /// No description provided for @routeBadgeDefault.
  ///
  /// In ar, this message translates to:
  /// **'افتراضي'**
  String get routeBadgeDefault;

  /// No description provided for @routeBadgeChosen.
  ///
  /// In ar, this message translates to:
  /// **'من اختيارك'**
  String get routeBadgeChosen;

  /// No description provided for @routeChange.
  ///
  /// In ar, this message translates to:
  /// **'تغيير'**
  String get routeChange;

  /// No description provided for @routeChoose.
  ///
  /// In ar, this message translates to:
  /// **'اختيار'**
  String get routeChoose;

  /// No description provided for @routeNotSet.
  ///
  /// In ar, this message translates to:
  /// **'لم يُحدد بعد'**
  String get routeNotSet;

  /// No description provided for @routeDefaultMissingHint.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد نقطة افتراضية حاليًا — اختر نقطة.'**
  String get routeDefaultMissingHint;

  /// No description provided for @routeOriginRequiredHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر المكان اللي هيتم الاستلام منه.'**
  String get routeOriginRequiredHint;

  /// No description provided for @routeSheetTitleOrigin.
  ///
  /// In ar, this message translates to:
  /// **'اختر نقطة البداية'**
  String get routeSheetTitleOrigin;

  /// No description provided for @routeSheetTitleDestination.
  ///
  /// In ar, this message translates to:
  /// **'اختر الوجهة'**
  String get routeSheetTitleDestination;

  /// No description provided for @routeSheetPointSection.
  ///
  /// In ar, this message translates to:
  /// **'موقعك الحالي أو نقطة على الخريطة'**
  String get routeSheetPointSection;

  /// No description provided for @routeSheetSavedSection.
  ///
  /// In ar, this message translates to:
  /// **'من عناويني المحفوظة'**
  String get routeSheetSavedSection;

  /// No description provided for @routeNameThisPlace.
  ///
  /// In ar, this message translates to:
  /// **'سمّ المكان (اختياري)'**
  String get routeNameThisPlace;

  /// No description provided for @routeNameThisPlaceHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: بيت ماما'**
  String get routeNameThisPlaceHint;

  /// No description provided for @routeUseDefault.
  ///
  /// In ar, this message translates to:
  /// **'استخدام النقطة الافتراضية'**
  String get routeUseDefault;

  /// No description provided for @routeConfirmPoint.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد هذه النقطة'**
  String get routeConfirmPoint;

  /// No description provided for @routeCurrentLocationLabel.
  ///
  /// In ar, this message translates to:
  /// **'موقعي الحالي'**
  String get routeCurrentLocationLabel;

  /// No description provided for @routeSelectedPointLabel.
  ///
  /// In ar, this message translates to:
  /// **'نقطة محددة'**
  String get routeSelectedPointLabel;

  /// No description provided for @routeDirectionNote.
  ///
  /// In ar, this message translates to:
  /// **'الاتجاه: من النقطة الأولى إلى الثانية.'**
  String get routeDirectionNote;

  /// No description provided for @routeOrderSectionTitle.
  ///
  /// In ar, this message translates to:
  /// **'مسار الطلب'**
  String get routeOrderSectionTitle;

  /// No description provided for @cartErrorAdHocOriginRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر مكان الاستلام لهذا الطلب قبل إضافته للسلة.'**
  String get cartErrorAdHocOriginRequired;

  /// No description provided for @checkoutBlockerAdHocOriginRequired.
  ///
  /// In ar, this message translates to:
  /// **'طلب وصّلي لمكان ده من غير نقطة استلام. اختر نقطة الاستلام وأضفه تاني.'**
  String get checkoutBlockerAdHocOriginRequired;

  /// No description provided for @checkoutBlockerHatlyDefaultPickupMissing.
  ///
  /// In ar, this message translates to:
  /// **'نقطة البداية الافتراضية لهاتلي لسه متظبطتش. اختر نقطة بداية لطلبك.'**
  String get checkoutBlockerHatlyDefaultPickupMissing;

  /// No description provided for @checkoutBlockerHatlyDefaultDestinationMissing.
  ///
  /// In ar, this message translates to:
  /// **'الوجهة الافتراضية لهاتلي لسه متظبطتش. اختر وجهة لطلبك.'**
  String get checkoutBlockerHatlyDefaultDestinationMissing;

  /// No description provided for @checkoutBlockerWasallyDefaultDestinationMissing.
  ///
  /// In ar, this message translates to:
  /// **'الوجهة الافتراضية لوصّلي لسه متظبطتش. اختر وجهة لطلبك.'**
  String get checkoutBlockerWasallyDefaultDestinationMissing;

  /// No description provided for @orderPartCancelledTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء جزء من طلبك'**
  String get orderPartCancelledTitle;

  /// No description provided for @orderPartCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر على {rejected} من {total} بائعين تجهيز جزئهم. يستمر باقي طلبك.'**
  String orderPartCancelledBody(int rejected, int total);

  /// No description provided for @orderPartCancelledNoCharge.
  ///
  /// In ar, this message translates to:
  /// **'لن يتم تحصيل مبلغ الجزء الملغي منك.'**
  String get orderPartCancelledNoCharge;

  /// No description provided for @orderRejectionReasonLine.
  ///
  /// In ar, this message translates to:
  /// **'السبب: {reason}'**
  String orderRejectionReasonLine(String reason);

  /// No description provided for @orderRefundWalletLine.
  ///
  /// In ar, this message translates to:
  /// **'تمت إعادة {amount} إلى محفظتك.'**
  String orderRefundWalletLine(String amount);

  /// No description provided for @orderRefundTransferPendingLine.
  ///
  /// In ar, this message translates to:
  /// **'سيعيد لك هاتلي مبلغ {amount}. سنحدّث الحالة عند إرساله.'**
  String orderRefundTransferPendingLine(String amount);

  /// No description provided for @orderRefundTransferSentLine.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال {amount} إليك.'**
  String orderRefundTransferSentLine(String amount);

  /// No description provided for @orderRefundReviewLine.
  ///
  /// In ar, this message translates to:
  /// **'سيتم تسوية {amount} بعد مراجعة دفعتك.'**
  String orderRefundReviewLine(String amount);

  /// No description provided for @notificationOrderPartCancelledTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء جزء من طلبك'**
  String get notificationOrderPartCancelledTitle;

  /// No description provided for @notificationOrderPartCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر على أحد البائعين تجهيز جزئه من الطلب رقم {orderNumber}. يستمر باقي طلبك.'**
  String notificationOrderPartCancelledBody(String orderNumber);

  /// No description provided for @itemUnavailableTitle.
  ///
  /// In ar, this message translates to:
  /// **'بعض المنتجات غير متوفرة'**
  String get itemUnavailableTitle;

  /// No description provided for @itemUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن تجهيز هذه المنتجات. اختر كيف تريد المتابعة — لن يتغير شيء حتى تقرر.'**
  String get itemUnavailableBody;

  /// No description provided for @itemUnavailableContinue.
  ///
  /// In ar, this message translates to:
  /// **'المتابعة بدونها'**
  String get itemUnavailableContinue;

  /// No description provided for @itemUnavailableCancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب كاملًا'**
  String get itemUnavailableCancel;

  /// No description provided for @itemUnavailableCancelConfirmTitle.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب كاملًا؟'**
  String get itemUnavailableCancelConfirmTitle;

  /// No description provided for @itemUnavailableCancelConfirmBody.
  ///
  /// In ar, this message translates to:
  /// **'سنحوّل طلبك إلى فريقنا لإلغاء هذا الطلب. تُرد المبالغ المدفوعة مسبقًا وفق قواعدنا المعتادة.'**
  String get itemUnavailableCancelConfirmBody;

  /// No description provided for @itemUnavailableCancelConfirmAction.
  ///
  /// In ar, this message translates to:
  /// **'نعم، ألغِ الطلب'**
  String get itemUnavailableCancelConfirmAction;

  /// No description provided for @itemUnavailableKeepOrder.
  ///
  /// In ar, this message translates to:
  /// **'الإبقاء على الطلب'**
  String get itemUnavailableKeepOrder;

  /// No description provided for @itemUnavailableCancelRequested.
  ///
  /// In ar, this message translates to:
  /// **'استلمنا طلب الإلغاء. سيعالجه فريقنا ويتواصل معك عند الحاجة.'**
  String get itemUnavailableCancelRequested;

  /// No description provided for @itemUnavailableTeamContact.
  ///
  /// In ar, this message translates to:
  /// **'سيتواصل معك فريقنا بخصوص هذا الطلب.'**
  String get itemUnavailableTeamContact;

  /// No description provided for @itemUnavailableDone.
  ///
  /// In ar, this message translates to:
  /// **'تم — يستمر طلبك بدون هذه المنتجات.'**
  String get itemUnavailableDone;

  /// No description provided for @itemUnavailableError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال إجابتك. حاول مرة أخرى.'**
  String get itemUnavailableError;

  /// No description provided for @orderRemovedItemsTitle.
  ///
  /// In ar, this message translates to:
  /// **'تمت إزالتها من طلبك'**
  String get orderRemovedItemsTitle;

  /// No description provided for @notificationItemUnavailableTitle.
  ///
  /// In ar, this message translates to:
  /// **'منتج في طلبك غير متوفر'**
  String get notificationItemUnavailableTitle;

  /// No description provided for @notificationItemUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'افتح الطلب رقم {orderNumber} للمتابعة بدون المنتج أو لإلغاء الطلب.'**
  String notificationItemUnavailableBody(String orderNumber);

  /// No description provided for @cartCompatTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن إضافة هذا المنتج الآن'**
  String get cartCompatTitle;

  /// No description provided for @cartCompatMultiVendorDisabled.
  ///
  /// In ar, this message translates to:
  /// **'الطلب من أكثر من متجر غير متاح حاليًا. أكمل طلبك الحالي أو أفرغ السلة لتطلب من متجر آخر.'**
  String get cartCompatMultiVendorDisabled;

  /// No description provided for @cartCompatBranchPickupDisabled.
  ///
  /// In ar, this message translates to:
  /// **'هذا المتجر لا يوفّر الاستلام من الفرع.'**
  String get cartCompatBranchPickupDisabled;

  /// No description provided for @cartCompatSwitchToDelivery.
  ///
  /// In ar, this message translates to:
  /// **'التحويل إلى التوصيل وإضافة المنتج'**
  String get cartCompatSwitchToDelivery;

  /// No description provided for @cartCompatStartNewCart.
  ///
  /// In ar, this message translates to:
  /// **'إفراغ السلة وإضافة المنتج'**
  String get cartCompatStartNewCart;

  /// No description provided for @cartCompatKeepCart.
  ///
  /// In ar, this message translates to:
  /// **'الإبقاء على سلتي'**
  String get cartCompatKeepCart;

  /// No description provided for @cartCompatOk.
  ///
  /// In ar, this message translates to:
  /// **'حسنًا'**
  String get cartCompatOk;

  /// No description provided for @addressOpenLocationSettings.
  ///
  /// In ar, this message translates to:
  /// **'فتح إعدادات الموقع'**
  String get addressOpenLocationSettings;

  /// No description provided for @weightInlineLabel.
  ///
  /// In ar, this message translates to:
  /// **'أو اكتب الوزن بالكيلوغرام'**
  String get weightInlineLabel;

  /// No description provided for @weightEstimateNote.
  ///
  /// In ar, this message translates to:
  /// **'التقدير: {price} — يُحدَّد السعر النهائي حسب الوزن الفعلي عند التجهيز.'**
  String weightEstimateNote(String price);

  /// No description provided for @vendorClosedToday.
  ///
  /// In ar, this message translates to:
  /// **'مغلق اليوم'**
  String get vendorClosedToday;

  /// No description provided for @vendorOpen24Hours.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح 24 ساعة'**
  String get vendorOpen24Hours;

  /// No description provided for @vendorHoursToday.
  ///
  /// In ar, this message translates to:
  /// **'مواعيد اليوم: {hours}'**
  String vendorHoursToday(String hours);

  /// No description provided for @vendorClosedDialogTitle.
  ///
  /// In ar, this message translates to:
  /// **'{name} مغلق الآن'**
  String vendorClosedDialogTitle(String name);

  /// No description provided for @vendorClosedDialogBody.
  ///
  /// In ar, this message translates to:
  /// **'يمكنك تصفّح القائمة، لكن لا يمكن الطلب حتى يفتح المتجر.'**
  String get vendorClosedDialogBody;

  /// No description provided for @vendorClosedDialogClose.
  ///
  /// In ar, this message translates to:
  /// **'إغلاق'**
  String get vendorClosedDialogClose;

  /// No description provided for @vendorClosedDialogViewMenu.
  ///
  /// In ar, this message translates to:
  /// **'عرض القائمة'**
  String get vendorClosedDialogViewMenu;

  /// No description provided for @vendorClosedBanner.
  ///
  /// In ar, this message translates to:
  /// **'مغلق الآن — يمكنك تصفّح القائمة والطلب عند فتح المتجر.'**
  String get vendorClosedBanner;

  /// No description provided for @checkoutErrorStoreClosed.
  ///
  /// In ar, this message translates to:
  /// **'أحد المتاجر في سلتك مغلق الآن. احذف منتجاته أو اطلب عند فتحه.'**
  String get checkoutErrorStoreClosed;

  /// No description provided for @tempPasswordTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختر كلمة مرور جديدة'**
  String get tempPasswordTitle;

  /// No description provided for @tempPasswordExplanation.
  ///
  /// In ar, this message translates to:
  /// **'دخلت بكلمة مرور مؤقتة من هتلي. اختر كلمة مرور خاصة بك للمتابعة.'**
  String get tempPasswordExplanation;

  /// No description provided for @tempPasswordCurrentLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور المؤقتة'**
  String get tempPasswordCurrentLabel;

  /// No description provided for @tempPasswordConfirmLabel.
  ///
  /// In ar, this message translates to:
  /// **'أعد كتابة كلمة المرور الجديدة'**
  String get tempPasswordConfirmLabel;

  /// No description provided for @tempPasswordSave.
  ///
  /// In ar, this message translates to:
  /// **'حفظ ومتابعة'**
  String get tempPasswordSave;

  /// No description provided for @tempPasswordSignOut.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج'**
  String get tempPasswordSignOut;

  /// No description provided for @tempPasswordMismatch.
  ///
  /// In ar, this message translates to:
  /// **'كلمتا المرور الجديدتان غير متطابقتين.'**
  String get tempPasswordMismatch;

  /// No description provided for @tempPasswordSameAsTemporary.
  ///
  /// In ar, this message translates to:
  /// **'اختر كلمة مرور مختلفة عن المؤقتة.'**
  String get tempPasswordSameAsTemporary;

  /// No description provided for @forgotPasswordLink.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور؟'**
  String get forgotPasswordLink;

  /// No description provided for @forgotTitle.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور؟'**
  String get forgotTitle;

  /// No description provided for @forgotExplain.
  ///
  /// In ar, this message translates to:
  /// **'أرسل طلبًا إلى هتلي. سنتصل بك للتأكد أنك أنت ونعطيك كلمة مرور مؤقتة (صالحة 60 دقيقة).'**
  String get forgotExplain;

  /// No description provided for @forgotSend.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب'**
  String get forgotSend;

  /// No description provided for @forgotHaveTemp.
  ///
  /// In ar, this message translates to:
  /// **'لدي كلمة مرور مؤقتة'**
  String get forgotHaveTemp;

  /// No description provided for @forgotSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال الطلب. عندما تعطيك هتلي كلمة مرور مؤقتة، اكتبها هنا مع كلمة مرورك الجديدة.'**
  String get forgotSent;

  /// No description provided for @forgotTempLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور المؤقتة'**
  String get forgotTempLabel;

  /// No description provided for @forgotNewLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الجديدة'**
  String get forgotNewLabel;

  /// No description provided for @forgotConfirmLabel.
  ///
  /// In ar, this message translates to:
  /// **'أعد كتابة كلمة المرور الجديدة'**
  String get forgotConfirmLabel;

  /// No description provided for @forgotChange.
  ///
  /// In ar, this message translates to:
  /// **'تغيير كلمة المرور'**
  String get forgotChange;

  /// No description provided for @forgotDone.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير كلمة المرور. ادخل بها الآن.'**
  String get forgotDone;

  /// No description provided for @forgotBackToSignIn.
  ///
  /// In ar, this message translates to:
  /// **'العودة لتسجيل الدخول'**
  String get forgotBackToSignIn;

  /// No description provided for @forgotCancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء — أتذكر كلمة المرور'**
  String get forgotCancel;

  /// No description provided for @forgotTempInvalid.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور المؤقتة غير صحيحة (أو لم تُعطَ بعد).'**
  String get forgotTempInvalid;

  /// No description provided for @forgotTriesLeft.
  ///
  /// In ar, this message translates to:
  /// **'متبقٍ {n} محاولات.'**
  String forgotTriesLeft(String n);

  /// No description provided for @forgotExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية كلمة المرور المؤقتة. أرسل طلبًا جديدًا.'**
  String get forgotExpired;

  /// No description provided for @forgotLocked.
  ///
  /// In ar, this message translates to:
  /// **'محاولات خاطئة كثيرة. أرسل طلبًا جديدًا.'**
  String get forgotLocked;

  /// No description provided for @addressVillageLabel.
  ///
  /// In ar, this message translates to:
  /// **'القرية / الحي'**
  String get addressVillageLabel;

  /// No description provided for @addressVillageRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر قريتك أو حيّك'**
  String get addressVillageRequired;

  /// No description provided for @homeDeliverTo.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل إلى'**
  String get homeDeliverTo;

  /// No description provided for @profileSettings.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get profileSettings;

  /// No description provided for @settingsLanguage.
  ///
  /// In ar, this message translates to:
  /// **'اللغة'**
  String get settingsLanguage;

  /// No description provided for @languageArabic.
  ///
  /// In ar, this message translates to:
  /// **'العربية'**
  String get languageArabic;

  /// No description provided for @languageEnglish.
  ///
  /// In ar, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @settingsPasswordSection.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور والأمان'**
  String get settingsPasswordSection;

  /// No description provided for @settingsAccountSection.
  ///
  /// In ar, this message translates to:
  /// **'الحساب'**
  String get settingsAccountSection;

  /// No description provided for @settingsAppSection.
  ///
  /// In ar, this message translates to:
  /// **'التطبيق'**
  String get settingsAppSection;

  /// No description provided for @searchFilterVendors.
  ///
  /// In ar, this message translates to:
  /// **'متاجر'**
  String get searchFilterVendors;

  /// No description provided for @searchFilterProducts.
  ///
  /// In ar, this message translates to:
  /// **'منتجات'**
  String get searchFilterProducts;

  /// No description provided for @vendorCustomBubbleLabel.
  ///
  /// In ar, this message translates to:
  /// **'خدمة هاتلي'**
  String get vendorCustomBubbleLabel;

  /// No description provided for @sectorHatlyExistingWasaly.
  ///
  /// In ar, this message translates to:
  /// **'لديك طلب «وصّلي لمكان» موجود بالفعل في السلة. هذه الصفحة تتيح «هاتلي من مكان» فقط. راجع السلة أولاً؛ لن يتم تغيير طلبك الحالي.'**
  String get sectorHatlyExistingWasaly;

  /// No description provided for @checkoutPromoNewCustomersOnly.
  ///
  /// In ar, this message translates to:
  /// **'هذا الكود للعملاء الجدد فقط.'**
  String get checkoutPromoNewCustomersOnly;

  /// No description provided for @checkoutPromoTooManyAttempts.
  ///
  /// In ar, this message translates to:
  /// **'أكواد خاطئة كثيرة. حاول مرة أخرى بعد ساعة.'**
  String get checkoutPromoTooManyAttempts;

  /// No description provided for @checkoutDeliveryFeeDiscounted.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل (بدلاً من {original})'**
  String checkoutDeliveryFeeDiscounted(String original);

  /// No description provided for @routeMapLinkSection.
  ///
  /// In ar, this message translates to:
  /// **'أو اختره من تطبيق الخرائط'**
  String get routeMapLinkSection;

  /// No description provided for @routeMapLinkHelp.
  ///
  /// In ar, this message translates to:
  /// **'افتح خرائط جوجل (أو خرائط آبل على الآيفون)، ضع دبوسًا على المكان، اضغط مشاركة ← نسخ، ثم الصق الرابط هنا.'**
  String get routeMapLinkHelp;

  /// No description provided for @routeMapLinkUse.
  ///
  /// In ar, this message translates to:
  /// **'استخدم الرابط'**
  String get routeMapLinkUse;

  /// No description provided for @routeOpenMapsApp.
  ///
  /// In ar, this message translates to:
  /// **'افتح تطبيق الخرائط'**
  String get routeOpenMapsApp;

  /// No description provided for @routeMapLinkNoLocation.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد موقع في هذا الرابط. انسخ رابط الدبوس وحاول مرة أخرى.'**
  String get routeMapLinkNoLocation;

  /// No description provided for @voiceNoteSection.
  ///
  /// In ar, this message translates to:
  /// **'رسالة صوتية (اختياري)'**
  String get voiceNoteSection;

  /// No description provided for @voiceNoteRecord.
  ///
  /// In ar, this message translates to:
  /// **'سجّل رسالة صوتية'**
  String get voiceNoteRecord;

  /// No description provided for @voiceNoteStop.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف'**
  String get voiceNoteStop;

  /// No description provided for @voiceNoteRecording.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ التسجيل…'**
  String get voiceNoteRecording;

  /// No description provided for @voiceNotePlay.
  ///
  /// In ar, this message translates to:
  /// **'تشغيل'**
  String get voiceNotePlay;

  /// No description provided for @voiceNoteStopPlaying.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف'**
  String get voiceNoteStopPlaying;

  /// No description provided for @voiceNoteDelete.
  ///
  /// In ar, this message translates to:
  /// **'حذف الرسالة الصوتية'**
  String get voiceNoteDelete;

  /// No description provided for @voiceNoteAttached.
  ///
  /// In ar, this message translates to:
  /// **'رسالة صوتية'**
  String get voiceNoteAttached;

  /// No description provided for @voiceNoteLimitHint.
  ///
  /// In ar, this message translates to:
  /// **'حتى 5 دقائق. يستمع إليها المندوب قبل الشراء.'**
  String get voiceNoteLimitHint;

  /// No description provided for @voiceNotePermissionDenied.
  ///
  /// In ar, this message translates to:
  /// **'يحتاج هاتلي إلى الميكروفون للتسجيل. اسمح به من إعدادات هاتفك.'**
  String get voiceNotePermissionDenied;

  /// No description provided for @voiceNoteTooShort.
  ///
  /// In ar, this message translates to:
  /// **'التسجيل قصير جدًا. حاول مرة أخرى.'**
  String get voiceNoteTooShort;

  /// No description provided for @voiceNoteFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تسجيل الرسالة الصوتية. حاول مرة أخرى.'**
  String get voiceNoteFailed;

  /// No description provided for @hatlyServiceContentHint.
  ///
  /// In ar, this message translates to:
  /// **'اكتب ما تحتاجه أو أضف صورة أو سجّل رسالة صوتية — يكفي واحد منها.'**
  String get hatlyServiceContentHint;
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
