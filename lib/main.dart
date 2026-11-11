import 'dart:async';
import 'dart:convert';
import 'package:battery_plus/battery_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gpx_parser.dart';
import 'tracking_api.dart';

const kBrandOrange = Color(0xFFE85D3F);
const kBrandGreen = Color(0xFF10B981);
const kInkDark = Color(0xFF171717);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const WaymarkApp());
}

class WaymarkApp extends StatelessWidget {
  const WaymarkApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Waymark',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFFBFBFA),
        colorScheme: ColorScheme.fromSeed(
          seedColor: kBrandOrange,
          primary: kBrandOrange,
        ),
      ),
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

  late String _serverUrl = _resolveApiUrl();
  late TrackingApi api = TrackingApi(_serverUrl);

  StreamSubscription<Position>? _positionSubscription;
  Timer? _pollingTimer;

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

  @override
  void initState() {
    super.initState();
    _loadInitialState();
  }

  Future<void> _loadInitialState() async {
    try {
      final battery = await Battery().batteryLevel;
      if (mounted) setState(() => _batteryLevel = battery);
    } catch (_) {
      // In web browser or desktop without battery API, keep default 100%
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString('server_url');
      if (savedUrl != null && savedUrl.isNotEmpty) {
        setState(() {
          _serverUrl = savedUrl;
          api = TrackingApi(_serverUrl);
        });
      }

      final savedQueueJson = prefs.getString('offline_queue');
      if (savedQueueJson != null) {
        final List<dynamic> decoded = jsonDecode(savedQueueJson);
        setState(() {
          _offlineQueue.addAll(
            decoded.map((item) => Map<String, dynamic>.from(item as Map)),
          );
        });
      }
    } catch (_) {}
  }

  Future<void> _persistOfflineQueue() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('offline_queue', jsonEncode(_offlineQueue));
    } catch (_) {}
  }

  Future<void> _showServerSettings() async {
    final controller = TextEditingController(text: _serverUrl);
    final selected = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server Endpoint'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Pilih server backend untuk tracking:',
              style: TextStyle(fontSize: 13, color: Colors.black54),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'API Base URL',
                hintText: 'https://waymark-seven.vercel.app',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => controller.text = kDefaultServerUrl,
                    child: const Text('Vercel (Live)'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => controller.text = 'http://localhost:3000',
                    child: const Text('Localhost'),
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Simpan'),
          ),
        ],
      ),
    );

    if (selected != null && selected.isNotEmpty && selected != _serverUrl) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('server_url', selected);
      setState(() {
        _serverUrl = selected;
        api = TrackingApi(_serverUrl);
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Server dialihkan ke: $_serverUrl'),
            backgroundColor: const Color(0xFF168654),
          ),
        );
      }
    }
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

    final locData = <String, dynamic>{
      'latitude': position.latitude,
      'longitude': position.longitude,
      'accuracy': position.accuracy,
      'battery': battery,
      'altitude': position.altitude,
      'speed': position.speed,
      'heading': position.heading,
      'isSos': _isSos,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
    };

    if (_sessionToken != null) {
      if (_offlineQueue.isNotEmpty && !_isFlushingQueue) {
        _isFlushingQueue = true;
        try {
          final toSend = [..._offlineQueue, locData];
          final synced = await api.sendLocationBatch(
            token: _sessionToken!,
            locations: toSend,
          );
          _offlineQueue.clear();
          await _persistOfflineQueue();
          if (mounted && toSend.length > 1) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Sinyal pulih: $synced titik offline berhasil disinkronkan!',
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
          await api.sendLocation(
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
        } catch (_) {
          _offlineQueue.add(locData);
          if (_offlineQueue.length > 500) _offlineQueue.removeAt(0);
          await _persistOfflineQueue();
        }
      }
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

    final settings = LocationSettings(
      accuracy: _trackingIntervalSeconds > 10
          ? LocationAccuracy.medium
          : LocationAccuracy.high,
      distanceFilter: _trackingIntervalSeconds > 10 ? 15 : 5,
    );

    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: settings,
    ).listen((Position p) => _handleNewPosition(p));

    _pollingTimer = Timer.periodic(
      Duration(seconds: _trackingIntervalSeconds),
      (_) async {
        if (!_isLive || _sessionToken == null) return;
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: LocationSettings(
              accuracy: _trackingIntervalSeconds > 10
                  ? LocationAccuracy.medium
                  : LocationAccuracy.high,
              timeLimit: const Duration(seconds: 4),
            ),
          );
          await _handleNewPosition(pos);
        } catch (_) {}

        // Poll spectators watching our session
        try {
          final viewers = await api.getViewers(_sessionToken!);
          if (mounted) setState(() => _viewers = viewers);
        } catch (_) {}

        // Poll incoming cheers from spectators
        try {
          final cheers = await api.getCheers(_sessionToken!);
          if (mounted) {
            for (final c in cheers) {
              if (!_seenCheerIds.contains(c.id)) {
                _seenCheerIds.add(c.id);
                final text = c.message != null && c.message!.isNotEmpty
                    ? '${c.emoji} "${c.message}" — dari ${c.senderName}'
                    : '${c.emoji} Sorakan semangat dari ${c.senderName}!';
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
            setState(() => _cheers = cheers);
          }
        } catch (_) {}
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

      _sessionToken = await api.start(
        runnerName: 'Waymark Runner',
        eventName: _selectedRoute?.name ?? 'Outdoor session',
        route: routePayload,
      );

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('session_token', _sessionToken!);

      setState(() {
        _isLive = true;
      });

      // 1. Immediately request the initial real GPS position fix
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

      // 2. Start position change stream & timer based on selected battery mode
      _startTimersAndStream();

      // Initial viewers & cheers fetch
      try {
        final initialViewers = await api.getViewers(_sessionToken!);
        final initialCheers = await api.getCheers(_sessionToken!);
        for (final c in initialCheers) {
          _seenCheerIds.add(c.id);
        }
        if (mounted) {
          setState(() {
            _viewers = initialViewers;
            _cheers = initialCheers;
          });
        }
      } catch (_) {}
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
        _cheers = [];
        _seenCheerIds.clear();
        _routeProgress = null;
      });
    }
  }

  @override
  void dispose() {
    _positionSubscription?.cancel();
    _pollingTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'waymark',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                letterSpacing: -1,
                color: kInkDark,
              ),
            ),
            InkWell(
              onTap: _showServerSettings,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _serverUrl.contains('vercel') ? Icons.cloud_done : Icons.dns_outlined,
                    size: 12,
                    color: _serverUrl.contains('vercel') ? const Color(0xFF16A34A) : Colors.black54,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _serverUrl.replaceAll('https://', '').replaceAll('http://', ''),
                    style: TextStyle(
                      fontSize: 11,
                      color: _serverUrl.contains('vercel') ? const Color(0xFF16A34A) : Colors.black54,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const Icon(Icons.arrow_drop_down, size: 14, color: Colors.black45),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _showServerSettings,
            icon: const Icon(Icons.tune, size: 20, color: Colors.black87),
            tooltip: 'Server Settings',
          ),
          if (_isLive)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  backgroundColor: _isSos
                      ? const Color(0xFFDC2626)
                      : const Color(0xFFFEF2F2),
                  foregroundColor: _isSos
                      ? Colors.white
                      : const Color(0xFFDC2626),
                  side: BorderSide(
                    color: _isSos ? Colors.transparent : const Color(0xFFFCA5A5),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                onPressed: _toggleSos,
                icon: Icon(
                  _isSos ? Icons.warning : Icons.emergency_outlined,
                  size: 14,
                ),
                label: Text(
                  _isSos ? 'SOS ON' : 'SOS',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: _isLive
                      ? const Color(0xFFE8F5E9)
                      : const Color(0xFFEEEEEE),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  _isLive ? 'LIVE' : 'READY',
                  style: TextStyle(
                    color: _isLive
                        ? const Color(0xFF2E7D32)
                        : const Color(0xFF616161),
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text(
                'Every journey,\nin sight.',
                style: TextStyle(
                  fontSize: 38,
                  height: 1.0,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1.5,
                  color: kInkDark,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                _isLive
                    ? 'Sharing your live trail position.'
                    : 'Start a private live location session with your trail route.',
                style: const TextStyle(color: Colors.black54, fontSize: 16),
              ),
              const SizedBox(height: 24),
              if (_isLive && _isSos) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDC2626),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.emergency, color: Colors.white, size: 28),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'SINYAL DARURAT (SOS) AKTIF!',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Pemantau di web menerima peringatan alarm dan koordinat Anda.',
                              style: TextStyle(color: Colors.white70, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      FilledButton.tonal(
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xFFDC2626),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          minimumSize: Size.zero,
                        ),
                        onPressed: _toggleSos,
                        child: const Text('Matikan', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (_isLive && _routeProgress != null && _routeProgress!.isOffCourse) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFBEB),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFFDE68A)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Peringatan: Melenceng dari Rute GPX',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: Color(0xFF92400E),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Posisi Anda terdeteksi melenceng ~${_routeProgress!.distanceFromRouteMeters.round()} meter dari rute resmi.',
                              style: const TextStyle(fontSize: 11, color: Color(0xFFB45309)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (_offlineQueue.isNotEmpty) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFCBD5E1)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.cloud_off, size: 18, color: Color(0xFF475569)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '📴 Mode Offline: ${_offlineQueue.length} titik tersimpan (akan dikirim saat kembali dapat sinyal).',
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF334155),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
              ],
              _buildStatusCard(),
              const SizedBox(height: 14),
              _buildMetricsRow(),
              const SizedBox(height: 20),
              _buildGpxRouteCard(),
              const SizedBox(height: 14),
              _buildBatteryModeSelector(),
              const SizedBox(height: 20),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: _isLive
                      ? const Color(0xFFDC4545)
                      : kBrandOrange,
                  minimumSize: const Size.fromHeight(56),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                onPressed: _isLocating
                    ? null
                    : (_isLive ? _stopTracking : _startTracking),
                icon: Icon(
                  _isLive ? Icons.stop_rounded : Icons.navigation_rounded,
                ),
                label: Text(
                  _isLocating
                      ? 'ACQUIRING GPS...'
                      : (_isLive ? 'STOP TRACKING' : 'START TRACKING'),
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ),
              if (_isLive && _sessionToken != null) ...[
                const SizedBox(height: 18),
                Card(
                  elevation: 0,
                  color: const Color(0xFFF0FDF4),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: const BorderSide(color: Color(0xFFBBF7D0)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.share, color: Color(0xFF16A34A), size: 18),
                            SizedBox(width: 8),
                            Text(
                              'Live Tracking Link (Spectators)',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF15803D),
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SelectableText(
                          '${api.baseUrl}/live/$_sessionToken',
                          style: const TextStyle(
                            fontSize: 13,
                            color: kInkDark,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF16A34A),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 10,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                ),
                              ),
                              onPressed: () {
                                Clipboard.setData(
                                  ClipboardData(
                                    text: '${api.baseUrl}/live/$_sessionToken',
                                  ),
                                );
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Link sesi lari berhasil disalin!'),
                                    backgroundColor: Color(0xFF16A34A),
                                  ),
                                );
                              },
                              icon: const Icon(Icons.copy, size: 16),
                              label: const Text('Salin Link Live'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                _buildViewersCard(),
                const SizedBox(height: 14),
                _buildCheersCard(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGpxRouteCard() {
    if (_selectedRoute != null) {
      return Card(
        elevation: 0,
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFD6E7DC)),
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
                      color: const Color(0xFFFFF7ED),
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
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                            color: kInkDark,
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
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 20,
                        color: Colors.black45,
                      ),
                      tooltip: 'Remove route',
                      onPressed: _clearRoute,
                    ),
                ],
              ),
              const Divider(height: 24, color: Color(0xFFF0F0F0)),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _routeDetail(
                    'Distance',
                    '${_selectedRoute!.totalDistanceKm} km',
                  ),
                  _routeDetail(
                    'Elevation Gain',
                    '+${_selectedRoute!.elevationGainMeters} m',
                  ),
                  _routeDetail(
                    'Waypoints',
                    '${_selectedRoute!.points.length} pts',
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
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEAEAEA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.map_outlined, color: kBrandOrange, size: 20),
              SizedBox(width: 8),
              Text(
                'Trail Route (GPX)',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                  color: kInkDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Load a GPX route to share the course path (orange line) with spectators.',
            style: TextStyle(fontSize: 13, color: Colors.black54),
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

  Widget _routeDetail(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: Colors.black54),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: kInkDark,
          ),
        ),
      ],
    );
  }

  Widget _buildStatusCard() {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFEAEAEA)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _isLive ? 'Tracking active' : 'Tracking status',
              style: const TextStyle(color: Colors.black54),
            ),
            const SizedBox(height: 6),
            Text(
              _isLive ? 'Live location is shared' : 'Not tracking',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: kInkDark,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              _lastCoords != null
                  ? 'Current GPS: $_lastCoords ($_lastUpdateTime)'
                  : (_lastUpdateTime == null
                        ? 'Waiting for first location update'
                        : 'Last update $_lastUpdateTime'),
              style: TextStyle(
                color: _lastCoords != null ? kBrandGreen : Colors.black54,
                fontWeight: _lastCoords != null
                    ? FontWeight.w600
                    : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricsRow() {
    return Column(
      children: [
        Row(
          children: [
            _buildMetricItem(
              'GPS Sinyal',
              _lastCoords != null
                  ? 'Fix OK'
                  : (_isLocating
                        ? 'Locating...'
                        : (_gpsReady ? 'Ready' : 'Waiting')),
              subtext: _lastCoords,
            ),
            const SizedBox(width: 10),
            _buildMetricItem(
              'Penonton',
              _isLive ? '$_activeViewerCount Online' : '—',
              subtext: _viewers.isNotEmpty ? '${_viewers.length} terhubung' : null,
              isHighlight: _activeViewerCount > 0,
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _buildMetricItem(
              'Pace Saat Ini',
              _currentPace,
              subtext: _currentSpeedKmh > 0.5 ? '${_currentSpeedKmh.toStringAsFixed(1)} km/h' : null,
            ),
            const SizedBox(width: 10),
            _buildMetricItem(
              'Ketinggian',
              _currentAltitudeM != null ? '${_currentAltitudeM!.round()} mdpl' : '—',
              subtext: 'Elevasi sekarang',
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _buildMetricItem(
              'Baterai HP',
              _batteryLevel == 0 ? '—' : '$_batteryLevel%',
              subtext: _batteryLevel <= 20 ? 'Perlu dicas!' : 'Normal',
            ),
            const SizedBox(width: 10),
            _buildMetricItem(
              _selectedRoute != null ? 'Sisa Jarak' : 'Koneksi',
              _selectedRoute != null
                  ? '${_routeProgress?.remainingDistanceKm ?? _selectedRoute!.totalDistanceKm} km'
                  : 'Connected',
              subtext: _selectedRoute != null
                  ? 'Sisa D+: +${_routeProgress?.remainingElevationGainMeters ?? _selectedRoute!.elevationGainMeters}m'
                  : null,
              isHighlight: _selectedRoute != null,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildCheersCard() {
    if (!_isLive || _sessionToken == null) return const SizedBox.shrink();

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFEAEAEA)),
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
                            ? const Color(0xFFFFF1F2)
                            : const Color(0xFFF5F5F5),
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
                    const Text(
                      'Sorakan Penonton',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: kInkDark,
                      ),
                    ),
                  ],
                ),
                if (_cheers.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF1F2),
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
                  color: const Color(0xFFF9F9F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.chat_bubble_outline, size: 18, color: Colors.black45),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Belum ada sorakan. Penonton di web bisa mengirim emoji & pesan semangat yang langsung muncul di sini.',
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
                itemCount: _cheers.take(5).length,
                separatorBuilder: (_, __) =>
                    const Divider(height: 16, color: Color(0xFFF0F0F0)),
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
                            Text(
                              cheer.senderName,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: kInkDark,
                              ),
                            ),
                            if (cheer.message != null && cheer.message!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(
                                  cheer.message!,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: Colors.black87,
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

  Widget _buildMetricItem(
    String label,
    String value, {
    String? subtext,
    bool isHighlight = false,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isHighlight
                ? const Color(0xFF10B981)
                : const Color(0xFFEAEAEA),
            width: isHighlight ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(fontSize: 12, color: Colors.black54),
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: isHighlight ? const Color(0xFF168654) : kInkDark,
              ),
            ),
            if (subtext != null) ...[
              const SizedBox(height: 2),
              Text(
                subtext,
                style: const TextStyle(
                  fontSize: 10,
                  color: Color(0xFF168654),
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildViewersCard() {
    if (!_isLive || _sessionToken == null) return const SizedBox.shrink();

    final activeCount = _activeViewerCount;

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFEAEAEA)),
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
                    const Text(
                      'Yang Memantau Anda',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: kInkDark,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: activeCount > 0
                        ? const Color(0xFFE8F5E9)
                        : const Color(0xFFEEEEEE),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (activeCount > 0) ...[
                        const CircleAvatar(
                          radius: 3.5,
                          backgroundColor: Color(0xFF2E7D32),
                        ),
                        const SizedBox(width: 5),
                      ],
                      Text(
                        activeCount > 0 ? '$activeCount Online' : 'Belum Ada',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: activeCount > 0
                              ? const Color(0xFF2E7D32)
                              : Colors.black54,
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
                  color: const Color(0xFFF9F9F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, size: 18, color: Colors.black45),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Belum ada yang membuka link ini. Bagikan link live ke teman/keluarga agar nama mereka muncul di sini saat memantau.',
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
                itemCount: _viewers.length,
                separatorBuilder: (_, __) =>
                    const Divider(height: 16, color: Color(0xFFF0F0F0)),
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
                            ? const Color(0xFFE8F5E9)
                            : const Color(0xFFF5F5F5),
                        child: Text(
                          initials,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: viewer.isOnline
                                ? const Color(0xFF2E7D32)
                                : Colors.black45,
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
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                                color: kInkDark,
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
                                    ? const Color(0xFF168654)
                                    : Colors.black45,
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
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFEAEAEA)),
      ),
      child: Row(
        children: [
          Icon(
            _trackingIntervalSeconds > 10 ? Icons.battery_saver : Icons.bolt,
            color: _trackingIntervalSeconds > 10
                ? const Color(0xFF168654)
                : const Color(0xFFFF6B00),
            size: 20,
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Mode Tracking & Baterai',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: kInkDark,
                  ),
                ),
                Text(
                  'Atur interval GPS sesuai durasi lari',
                  style: TextStyle(fontSize: 11, color: Colors.black54),
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
