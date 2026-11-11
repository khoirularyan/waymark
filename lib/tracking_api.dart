import 'dart:convert';
import 'package:http/http.dart' as http;

class TrackingApi {
  TrackingApi(this.baseUrl);

  final String baseUrl;

  /// Starts a new tracking session and returns the generated share token.
  Future<String> start({
    required String runnerName,
    required String eventName,
    Map<String, dynamic>? route,
  }) async {
    final uri = Uri.parse('$baseUrl/api/tracking/start');
    final Map<String, dynamic> payload = {
      'runnerName': runnerName,
      'eventName': eventName,
    };

    if (route != null) {
      payload['route'] = route;
    }

    final response = await http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode(payload),
    );

    if (response.statusCode != 201) {
      throw Exception(
        'Could not start tracking session: ${response.statusCode}',
      );
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return data['shareToken'] as String;
  }

  /// Sends a GPS position fix to the tracking server.
  Future<LocationSyncResponse?> sendLocation({
    required String token,
    required double latitude,
    required double longitude,
    required double accuracy,
    required int battery,
    double? altitude,
    double? speed,
    double? heading,
    bool? isSos,
  }) async {
    final uri = Uri.parse('$baseUrl/api/tracking/location');
    final Map<String, dynamic> payload = {
      'token': token,
      'latitude': latitude,
      'longitude': longitude,
      'accuracy': accuracy,
      'battery': battery,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
    };

    if (altitude != null) payload['altitude'] = altitude;
    if (speed != null) payload['speed'] = speed;
    if (heading != null) payload['heading'] = heading;
    if (isSos != null) payload['isSos'] = isSos;

    final response = await http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode(payload),
    );

    if (response.statusCode >= 300) {
      throw Exception('Location update failed: ${response.statusCode}');
    }

    try {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return LocationSyncResponse.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  /// Sends a batch of queued GPS fixes (Store & Forward offline sync).
  Future<LocationSyncResponse?> sendLocationBatch({
    required String token,
    required List<Map<String, dynamic>> locations,
  }) async {
    if (locations.isEmpty) return null;
    final uri = Uri.parse('$baseUrl/api/tracking/location');
    final response = await http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'token': token,
        'locations': locations,
      }),
    );

    if (response.statusCode >= 300) {
      throw Exception('Batch location update failed: ${response.statusCode}');
    }

    try {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return LocationSyncResponse.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  /// Stops an active tracking session.
  Future<void> stop(String token) async {
    final uri = Uri.parse('$baseUrl/api/tracking/stop');
    final response = await http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'token': token}),
    );

    if (response.statusCode >= 300) {
      throw Exception('Failed to stop tracking: ${response.statusCode}');
    }
  }

  /// Retrieves the list of viewers currently or recently viewing the tracking session.
  Future<List<ViewerInfo>> getViewers(String token) async {
    try {
      final uri = Uri.parse('$baseUrl/api/tracking/$token/viewer');
      final response = await http.get(uri);
      if (response.statusCode != 200) return [];
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final list = data['viewers'] as List<dynamic>? ?? [];
      return list
          .map((v) => ViewerInfo.fromJson(v as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Retrieves the recent cheers sent by spectators.
  Future<List<CheerInfo>> getCheers(String token) async {
    try {
      final uri = Uri.parse('$baseUrl/api/tracking/$token/cheer');
      final response = await http.get(uri);
      if (response.statusCode != 200) return [];
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final list = data['cheers'] as List<dynamic>? ?? [];
      return list
          .map((c) => CheerInfo.fromJson(c as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }
}

class CheerInfo {
  const CheerInfo({
    required this.id,
    required this.senderName,
    this.message,
    this.emoji = '👏',
    required this.createdAt,
  });

  final String id;
  final String senderName;
  final String? message;
  final String emoji;
  final String createdAt;

  factory CheerInfo.fromJson(Map<String, dynamic> json) {
    return CheerInfo(
      id: json['id'] as String? ?? '',
      senderName: json['senderName'] as String? ?? 'Penonton',
      message: json['message'] as String?,
      emoji: json['emoji'] as String? ?? '👏',
      createdAt: json['createdAt'] as String? ?? '',
    );
  }
}

class ViewerInfo {
  const ViewerInfo({
    required this.visitorId,
    required this.displayName,
    required this.isOnline,
    required this.lastSeenAt,
  });

  final String visitorId;
  final String displayName;
  final bool isOnline;
  final String lastSeenAt;

  factory ViewerInfo.fromJson(Map<String, dynamic> json) {
    return ViewerInfo(
      visitorId: json['visitorId'] as String? ?? '',
      displayName: json['displayName'] as String? ?? 'Spectator',
      isOnline: json['isOnline'] as bool? ?? false,
      lastSeenAt: json['lastSeenAt'] as String? ?? '',
    );
  }
}

class LocationSyncResponse {
  const LocationSyncResponse({
    this.syncedCount,
    this.activeViewerCount = 0,
    this.viewers = const [],
    this.cheers = const [],
  });

  final int? syncedCount;
  final int activeViewerCount;
  final List<ViewerInfo> viewers;
  final List<CheerInfo> cheers;

  factory LocationSyncResponse.fromJson(Map<String, dynamic> json) {
    final sessionMap = json['session'] as Map<String, dynamic>?;
    final rawViewers = (json['viewers'] ?? sessionMap?['viewers']) as List<dynamic>? ?? [];
    final rawCheers = (json['cheers'] ?? sessionMap?['cheers']) as List<dynamic>? ?? [];
    final activeCount = (json['activeViewerCount'] ?? sessionMap?['activeViewerCount']) as int? ?? 0;
    final synced = json['syncedCount'] as int?;

    return LocationSyncResponse(
      syncedCount: synced,
      activeViewerCount: activeCount,
      viewers: rawViewers
          .map((v) => ViewerInfo.fromJson(v as Map<String, dynamic>))
          .toList(),
      cheers: rawCheers
          .map((c) => CheerInfo.fromJson(c as Map<String, dynamic>))
          .toList(),
    );
  }
}

