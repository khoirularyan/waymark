import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    try {
      await _plugin.initialize(settings: initSettings);

      // Request notification permission for Android 13+ (Tiramisu / API 33+)
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        final androidImpl = _plugin.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
        if (androidImpl != null) {
          await androidImpl.requestNotificationsPermission();
        }
      }
      _initialized = true;
    } catch (e) {
      debugPrint('NotificationService init error: $e');
    }
  }

  /// Plays sound, vibrates phone, and posts a heads-up system notification for an incoming spectator cheer.
  Future<void> notifyCheer({
    required String senderName,
    String? message,
    String emoji = '👏',
  }) async {
    // 1. Hardware vibration and audio feedback
    try {
      HapticFeedback.vibrate();
      SystemSound.play(SystemSoundType.alert);
    } catch (_) {}

    // 2. Android system notification (works even when app is in background or screen is off)
    try {
      final title = '$emoji Semangat dari $senderName!';
      final body = (message != null && message.trim().isNotEmpty)
          ? '"$message"'
          : 'Memberikan sorakan semangat untuk lari Anda!';

      final androidDetails = AndroidNotificationDetails(
        'waymark_cheers_v2',
        'Sorakan Semangat Penonton',
        channelDescription:
            'Bunyi dering dan getar saat penonton live tracking mengirimkan sorakan',
        importance: Importance.max,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
        vibrationPattern: Int64List.fromList([0, 200, 100, 300]),
        styleInformation: BigTextStyleInformation(body),
        ticker: title,
      );

      final details = NotificationDetails(android: androidDetails);
      final id = DateTime.now().millisecondsSinceEpoch % 100000;
      await _plugin.show(
        id: id,
        title: title,
        body: body,
        notificationDetails: details,
      );
    } catch (e) {
      debugPrint('Error posting cheer notification: $e');
    }
  }

  /// Notifies the runner when they wander off the official GPX course.
  Future<void> notifyOffCourse({required double distanceMeters}) async {
    try {
      HapticFeedback.heavyImpact();
      SystemSound.play(SystemSoundType.alert);
    } catch (_) {}

    try {
      final distStr = distanceMeters >= 1000
          ? '${(distanceMeters / 1000).toStringAsFixed(1)} km'
          : '${distanceMeters.round()} meter';

      const title = '⚠️ Keluar Jalur Rute!';
      final body =
          'Anda berada $distStr di luar rute resmi GPX. Harap periksa arah lintasan.';

      final androidDetails = AndroidNotificationDetails(
        'waymark_navigation',
        'Peringatan Navigasi Jalur',
        channelDescription:
            'Peringatan suara dan getar saat pelari menyimpang dari rute',
        importance: Importance.high,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
        vibrationPattern: Int64List.fromList([0, 300, 150, 300, 150, 400]),
        styleInformation: BigTextStyleInformation(body),
      );

      final details = NotificationDetails(android: androidDetails);
      await _plugin.show(
        id: 999,
        title: title,
        body: body,
        notificationDetails: details,
      );
    } catch (_) {}
  }
}
