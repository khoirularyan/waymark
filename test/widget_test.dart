import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:waymark_mobile/main.dart';

void main() {
  testWidgets('WaymarkApp smoke test', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(const WaymarkApp());
    expect(find.text('waymark'), findsOneWidget);
    expect(find.text('Every journey,\nin sight.'), findsOneWidget);
    expect(find.text('Trail Route (GPX)'), findsOneWidget);
    expect(find.text('Pick GPX File'), findsOneWidget);
    expect(find.text('Sample GPX'), findsOneWidget);
  });
}
