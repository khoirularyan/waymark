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

  List<double> toLngLat() => [
    longitude,
    latitude,
    ?elevation,
  ];
}

class RouteProgress {
  const RouteProgress({
    required this.closestIndex,
    required this.distanceFromRouteMeters,
    required this.isOffCourse,
    required this.distanceCoveredKm,
    required this.remainingDistanceKm,
    required this.remainingElevationGainMeters,
  });

  final int closestIndex;
  final double distanceFromRouteMeters;
  final bool isOffCourse;
  final double distanceCoveredKm;
  final double remainingDistanceKm;
  final double remainingElevationGainMeters;
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

  RouteProgress calculateProgress(double currentLat, double currentLon) {
    if (points.isEmpty) {
      return const RouteProgress(
        closestIndex: 0,
        distanceFromRouteMeters: 0,
        isOffCourse: false,
        distanceCoveredKm: 0,
        remainingDistanceKm: 0,
        remainingElevationGainMeters: 0,
      );
    }

    int closestIdx = 0;
    double minDistanceKm = double.infinity;

    for (int i = 0; i < points.length; i++) {
      final p = points[i];
      final d = _haversineKm(currentLat, currentLon, p.latitude, p.longitude);
      if (d < minDistanceKm) {
        minDistanceKm = d;
        closestIdx = i;
      }
    }

    final double distanceFromRouteMeters = minDistanceKm * 1000.0;
    final bool isOffCourse = distanceFromRouteMeters > 75.0;

    double coveredKm = 0.0;
    for (int i = 0; i < closestIdx; i++) {
      coveredKm += _haversineKm(
        points[i].latitude,
        points[i].longitude,
        points[i + 1].latitude,
        points[i + 1].longitude,
      );
    }

    double remainingKm = 0.0;
    double remainingEle = 0.0;
    for (int i = closestIdx; i < points.length - 1; i++) {
      remainingKm += _haversineKm(
        points[i].latitude,
        points[i].longitude,
        points[i + 1].latitude,
        points[i + 1].longitude,
      );
      if (points[i].elevation != null && points[i + 1].elevation != null) {
        final diff = points[i + 1].elevation! - points[i].elevation!;
        if (diff > 0) remainingEle += diff;
      }
    }

    return RouteProgress(
      closestIndex: closestIdx,
      distanceFromRouteMeters: distanceFromRouteMeters,
      isOffCourse: isOffCourse,
      distanceCoveredKm: double.parse(coveredKm.toStringAsFixed(2)),
      remainingDistanceKm: double.parse(remainingKm.toStringAsFixed(2)),
      remainingElevationGainMeters: double.parse(remainingEle.toStringAsFixed(0)),
    );
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
