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
  }) async {
    final uri = Uri.parse('$baseUrl/api/tracking/location');
    final response = await http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'token': token,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'battery': battery,
        'recordedAt': DateTime.now().toUtc().toIso8601String(),
      }),
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
}
