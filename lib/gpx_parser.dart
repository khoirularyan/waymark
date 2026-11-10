import 'dart:math' as math;
import 'package:xml/xml.dart' as xml;

class GpxRoutePoint {
  const GpxRoutePoint({
    required this.latitude,
    required this.longitude,
    this.elevation,
  });

  final double latitude;
  final double longitude;
  final double? elevation;

  List<double> toLngLat() => [longitude, latitude];
}

class GpxRoute {
  const GpxRoute({
    required this.name,
    required this.points,
    required this.totalDistanceKm,
    required this.elevationGainMeters,
  });

  final String name;
  final List<GpxRoutePoint> points;
  final double totalDistanceKm;
  final double elevationGainMeters;

  Map<String, dynamic> toGeoJson() {
    return {
      'type': 'Feature',
      'properties': {
        'name': name,
        'totalDistanceKm': totalDistanceKm,
        'elevationGainMeters': elevationGainMeters,
        'pointCount': points.length,
      },
      'geometry': {
        'type': 'LineString',
        'coordinates': points.map((p) => p.toLngLat()).toList(),
      },
    };
  }

  static GpxRoute parse(
    String xmlContent, {
    String fallbackName = 'Custom Route',
  }) {
    final document = xml.XmlDocument.parse(xmlContent);

    // Extract name
    String? routeName;
    final nameElem = document.findAllElements('name').firstOrNull;
    if (nameElem != null && nameElem.innerText.trim().isNotEmpty) {
      routeName = nameElem.innerText.trim();
    }
    routeName ??= fallbackName;

    // Look for trkpt, then rtept, then wpt
    var pointElements = document.findAllElements('trkpt').toList();
    if (pointElements.isEmpty) {
      pointElements = document.findAllElements('rtept').toList();
    }
    if (pointElements.isEmpty) {
      pointElements = document.findAllElements('wpt').toList();
    }

    if (pointElements.isEmpty) {
      throw Exception('No track or route points found in GPX file.');
    }

    final points = <GpxRoutePoint>[];
    double totalDistance = 0.0;
    double elevationGain = 0.0;
    GpxRoutePoint? previousPoint;

    for (final elem in pointElements) {
      final latStr = elem.getAttribute('lat');
      final lonStr = elem.getAttribute('lon');
      if (latStr == null || lonStr == null) continue;

      final lat = double.tryParse(latStr);
      final lon = double.tryParse(lonStr);
      if (lat == null || lon == null) continue;

      final eleElem = elem.findElements('ele').firstOrNull;
      final ele = eleElem != null ? double.tryParse(eleElem.innerText) : null;

      final current = GpxRoutePoint(
        latitude: lat,
        longitude: lon,
        elevation: ele,
      );

      if (previousPoint != null) {
        totalDistance += _haversineKm(
          previousPoint.latitude,
          previousPoint.longitude,
          current.latitude,
          current.longitude,
        );

        if (previousPoint.elevation != null && current.elevation != null) {
          final diff = current.elevation! - previousPoint.elevation!;
          if (diff > 0) {
            elevationGain += diff;
          }
        }
      }

      points.add(current);
      previousPoint = current;
    }

    return GpxRoute(
      name: routeName,
      points: points,
      totalDistanceKm: double.parse(totalDistance.toStringAsFixed(2)),
      elevationGainMeters: double.parse(elevationGain.toStringAsFixed(0)),
    );
  }

  static double _haversineKm(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const earthRadiusKm = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180.0;
    final dLon = (lon2 - lon1) * math.pi / 180.0;
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180.0) *
            math.cos(lat2 * math.pi / 180.0) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadiusKm * c;
  }
}

/// Built-in demo GPX for testing (Mount Rinjani Trail)
const kSampleRinjaniGpx = '''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Waymark Trail System">
  <metadata>
    <name>Mount Rinjani Training Run</name>
  </metadata>
  <trk>
    <name>Mount Rinjani Training Run</name>
    <trkseg>
      <trkpt lat="-8.4090" lon="116.3910"><ele>1150</ele></trkpt>
      <trkpt lat="-8.4050" lon="116.3980"><ele>1320</ele></trkpt>
      <trkpt lat="-8.3990" lon="116.4050"><ele>1580</ele></trkpt>
      <trkpt lat="-8.3950" lon="116.4150"><ele>1850</ele></trkpt>
      <trkpt lat="-8.4000" lon="116.4230"><ele>2100</ele></trkpt>
      <trkpt lat="-8.3850" lon="116.4320"><ele>2390</ele></trkpt>
      <trkpt lat="-8.3700" lon="116.4410"><ele>2640</ele></trkpt>
      <trkpt lat="-8.3600" lon="116.4600"><ele>2800</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
''';
