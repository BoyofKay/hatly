// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Hatly Driver';

  @override
  String get goOnline => 'Go online';

  @override
  String get goOffline => 'Go offline';

  @override
  String get incomingRequest => 'New delivery request';

  @override
  String get accept => 'Accept';

  @override
  String get reject => 'Reject';

  @override
  String get pickupDetails => 'Pickup details';

  @override
  String get customerDetails => 'Customer details';

  @override
  String get navigate => 'Start navigation';

  @override
  String get markPickedUp => 'Mark picked up';

  @override
  String get markOnTheWay => 'Mark on the way';

  @override
  String get markDelivered => 'Mark delivered';

  @override
  String get earnings => 'Earnings';

  @override
  String get completedDeliveries => 'Completed deliveries';

  @override
  String get wallet => 'Wallet';

  @override
  String get profile => 'Profile';

  @override
  String get login => 'Log in';
}
