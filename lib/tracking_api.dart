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
  Future<void> sendLocation({
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
