import 'dart:async';
import 'package:battery_plus/battery_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
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
  static String _resolveApiUrl() {
    const envUrl = String.fromEnvironment('WAYMARK_API_URL');
    if (envUrl.isNotEmpty) return envUrl;
    // On web or desktop use localhost; on Android emulator use 10.0.2.2
    return kIsWeb ? 'http://localhost:3000' : 'http://10.0.2.2:3000';
  }

  late final TrackingApi api = TrackingApi(_resolveApiUrl());

  StreamSubscription<Position>? _positionSubscription;
  Timer? _pollingTimer;

  bool _isLive = false;
  bool _gpsReady = false;
  bool _isLocating = false;
  int _batteryLevel = 100;
  String? _sessionToken;
  String? _lastUpdateTime;
  String? _lastCoords;

  // Selected GPX course/route
  GpxRoute? _selectedRoute;

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
      final savedToken = prefs.getString('session_token');
      if (mounted && savedToken != null) {
        setState(() => _sessionToken = savedToken);
      }
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

  Future<void> _handleNewPosition(Position position) async {
    int battery = _batteryLevel;
    try {
      battery = await Battery().batteryLevel;
    } catch (_) {}

    try {
      await api.sendLocation(
        token: _sessionToken!,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        battery: battery,
      );

      if (mounted) {
        setState(() {
          _gpsReady = true;
          _isLocating = false;
          _batteryLevel = battery;
          _lastUpdateTime = TimeOfDay.now().format(context);
          _lastCoords =
              '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
        });
      }
    } catch (_) {}
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

      _sessionToken ??= await api.start(
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

      // 2. Start position change stream
      const settings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
      );

      _positionSubscription = Geolocator.getPositionStream(
        locationSettings: settings,
      ).listen((Position p) => _handleNewPosition(p));

      // 3. Start a periodic timer to guarantee regular updates (especially on stationary/web)
      _pollingTimer?.cancel();
      _pollingTimer = Timer.periodic(const Duration(seconds: 4), (_) async {
        if (!_isLive || _sessionToken == null) return;
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 4),
            ),
          );
          await _handleNewPosition(pos);
        } catch (_) {}
      });
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
        title: const Text(
          'waymark',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            letterSpacing: -1,
            color: kInkDark,
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 20),
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
              _buildStatusCard(),
              const SizedBox(height: 14),
              _buildMetricsRow(),
              const SizedBox(height: 20),
              _buildGpxRouteCard(),
              const SizedBox(height: 24),
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
                SelectableText(
                  'Share link: ${api.baseUrl}/live/$_sessionToken',
                  style: const TextStyle(color: Colors.black54, fontSize: 13),
                ),
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
    return Row(
      children: [
        _buildMetricItem(
          'GPS',
          _lastCoords != null
              ? 'Fix OK'
              : (_isLocating
                    ? 'Locating...'
                    : (_gpsReady ? 'Ready' : 'Waiting')),
          subtext: _lastCoords,
        ),
        const SizedBox(width: 10),
        _buildMetricItem('Internet', 'Connected'),
        const SizedBox(width: 10),
        _buildMetricItem(
          'Battery',
          _batteryLevel == 0 ? '—' : '$_batteryLevel%',
        ),
      ],
    );
  }

  Widget _buildMetricItem(String label, String value, {String? subtext}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFEAEAEA)),
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
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                color: kInkDark,
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
}
