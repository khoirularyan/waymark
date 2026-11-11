import 'dart:async';
import 'dart:convert';
import 'package:audioplayers/audioplayers.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart'
    show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gpx_parser.dart';
import 'notification_service.dart';
import 'tracking_api.dart';

const kBrandOrange = Color(0xFFE85D3F);
const kBrandGreen = Color(0xFF10B981);
const kInkDark = Color(0xFF171717);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const WaymarkApp());
}

class WaymarkApp extends StatefulWidget {
  const WaymarkApp({super.key});

  static WaymarkAppState of(BuildContext context) =>
      context.findAncestorStateOfType<WaymarkAppState>()!;

  @override
  State<WaymarkApp> createState() => WaymarkAppState();
}

class WaymarkAppState extends State<WaymarkApp> {
  ThemeMode _themeMode = ThemeMode.light;

  @override
  void initState() {
    super.initState();
    _loadTheme();
  }

  Future<void> _loadTheme() async {
    final prefs = await SharedPreferences.getInstance();
    final isDark = prefs.getBool('is_dark_mode') ?? false;
    setState(() {
      _themeMode = isDark ? ThemeMode.dark : ThemeMode.light;
    });
  }

  Future<void> toggleTheme() async {
    final next =
        _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    setState(() => _themeMode = next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('is_dark_mode', next == ThemeMode.dark);
  }

  bool get isDark => _themeMode == ThemeMode.dark;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Waymark',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        scaffoldBackgroundColor: const Color(0xFFFBFBFA),
        cardColor: Colors.white,
        colorScheme: ColorScheme.fromSeed(
          seedColor: kBrandOrange,
          primary: kBrandOrange,
          brightness: Brightness.light,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        cardColor: const Color(0xFF1E293B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: kBrandOrange,
          primary: kBrandOrange,
          brightness: Brightness.dark,
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: const Color(0xFF1E293B),
          indicatorColor: kBrandOrange.withValues(alpha: 0.25),
        ),
      ),
      themeMode: _themeMode,
      home: const TrackingHome(),
    );
  }
}

class TrackingHome extends StatefulWidget {
  const TrackingHome({super.key});

  @override
  State<TrackingHome> createState() => _TrackingHomeState();
}

class _TrackingHomeState extends State<TrackingHome> {
  static const String kDefaultServerUrl = 'https://waymark-seven.vercel.app';

  static String _resolveApiUrl() {
    const envUrl = String.fromEnvironment('WAYMARK_API_URL');
    if (envUrl.isNotEmpty) return envUrl;
    return kDefaultServerUrl;
  }

  final String _serverUrl = _resolveApiUrl();
  late final TrackingApi api = TrackingApi(_serverUrl);

  StreamSubscription<Position>? _positionSubscription;
  Timer? _pollingTimer;
  Timer? _interactionTimer;

  // Audio player for incoming voice note cheers
  final AudioPlayer _audioPlayer = AudioPlayer();
  String? _playingCheerId;

  // Custom session title (Runner can change to whatever they want)
  late final TextEditingController _titleController =
      TextEditingController(text: 'Latihan Lari');

  bool _isLive = false;
  bool _gpsReady = false;
  bool _isLocating = false;
  int _batteryLevel = 100;
  String? _sessionToken;
  String? _lastUpdateTime;
  String? _lastCoords;
  List<ViewerInfo> _viewers = [];

  int get _activeViewerCount => _viewers.where((v) => v.isOnline).length;

  // Selected GPX course/route
  GpxRoute? _selectedRoute;
  RouteProgress? _routeProgress;

  // Performance & Safety state
  bool _isSos = false;
  List<CheerInfo> _cheers = [];
  final Set<String> _seenCheerIds = {};
  double _currentSpeedKmh = 0.0;
  double? _currentAltitudeM;
  String _currentPace = "—";

  // Offline Store & Forward Queue
  final List<Map<String, dynamic>> _offlineQueue = [];
  bool _isFlushingQueue = false;

  // Smart Battery Mode: 4 (Live Normal) vs 30 (Ultra Eco)
  int _trackingIntervalSeconds = 4;
  Position? _lastSentPosition;
  DateTime? _lastSentTime;
  int _selectedTabIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadInitialState();
  }

  @override
  void dispose() {
    _positionSubscription?.cancel();
    _pollingTimer?.cancel();
    _interactionTimer?.cancel();
    _audioPlayer.dispose();
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialState() async {
    try {
      await NotificationService.instance.initialize();
    } catch (_) {}

    try {
      final battery = await Battery().batteryLevel;
      if (mounted) setState(() => _batteryLevel = battery);
    } catch (_) {
      // In web browser or desktop without battery API, keep default 100%
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final savedQueueJson = prefs.getString('offline_queue');
      if (savedQueueJson != null) {
        final List<dynamic> decoded = jsonDecode(savedQueueJson);
        setState(() {
          _offlineQueue.addAll(
            decoded.map((item) => Map<String, dynamic>.from(item as Map)),
          );
        });
      }

      final savedCheersStr = prefs.getString('saved_cheers');
      if (savedCheersStr != null) {
        final List<dynamic> decoded = jsonDecode(savedCheersStr);
        final loaded = decoded
            .map((c) => CheerInfo.fromJson(Map<String, dynamic>.from(c as Map)))
            .toList();
        setState(() {
          _cheers = loaded;
          for (final c in loaded) {
            _seenCheerIds.add(c.id);
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _persistCheers() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonList = _cheers.map((c) => c.toJson()).toList();
      await prefs.setString('saved_cheers', jsonEncode(jsonList));
    } catch (_) {}
  }

  Future<void> _persistOfflineQueue() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('offline_queue', jsonEncode(_offlineQueue));
    } catch (_) {}
  }

  Future<void> _pickGpxFile() async {
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['gpx', 'xml'],
      );

      if (files.isEmpty) return;

      final file = files.first;
      final content = await file.xFile.readAsString();

      final parsed = GpxRoute.parse(
        content,
        fallbackName: file.name.replaceAll(
          RegExp(r'\.gpx$|\.xml$', caseSensitive: false),
          '',
        ),
      );

      setState(() {
        _selectedRoute = parsed;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Loaded route: ${parsed.name} (${parsed.totalDistanceKm} km)',
            ),
            backgroundColor: const Color(0xFF168654),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to load GPX: $e'),
            backgroundColor: const Color(0xFFDC4545),
          ),
        );
      }
    }
  }

  void _loadSampleGpx() {
    try {
      final parsed = GpxRoute.parse(kSampleRinjaniGpx);
      setState(() {
        _selectedRoute = parsed;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Loaded sample route: ${parsed.name} (${parsed.totalDistanceKm} km)',
            ),
            backgroundColor: const Color(0xFF168654),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading sample GPX: $e')));
      }
    }
  }

  void _clearRoute() {
    setState(() {
      _selectedRoute = null;
    });
  }

  Future<bool> _ensureLocationPermission() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled && !kIsWeb) {
        return false;
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      return permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
    } catch (_) {
      // In web browser, allow requestPermission to trigger browser prompt
      return true;
    }
  }

  void _applySyncResponse(LocationSyncResponse res) {
    if (!mounted) return;
    setState(() {
      _viewers = res.viewers;
    });

    final Set<String> existingIds = _cheers.map((c) => c.id).toSet();
    bool hasNew = false;

    for (final c in res.cheers) {
      if (!existingIds.contains(c.id)) {
        _cheers.insert(0, c);
        existingIds.add(c.id);
        hasNew = true;

        if (!_seenCheerIds.contains(c.id)) {
          _seenCheerIds.add(c.id);

          // 1. Trigger audio chime, vibration pattern, and Android system notification
          NotificationService.instance.notifyCheer(
            senderName: c.senderName,
            message: c.message,
            emoji: c.emoji,
            isVoiceNote: c.isVoiceNote,
            durationSeconds: c.durationSeconds,
          );

          // 2. In-app floating toast
          final text = c.isVoiceNote
              ? '🎙️ Pesan suara dari ${c.senderName} (${c.durationSeconds ?? 5}d)!'
              : (c.message != null && c.message!.isNotEmpty
                  ? '${c.emoji} "${c.message}" — dari ${c.senderName}'
                  : '${c.emoji} Sorakan semangat dari ${c.senderName}!');
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(text),
              backgroundColor: const Color(0xFF168654),
              duration: const Duration(seconds: 4),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      }
    }

    if (hasNew) {
      _persistCheers();
    }
    if (mounted) setState(() {});
  }

  void _startInteractionTimer() {
    _interactionTimer?.cancel();
    _interactionTimer = Timer.periodic(const Duration(seconds: 2), (_) async {
      if (!_isLive || _sessionToken == null) return;
      try {
        final res = await api.syncInteraction(_sessionToken!);
        if (res != null) {
          _applySyncResponse(res);
        }
      } catch (_) {}
    });
  }

  Future<void> _playVoiceNote(CheerInfo cheer) async {
    if (cheer.audioData == null || cheer.audioData!.isEmpty) return;
    if (_playingCheerId == cheer.id) {
      await _audioPlayer.stop();
      if (mounted) setState(() => _playingCheerId = null);
      return;
    }

    try {
      await _audioPlayer.stop();
      if (mounted) setState(() => _playingCheerId = cheer.id);

      String raw = cheer.audioData!;
      if (raw.contains(',')) {
        raw = raw.split(',').last;
      }
      final bytes = base64Decode(raw);

      _audioPlayer.onPlayerComplete.listen((_) {
        if (mounted) setState(() => _playingCheerId = null);
      });

      await _audioPlayer.play(BytesSource(bytes));
    } catch (e) {
      debugPrint('Error playing voice note: $e');
      if (mounted) setState(() => _playingCheerId = null);
    }
  }

  Future<void> _updateLiveTitle(String newTitle) async {
    if (!_isLive || _sessionToken == null) return;
    final success = await api.updateTitle(_sessionToken!, newTitle);
    if (mounted && success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Judul tracking live berhasil diperbarui!'),
          backgroundColor: Color(0xFF168654),
        ),
      );
    }
  }

  Future<void> _handleNewPosition(Position position) async {
    int battery = _batteryLevel;
    try {
      battery = await Battery().batteryLevel;
    } catch (_) {}

    final speedKmh = position.speed * 3.6;
    String paceStr = "—";
    if (speedKmh > 0.5) {
      final paceMinTotal = 60 / speedKmh;
      final paceMin = paceMinTotal.floor();
      final paceSec = ((paceMinTotal - paceMin) * 60).round();
      paceStr = "$paceMin'${paceSec.toString().padLeft(2, '0')}\"";
    } else {
      paceStr = "Diam";
    }

    RouteProgress? progress;
    if (_selectedRoute != null) {
      progress = _selectedRoute!.calculateProgress(
        position.latitude,
        position.longitude,
      );
    }

    if (mounted) {
      setState(() {
        _gpsReady = true;
        _isLocating = false;
        _batteryLevel = battery;
        _lastUpdateTime = TimeOfDay.now().format(context);
        _lastCoords =
            '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
        _currentSpeedKmh = speedKmh;
        _currentAltitudeM = position.altitude;
        _currentPace = paceStr;
        _routeProgress = progress;
      });
    }

    if (_sessionToken == null) return;

    // Smart Battery Throttle:
    // When stationary (<3m displacement) and not in SOS mode, avoid continuous cellular radio wakeups.
    // Instead, rely on periodic heartbeat (30s normal / 60s ultra eco).
    final now = DateTime.now();
    if (_lastSentPosition != null && _lastSentTime != null && !_isSos) {
      final distMeters = Geolocator.distanceBetween(
        _lastSentPosition!.latitude,
        _lastSentPosition!.longitude,
        position.latitude,
        position.longitude,
      );
      final elapsedSec = now.difference(_lastSentTime!).inSeconds;
      final heartbeatInterval = _trackingIntervalSeconds > 10 ? 60 : 30;
      if (distMeters < 3.0 && elapsedSec < heartbeatInterval) {
        return;
      }
    }

    _lastSentPosition = position;
    _lastSentTime = now;

    final locData = <String, dynamic>{
      'latitude': position.latitude,
      'longitude': position.longitude,
      'accuracy': position.accuracy,
      'battery': battery,
      'altitude': position.altitude,
      'speed': position.speed,
      'heading': position.heading,
      'isSos': _isSos,
      'recordedAt': now.toUtc().toIso8601String(),
    };

    if (_offlineQueue.isNotEmpty && !_isFlushingQueue) {
      _isFlushingQueue = true;
      try {
        final toSend = [..._offlineQueue, locData];
        final syncResult = await api.sendLocationBatch(
          token: _sessionToken!,
          locations: toSend,
        );
        _offlineQueue.clear();
        await _persistOfflineQueue();
        if (syncResult != null) {
          _applySyncResponse(syncResult);
        }
        if (mounted && toSend.length > 1) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Sinyal pulih: ${syncResult?.syncedCount ?? toSend.length} titik offline berhasil disinkronkan!',
              ),
              backgroundColor: const Color(0xFF168654),
              duration: const Duration(seconds: 3),
            ),
          );
        }
      } catch (_) {
        _offlineQueue.add(locData);
        if (_offlineQueue.length > 500) _offlineQueue.removeAt(0);
        await _persistOfflineQueue();
      } finally {
        _isFlushingQueue = false;
      }
    } else {
      try {
        final syncResult = await api.sendLocation(
          token: _sessionToken!,
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          battery: battery,
          altitude: position.altitude,
          speed: position.speed,
          heading: position.heading,
          isSos: _isSos,
        );
        if (syncResult != null) {
          _applySyncResponse(syncResult);
        }
      } catch (_) {
        _offlineQueue.add(locData);
        if (_offlineQueue.length > 500) _offlineQueue.removeAt(0);
        await _persistOfflineQueue();
      }
    }
  }

  Future<void> _toggleSos() async {
    if (!_isSos) {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: const Icon(
            Icons.warning_amber_rounded,
            color: Color(0xFFDC4545),
            size: 48,
          ),
          title: const Text('Aktifkan Sinyal SOS Darurat?'),
          content: const Text(
            'Peringatan alarm darurat merah akan segera dikirimkan ke semua orang yang memantau live tracking Anda, beserta koordinat GPS akurat Anda di peta.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Batal'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFDC4545),
              ),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('KIRIM SOS DARURAT'),
            ),
          ],
        ),
      );

      if (confirm == true) {
        setState(() => _isSos = true);
        if (_sessionToken != null) {
          try {
            final pos = await Geolocator.getCurrentPosition(
              locationSettings: const LocationSettings(
                accuracy: LocationAccuracy.high,
              ),
            );
            await _handleNewPosition(pos);
          } catch (_) {}
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                '🚨 Sinyal SOS darurat telah aktif dan disiarkan ke penonton!',
              ),
              backgroundColor: Color(0xFFDC4545),
              duration: Duration(seconds: 5),
            ),
          );
        }
      }
    } else {
      setState(() => _isSos = false);
      if (_sessionToken != null) {
        try {
          final pos = await Geolocator.getCurrentPosition();
          await _handleNewPosition(pos);
        } catch (_) {}
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sinyal SOS darurat dimatikan.'),
            backgroundColor: Color(0xFF168654),
          ),
        );
      }
    }
  }

  void _setTrackingInterval(int seconds) {
    if (_trackingIntervalSeconds == seconds) return;
    setState(() => _trackingIntervalSeconds = seconds);
    if (_isLive && _sessionToken != null) {
      _startTimersAndStream();
      if (mounted) {
        final modeName = seconds > 10 ? 'Ultra Eco (30s)' : 'Live Normal (4s)';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Mode tracking diubah ke: $modeName'),
            backgroundColor: const Color(0xFF168654),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  void _startTimersAndStream() {
    _positionSubscription?.cancel();
    _pollingTimer?.cancel();

    LocationSettings settings;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      settings = AndroidSettings(
        accuracy: _trackingIntervalSeconds > 10
            ? LocationAccuracy.medium
            : LocationAccuracy.high,
        distanceFilter: _trackingIntervalSeconds > 10 ? 15 : 5,
        intervalDuration: Duration(seconds: _trackingIntervalSeconds),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Waymark Live Tracking Aktif',
          notificationText: 'Pelacakan lari sedang aktif di latar belakang',
          notificationChannelName: 'Waymark Live Tracking',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    } else {
      settings = LocationSettings(
        accuracy: _trackingIntervalSeconds > 10
            ? LocationAccuracy.medium
            : LocationAccuracy.high,
        distanceFilter: _trackingIntervalSeconds > 10 ? 15 : 5,
      );
    }

    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: settings,
    ).listen((Position p) => _handleNewPosition(p));

    // Fallback heartbeat for stationary periods (e.g. resting at aid station or paused)
    // Runs every 30s (normal) or 60s (ultra eco) only if no location fix was sent in that window.
    _pollingTimer = Timer.periodic(
      Duration(seconds: _trackingIntervalSeconds > 10 ? 60 : 30),
      (_) async {
        if (!_isLive || _sessionToken == null) return;
        final now = DateTime.now();
        final thresholdSec = _trackingIntervalSeconds > 10 ? 60 : 30;
        if (_lastSentTime == null ||
            now.difference(_lastSentTime!).inSeconds >= thresholdSec) {
          if (_lastSentPosition != null) {
            await _handleNewPosition(_lastSentPosition!);
          }
        }
      },
    );
  }

  Future<void> _startTracking() async {
    setState(() => _isLocating = true);

    final hasPermission = await _ensureLocationPermission();
    if (!hasPermission) {
      setState(() => _isLocating = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Enable GPS and allow location access first.'),
          ),
        );
      }
      return;
    }

    try {
      final routePayload = _selectedRoute != null
          ? {
              'routeGeojson': _selectedRoute!.toGeoJson(),
              'totalDistance': _selectedRoute!.totalDistanceKm,
              'elevationGain': _selectedRoute!.elevationGainMeters,
            }
          : null;

      final customTitle = _titleController.text.trim();
      _sessionToken = await api.start(
        runnerName: 'Waymark Runner',
        eventName: customTitle.isNotEmpty
            ? customTitle
            : (_selectedRoute?.name ?? 'Outdoor session'),
        route: routePayload,
      );

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('session_token', _sessionToken!);

      setState(() {
        _isLive = true;
      });

      // 1. Immediately request the initial real GPS position fix (and sync viewers/cheers)
      try {
        final initialPos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 10),
          ),
        );
        await _handleNewPosition(initialPos);
      } catch (err) {
        debugPrint('Initial GPS fetch error: $err');
      }

      // 2. Start position change stream with foreground service & wakelock
      _startTimersAndStream();

      // 3. Start high-frequency 2-second interaction timer for instant cheers and spectator count
      _startInteractionTimer();
    } catch (e) {
      setState(() => _isLocating = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not connect to tracking server: $e')),
        );
      }
    }
  }

  Future<void> _stopTracking() async {
    await _positionSubscription?.cancel();
    _positionSubscription = null;
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _interactionTimer?.cancel();
    _interactionTimer = null;
    await _audioPlayer.stop();
    _lastSentPosition = null;
    _lastSentTime = null;

    if (_sessionToken != null) {
      try {
        await api.stop(_sessionToken!);
      } catch (_) {}
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('session_token');

    if (mounted) {
      setState(() {
        _isLive = false;
        _sessionToken = null;
        _isLocating = false;
        _isSos = false;
        _viewers = [];
        _playingCheerId = null;
        _routeProgress = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedTabIndex,
        onDestinationSelected: (index) => setState(() => _selectedTabIndex = index),
        indicatorColor: kBrandOrange.withValues(alpha: 0.15),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.speed_rounded),
            selectedIcon: Icon(Icons.speed_rounded, color: kBrandOrange),
            label: 'Pelacakan',
          ),
          NavigationDestination(
            icon: Badge(
              label: Text('${_cheers.length}'),
              isLabelVisible: _cheers.isNotEmpty,
              child: const Icon(Icons.favorite_outline_rounded),
            ),
            selectedIcon: Badge(
              label: Text('${_cheers.length}'),
              isLabelVisible: _cheers.isNotEmpty,
              child: const Icon(Icons.favorite_rounded, color: Color(0xFFDC2626)),
            ),
            label: 'Sorakan',
          ),
          const NavigationDestination(
            icon: Icon(Icons.tune_rounded),
            selectedIcon: Icon(Icons.tune_rounded, color: kBrandOrange),
            label: 'Rute & Mode',
          ),
        ],
      ),
      body: IndexedStack(
        index: _selectedTabIndex,
        children: [
          _buildLiveDashboardView(),
          _buildCheersView(),
          _buildRouteAndSettingsView(),
        ],
      ),
    );
  }

  void _shareTrackingLink() {
    if (_sessionToken == null) return;
    final url = '${api.baseUrl}/live/$_sessionToken';
    Clipboard.setData(ClipboardData(text: url));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Link live tracking berhasil disalin ke clipboard!'),
        backgroundColor: Color(0xFF168654),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Widget _buildShareLinkCard() {
    if (!_isLive || _sessionToken == null) return const SizedBox.shrink();
    final isDark = WaymarkApp.of(context).isDark;
    return Card(
      elevation: 0,
      color: isDark
          ? const Color(0xFF064E3B).withValues(alpha: 0.4)
          : const Color(0xFFF0FDF4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? const Color(0xFF047857) : const Color(0xFFBBF7D0),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.share, color: Color(0xFF10B981), size: 18),
                const SizedBox(width: 8),
                Text(
                  'Link Live Tracking untuk Pemantau',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: isDark
                        ? const Color(0xFF34D399)
                        : const Color(0xFF15803D),
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SelectableText(
              '${api.baseUrl}/live/$_sessionToken',
              style: TextStyle(
                fontSize: 13,
                color: isDark ? Colors.white : kInkDark,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF16A34A),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              onPressed: _shareTrackingLink,
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Salin Link Live'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTitleEditorCard() {
    final isDark = WaymarkApp.of(context).isDark;
    return Card(
      elevation: 0,
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFE5E7EB),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: isDark
                        ? const Color(0xFF1E3A8A)
                        : const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.edit_note_rounded,
                    color: Color(0xFF3B82F6),
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Judul Sesi Tracking',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: isDark ? Colors.white : kInkDark,
                        ),
                      ),
                      Text(
                        'Kustomisasi judul tracking (tidak harus nama file GPX)',
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark ? Colors.white70 : Colors.black54,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _titleController,
              style: TextStyle(color: isDark ? Colors.white : Colors.black87),
              decoration: InputDecoration(
                hintText: 'Contoh: Long Run Pagi / Bromo Ultra 2026',
                hintStyle: TextStyle(
                  color: isDark ? Colors.white38 : Colors.black38,
                  fontSize: 13,
                ),
                filled: true,
                fillColor: isDark
                    ? const Color(0xFF0F172A)
                    : const Color(0xFFF9FAFB),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(
                    color: isDark
                        ? const Color(0xFF334155)
                        : const Color(0xFFE5E7EB),
                  ),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(
                    color: isDark
                        ? const Color(0xFF334155)
                        : const Color(0xFFE5E7EB),
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: kBrandOrange),
                ),
                suffixIcon: _isLive && _sessionToken != null
                    ? TextButton(
                        onPressed: () =>
                            _updateLiveTitle(_titleController.text.trim()),
                        child: const Text(
                          'Update',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 11,
                            color: kBrandOrange,
                          ),
                        ),
                      )
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildThemeSelectorCard() {
    final isDark = WaymarkApp.of(context).isDark;
    return Card(
      elevation: 0,
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFE5E7EB),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isDark
                    ? const Color(0xFF334155)
                    : const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                color: isDark ? Colors.amber : const Color(0xFFD97706),
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isDark ? 'Mode Gelap (Aktif)' : 'Mode Terang (Aktif)',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: isDark ? Colors.white : kInkDark,
                    ),
                  ),
                  Text(
                    isDark
                        ? 'Tema gelap nyaman di mata & hemat baterai'
                        : 'Tema terang optimal untuk luar ruangan',
                    style: TextStyle(
                      fontSize: 11,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                  ),
                ],
              ),
            ),
            Switch(
              value: isDark,
              activeThumbColor: kBrandOrange,
              onChanged: (_) => WaymarkApp.of(context).toggleTheme(),
            ),
          ],
        ),
      ),
    );
  }

  /// Tab 0: 100% Fit in screen / ZERO-SCROLL HUD
  Widget _buildLiveDashboardView() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Column(
          children: [
            // 1. Top Header: Brand + Live Pill + Battery Mode + Battery %
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Text(
                      'waymark',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        letterSpacing: -1,
                        fontSize: 22,
                        color: WaymarkApp.of(context).isDark
                            ? Colors.white
                            : kInkDark,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: _isLive
                            ? (WaymarkApp.of(context).isDark
                                ? const Color(0xFF064E3B)
                                : const Color(0xFFE8F5E9))
                            : (WaymarkApp.of(context).isDark
                                ? const Color(0xFF1E293B)
                                : const Color(0xFFEEEEEE)),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: _isLive
                                  ? const Color(0xFF10B981)
                                  : (WaymarkApp.of(context).isDark
                                      ? Colors.white38
                                      : const Color(0xFF757575)),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _isLive ? 'LIVE' : 'STANDBY',
                            style: TextStyle(
                              color: _isLive
                                  ? (WaymarkApp.of(context).isDark
                                      ? const Color(0xFF34D399)
                                      : const Color(0xFF2E7D32))
                                  : (WaymarkApp.of(context).isDark
                                      ? Colors.white60
                                      : const Color(0xFF616161)),
                              fontWeight: FontWeight.bold,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                Row(
                  children: [
                    // Battery Mode Pill
                    InkWell(
                      onTap: () {
                        _setTrackingInterval(_trackingIntervalSeconds == 4 ? 30 : 4);
                      },
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: _trackingIntervalSeconds > 10
                              ? (WaymarkApp.of(context).isDark
                                  ? const Color(0xFF064E3B)
                                  : const Color(0xFFECFDF5))
                              : (WaymarkApp.of(context).isDark
                                  ? const Color(0xFF1E3A8A)
                                  : const Color(0xFFEFF6FF)),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: _trackingIntervalSeconds > 10
                                ? (WaymarkApp.of(context).isDark
                                    ? const Color(0xFF047857)
                                    : const Color(0xFFA7F3D0))
                                : (WaymarkApp.of(context).isDark
                                    ? const Color(0xFF1D4ED8)
                                    : const Color(0xFFBFDBFE)),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              _trackingIntervalSeconds > 10
                                  ? Icons.energy_savings_leaf
                                  : Icons.flash_on,
                              size: 12,
                              color: _trackingIntervalSeconds > 10
                                  ? const Color(0xFF10B981)
                                  : const Color(0xFF3B82F6),
                            ),
                            const SizedBox(width: 3),
                            Text(
                              _trackingIntervalSeconds > 10
                                  ? 'Eco 30s'
                                  : 'Live 4s',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: _trackingIntervalSeconds > 10
                                    ? (WaymarkApp.of(context).isDark
                                        ? const Color(0xFF34D399)
                                        : const Color(0xFF059669))
                                    : (WaymarkApp.of(context).isDark
                                        ? const Color(0xFF60A5FA)
                                        : const Color(0xFF2563EB)),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),

                    // Battery Level Pill
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: _batteryLevel <= 20
                            ? (WaymarkApp.of(context).isDark
                                ? const Color(0xFF7F1D1D)
                                : const Color(0xFFFEE2E2))
                            : (WaymarkApp.of(context).isDark
                                ? const Color(0xFF1E293B)
                                : const Color(0xFFF1F5F9)),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _batteryLevel <= 20
                                ? Icons.battery_alert
                                : Icons.battery_std,
                            size: 13,
                            color: _batteryLevel <= 20
                                ? Colors.red
                                : (WaymarkApp.of(context).isDark
                                    ? Colors.white70
                                    : Colors.black54),
                          ),
                          const SizedBox(width: 3),
                          Text(
                            '$_batteryLevel%',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: _batteryLevel <= 20
                                  ? Colors.red
                                  : (WaymarkApp.of(context).isDark
                                      ? Colors.white
                                      : Colors.black87),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 10),

            // 2. Alert Banner (SOS or Off-Course if active)
            if (_isLive && _isSos)
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFDC2626),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.emergency, color: Colors.white, size: 20),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'SOS DARURAT AKTIF: Sinyal dikirim ke pemantau',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.red,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        minimumSize: Size.zero,
                      ),
                      onPressed: _toggleSos,
                      child: const Text(
                        'Matikan',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              )
            else if (_isLive &&
                _routeProgress != null &&
                _routeProgress!.isOffCourse)
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: WaymarkApp.of(context).isDark
                      ? const Color(0xFF451A03)
                      : const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: WaymarkApp.of(context).isDark
                        ? const Color(0xFF78350F)
                        : const Color(0xFFFDE68A),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      color: Color(0xFFD97706),
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _routeProgress!.distanceFromRouteMeters > 1000
                            ? 'Belum di jalur rute (~${(_routeProgress!.distanceFromRouteMeters / 1000).toStringAsFixed(1)} km ke rute)'
                            : 'Melenceng ~${_routeProgress!.distanceFromRouteMeters.round()}m dari rute GPX',
                        style: TextStyle(
                          color: WaymarkApp.of(context).isDark
                              ? const Color(0xFFFCD34D)
                              : const Color(0xFF92400E),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // 3. Central HUD Running Metrics (Expanded to fill space nicely without scrolling!)
            Expanded(
              child: Column(
                children: [
                  // Row 1: PACE (Huge digits) & SPEED
                  Expanded(
                    flex: 4,
                    child: Row(
                      children: [
                        Expanded(
                          child: _buildMetricTile(
                            label: 'PACE',
                            value: _currentPace,
                            unit: '/km',
                            icon: Icons.timer_outlined,
                            isHero: true,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _buildMetricTile(
                            label: 'KECEPATAN',
                            value: _currentSpeedKmh.toStringAsFixed(1),
                            unit: 'km/jam',
                            icon: Icons.speed,
                            isHero: true,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 10),

                  // Row 2: SISA JARAK & ELEVASI
                  Expanded(
                    flex: 3,
                    child: Row(
                      children: [
                        Expanded(
                          child: _buildMetricTile(
                            label: _selectedRoute != null
                                ? 'SISA JARAK'
                                : 'TOTAL RUTE',
                            value: _selectedRoute != null
                                ? '${_routeProgress?.remainingDistanceKm ?? _selectedRoute!.totalDistanceKm}'
                                : '—',
                            unit: 'km',
                            icon: Icons.straighten,
                            subtext: _selectedRoute != null
                                ? 'Rute: ${_selectedRoute!.totalDistanceKm} km'
                                : null,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _buildMetricTile(
                            label: 'KETINGGIAN',
                            value: _currentAltitudeM != null
                                ? '${_currentAltitudeM!.round()}'
                                : '—',
                            unit: 'mdpl',
                            icon: Icons.terrain,
                            subtext: _selectedRoute != null
                                ? 'D+: +${_selectedRoute!.elevationGainMeters}m'
                                : null,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 10),

                  // Row 3: ROUTE COURSE & SPECTATOR SUMMARY TILE
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: WaymarkApp.of(context).isDark
                          ? const Color(0xFF1E293B)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: WaymarkApp.of(context).isDark
                            ? const Color(0xFF334155)
                            : const Color(0xFFE5E7EB),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: WaymarkApp.of(context).isDark
                              ? Colors.black26
                              : const Color(0x06000000),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _selectedRoute != null
                              ? Icons.route
                              : Icons.alt_route,
                          color: _selectedRoute != null
                              ? kBrandOrange
                              : (WaymarkApp.of(context).isDark
                                  ? Colors.white38
                                  : Colors.black38),
                          size: 20,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                _selectedRoute?.name ??
                                    'Belum ada rute GPX dimuat',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                  color: WaymarkApp.of(context).isDark
                                      ? Colors.white
                                      : kInkDark,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                _selectedRoute != null
                                    ? (_routeProgress?.isOffCourse == true
                                        ? 'Status: Di luar lintasan rute'
                                        : 'Status: Mengikuti jalur lintasan')
                                    : (_lastCoords != null
                                        ? 'GPS: $_lastCoords (${_lastUpdateTime ?? ""})'
                                        : (_gpsReady
                                            ? 'GPS Siap · Menunggu pergerakan'
                                            : 'Buka tab "Rute" untuk memuat jalur gunung')),
                                style: TextStyle(
                                  fontSize: 10,
                                  color: _routeProgress?.isOffCourse == true
                                      ? (WaymarkApp.of(context).isDark
                                          ? const Color(0xFFFCD34D)
                                          : const Color(0xFFB45309))
                                      : (WaymarkApp.of(context).isDark
                                          ? Colors.white60
                                          : Colors.black54),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_isLive)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: WaymarkApp.of(context).isDark
                                  ? const Color(0xFF064E3B)
                                  : const Color(0xFFF0FDF4),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(
                                  Icons.people,
                                  size: 12,
                                  color: Color(0xFF16A34A),
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  '$_activeViewerCount',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF16A34A),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 12),

            // 4. Fixed Thumb-Friendly Bottom Action Buttons (Never scrolled off-screen!)
            if (!_isLive)
              SizedBox(
                width: double.infinity,
                height: 54,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: kBrandOrange,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    elevation: 2,
                  ),
                  onPressed: _isLocating ? null : _startTracking,
                  icon: _isLocating
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.play_arrow_rounded, size: 28),
                  label: Text(
                    _isLocating ? 'MENGHUBUNGKAN...' : 'MULAI LIVE TRACKING',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              )
            else
              Row(
                children: [
                  // STOP BUTTON
                  Expanded(
                    flex: 5,
                    child: SizedBox(
                      height: 52,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: WaymarkApp.of(context).isDark
                              ? const Color(0xFF334155)
                              : const Color(0xFF171717),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        onPressed: _stopTracking,
                        icon: const Icon(Icons.stop_rounded, size: 22),
                        label: const Text(
                          'HENTIKAN',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // SOS BUTTON
                  SizedBox(
                    height: 52,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: _isSos
                            ? Colors.black
                            : const Color(0xFFDC2626),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      onPressed: _toggleSos,
                      child: Row(
                        children: [
                          Icon(_isSos ? Icons.warning : Icons.emergency,
                              size: 18),
                          const SizedBox(width: 4),
                          Text(
                            _isSos ? 'SOS ON' : 'SOS',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // SHARE BUTTON
                  SizedBox(
                    height: 52,
                    width: 52,
                    child: IconButton.filledTonal(
                      style: IconButton.styleFrom(
                        backgroundColor: WaymarkApp.of(context).isDark
                            ? const Color(0xFF1E293B)
                            : const Color(0xFFF1F5F9),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      onPressed: _shareTrackingLink,
                      icon: Icon(
                        Icons.share,
                        size: 20,
                        color: WaymarkApp.of(context).isDark
                            ? Colors.white
                            : const Color(0xFF0F172A),
                      ),
                      tooltip: 'Bagikan Link',
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricTile({
    required String label,
    required String value,
    String? unit,
    required IconData icon,
    String? subtext,
    bool isHero = false,
  }) {
    final isDark = WaymarkApp.of(context).isDark;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isHero ? 16 : 14,
        vertical: isHero ? 12 : 10,
      ),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFE5E7EB),
        ),
        boxShadow: [
          BoxShadow(
            color: isDark ? Colors.black26 : const Color(0x06000000),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: isHero ? 16 : 14, color: kBrandOrange),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: isHero ? 11 : 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  color: isDark
                      ? const Color(0xFF94A3B8)
                      : const Color(0xFF64748B),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: isHero ? 32 : 24,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -1,
                  color: isDark ? Colors.white : kInkDark,
                  height: 1.1,
                ),
              ),
              if (unit != null) ...[
                const SizedBox(width: 4),
                Text(
                  unit,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isDark
                        ? const Color(0xFF94A3B8)
                        : const Color(0xFF64748B),
                  ),
                ),
              ],
            ],
          ),
          if (subtext != null) ...[
            const SizedBox(height: 2),
            Text(
              subtext,
              style: TextStyle(
                fontSize: 10,
                color: isDark
                    ? const Color(0xFF64748B)
                    : const Color(0xFF94A3B8),
                fontWeight: FontWeight.w500,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  /// Tab 1: Sorakan & Penonton Full-page view
  Widget _buildCheersView() {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text(
          'Sorakan & Penonton',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        children: [
          if (_isLive && _sessionToken != null) ...[
            _buildShareLinkCard(),
            const SizedBox(height: 14),
          ],
          _buildViewersCard(),
          const SizedBox(height: 14),
          _buildCheersCard(),
        ],
      ),
    );
  }

  /// Tab 2: Rute GPX & Mode Daya Full-page view
  Widget _buildRouteAndSettingsView() {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text(
          'Rute & Pengaturan',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        children: [
          _buildTitleEditorCard(),
          const SizedBox(height: 16),
          _buildGpxRouteCard(),
          const SizedBox(height: 16),
          _buildBatteryModeSelector(),
          const SizedBox(height: 16),
          _buildThemeSelectorCard(),
        ],
      ),
    );
  }

  Widget _buildGpxRouteCard() {
    final isDark = WaymarkApp.of(context).isDark;
    if (_selectedRoute != null) {
      return Card(
        elevation: 0,
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isDark ? const Color(0xFF334155) : const Color(0xFFD6E7DC),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isDark
                          ? const Color(0xFF7C2D12)
                          : const Color(0xFFFFF7ED),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.route,
                      color: Color(0xFFFF6B00),
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _selectedRoute!.name,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                            color: isDark ? Colors.white : kInkDark,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        const Text(
                          'Rute Oranye Ditampilkan di Peta',
                          style: TextStyle(
                            color: Color(0xFFFF6B00),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!_isLive)
                    IconButton(
                      icon: Icon(
                        Icons.close_rounded,
                        size: 20,
                        color: isDark ? Colors.white60 : Colors.black45,
                      ),
                      tooltip: 'Remove route',
                      onPressed: _clearRoute,
                    ),
                ],
              ),
              Divider(
                height: 24,
                color: isDark
                    ? const Color(0xFF334155)
                    : const Color(0xFFF0F0F0),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _routeDetail(
                    'Distance',
                    '${_selectedRoute!.totalDistanceKm} km',
                    isDark,
                  ),
                  _routeDetail(
                    'Elevation Gain',
                    '+${_selectedRoute!.elevationGainMeters} m',
                    isDark,
                  ),
                  _routeDetail(
                    'Waypoints',
                    '${_selectedRoute!.points.length} pts',
                    isDark,
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFEAEAEA),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.map_outlined, color: kBrandOrange, size: 20),
              const SizedBox(width: 8),
              Text(
                'Trail Route (GPX)',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                  color: isDark ? Colors.white : kInkDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Load a GPX route to share the course path (orange line) with spectators.',
            style: TextStyle(
              fontSize: 13,
              color: isDark ? Colors.white70 : Colors.black54,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: _isLive ? null : _pickGpxFile,
                  icon: const Icon(Icons.file_open_outlined, size: 18),
                  label: const Text('Pick GPX File'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonalIcon(
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: _isLive ? null : _loadSampleGpx,
                  icon: const Icon(Icons.hiking, size: 18),
                  label: const Text('Sample GPX'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _routeDetail(String label, String value, bool isDark) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: isDark ? Colors.white60 : Colors.black54,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: isDark ? Colors.white : kInkDark,
          ),
        ),
      ],
    );
  }

  Widget _buildCheersCard() {
    final isDark = WaymarkApp.of(context).isDark;

    if (!_isLive && _cheers.isEmpty) {
      return Card(
        elevation: 0,
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isDark ? const Color(0xFF334155) : const Color(0xFFEAEAEA),
          ),
        ),
        child: const Padding(
          padding: EdgeInsets.all(20),
          child: Column(
            children: [
              Icon(Icons.favorite_border_rounded, size: 36, color: Colors.black26),
              SizedBox(height: 10),
              Text(
                'Belum Ada Sorakan',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
              ),
              SizedBox(height: 4),
              Text(
                'Mulai live tracking di tab Pelacakan untuk membagikan tautan dan menerima sorakan serta pesan suara langsung dari penonton!',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      elevation: 0,
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFEAEAEA),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: _cheers.isNotEmpty
                            ? (isDark
                                ? const Color(0xFF881337)
                                : const Color(0xFFFFF1F2))
                            : (isDark
                                ? const Color(0xFF334155)
                                : const Color(0xFFF5F5F5)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(
                        Icons.favorite_rounded,
                        color: _cheers.isNotEmpty
                            ? const Color(0xFFE11D48)
                            : Colors.black54,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Sorakan Penonton',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: isDark ? Colors.white : kInkDark,
                      ),
                    ),
                  ],
                ),
                if (_cheers.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: isDark
                          ? const Color(0xFF881337)
                          : const Color(0xFFFFF1F2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${_cheers.length} Pesan',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFE11D48),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            if (_cheers.isEmpty) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark
                      ? const Color(0xFF0F172A)
                      : const Color(0xFFF9F9F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.chat_bubble_outline,
                      size: 18,
                      color: Colors.black45,
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Belum ada sorakan. Penonton di web bisa mengirim emoji, pesan semangat, & pesan suara.',
                        style: TextStyle(fontSize: 12, color: Colors.black54),
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _cheers.length,
                separatorBuilder: (context, index) => Divider(
                  height: 16,
                  color: isDark
                      ? const Color(0xFF334155)
                      : const Color(0xFFF0F0F0),
                ),
                itemBuilder: (context, index) {
                  final cheer = _cheers[index];
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(cheer.emoji, style: const TextStyle(fontSize: 22)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  cheer.senderName,
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: isDark ? Colors.white : kInkDark,
                                  ),
                                ),
                                if (cheer.createdAt.isNotEmpty)
                                  Text(
                                    _formatCheerTime(cheer.createdAt),
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: isDark
                                          ? Colors.white38
                                          : Colors.black38,
                                    ),
                                  ),
                              ],
                            ),
                            if (cheer.isVoiceNote)
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: InkWell(
                                  onTap: () => _playVoiceNote(cheer),
                                  borderRadius: BorderRadius.circular(10),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 10,
                                      vertical: 6,
                                    ),
                                    decoration: BoxDecoration(
                                      color: isDark
                                          ? const Color(0xFF064E3B)
                                          : const Color(0xFFECFDF5),
                                      borderRadius: BorderRadius.circular(10),
                                      border: Border.all(
                                        color: isDark
                                            ? const Color(0xFF047857)
                                            : const Color(0xFFBBF7D0),
                                      ),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          _playingCheerId == cheer.id
                                              ? Icons.stop_circle_rounded
                                              : Icons.play_circle_fill_rounded,
                                          color: isDark
                                              ? const Color(0xFF34D399)
                                              : const Color(0xFF16A34A),
                                          size: 20,
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          _playingCheerId == cheer.id
                                              ? 'Sedang Diputar...'
                                              : 'Putar Pesan Suara (${cheer.durationSeconds ?? 5}d)',
                                          style: TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.bold,
                                            color: isDark
                                                ? const Color(0xFF6EE7B7)
                                                : const Color(0xFF15803D),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              )
                            else if (cheer.message != null &&
                                cheer.message!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(
                                  cheer.message!,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: isDark
                                        ? Colors.white70
                                        : Colors.black87,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatCheerTime(String isoString) {
    try {
      final dt = DateTime.parse(isoString).toLocal();
      final h = dt.hour.toString().padLeft(2, '0');
      final m = dt.minute.toString().padLeft(2, '0');
      return '$h:$m';
    } catch (_) {
      return '';
    }
  }

  Widget _buildViewersCard() {
    if (!_isLive || _sessionToken == null) return const SizedBox.shrink();

    final isDark = WaymarkApp.of(context).isDark;
    final activeCount = _activeViewerCount;

    return Card(
      elevation: 0,
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFEAEAEA),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: activeCount > 0
                            ? const Color(0xFFE8F5E9)
                            : const Color(0xFFF5F5F5),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(
                        Icons.visibility_outlined,
                        color: activeCount > 0
                            ? const Color(0xFF2E7D32)
                            : Colors.black54,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Yang Memantau Anda',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: isDark ? Colors.white : kInkDark,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: activeCount > 0
                        ? (isDark ? const Color(0xFF064E3B) : const Color(0xFFE8F5E9))
                        : (isDark ? const Color(0xFF334155) : const Color(0xFFEEEEEE)),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (activeCount > 0) ...[
                        const CircleAvatar(
                          radius: 3.5,
                          backgroundColor: Color(0xFF10B981),
                        ),
                        const SizedBox(width: 5),
                      ],
                      Text(
                        activeCount > 0 ? '$activeCount Online' : 'Belum Ada',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: activeCount > 0
                              ? (isDark ? const Color(0xFF34D399) : const Color(0xFF2E7D32))
                              : (isDark ? Colors.white60 : Colors.black54),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (_viewers.isEmpty) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF9F9F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, size: 18, color: isDark ? Colors.white38 : Colors.black45),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Belum ada yang membuka link ini. Bagikan link live ke teman/keluarga agar nama mereka muncul di sini saat memantau.',
                        style: TextStyle(fontSize: 12, color: isDark ? Colors.white70 : Colors.black54),
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _viewers.length,
                separatorBuilder: (context, index) =>
                    Divider(height: 16, color: isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0)),
                itemBuilder: (context, index) {
                  final viewer = _viewers[index];
                  final name = viewer.displayName.trim();
                  final parts = name.split(' ').where((p) => p.isNotEmpty).toList();
                  final initials = parts.isNotEmpty
                      ? parts.take(2).map((p) => p[0].toUpperCase()).join()
                      : '?';

                  return Row(
                    children: [
                      CircleAvatar(
                        radius: 17,
                        backgroundColor: viewer.isOnline
                            ? (isDark ? const Color(0xFF064E3B) : const Color(0xFFE8F5E9))
                            : (isDark ? const Color(0xFF334155) : const Color(0xFFF5F5F5)),
                        child: Text(
                          initials,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: viewer.isOnline
                                ? (isDark ? const Color(0xFF34D399) : const Color(0xFF2E7D32))
                                : (isDark ? Colors.white38 : Colors.black45),
                          ),
                        ),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              viewer.displayName,
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                                color: isDark ? Colors.white : kInkDark,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              viewer.isOnline
                                  ? '🟢 Sedang memantau sekarang'
                                  : '⚪ Terakhir memantau beberapa saat lalu',
                              style: TextStyle(
                                fontSize: 11,
                                color: viewer.isOnline
                                    ? (isDark ? const Color(0xFF34D399) : const Color(0xFF168654))
                                    : (isDark ? Colors.white38 : Colors.black45),
                                fontWeight: viewer.isOnline
                                    ? FontWeight.w500
                                    : FontWeight.normal,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildBatteryModeSelector() {
    final isDark = WaymarkApp.of(context).isDark;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFEAEAEA),
        ),
      ),
      child: Row(
        children: [
          Icon(
            _trackingIntervalSeconds > 10 ? Icons.battery_saver : Icons.bolt,
            color: _trackingIntervalSeconds > 10
                ? const Color(0xFF10B981)
                : const Color(0xFFFF6B00),
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Mode Tracking & Baterai',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: isDark ? Colors.white : kInkDark,
                  ),
                ),
                Text(
                  'Atur interval GPS sesuai durasi lari',
                  style: TextStyle(
                    fontSize: 11,
                    color: isDark ? Colors.white70 : Colors.black54,
                  ),
                ),
              ],
            ),
          ),
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(
                value: 4,
                label: Text('Normal (4s)', style: TextStyle(fontSize: 11)),
              ),
              ButtonSegment(
                value: 30,
                label: Text('Eco (30s)', style: TextStyle(fontSize: 11)),
              ),
            ],
            selected: {_trackingIntervalSeconds},
            onSelectionChanged: (set) => _setTrackingInterval(set.first),
            style: const ButtonStyle(
              visualDensity: VisualDensity.compact,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ],
      ),
    );
  }
}
