import 'package:flutter_test/flutter_test.dart';
import 'package:waymark_mobile/main.dart';

void main() {
  testWidgets('WaymarkApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const WaymarkApp());
    expect(find.text('waymark'), findsOneWidget);
    expect(find.text('Every journey,\nin sight.'), findsOneWidget);
    expect(find.text('Trail Route (GPX)'), findsOneWidget);
    expect(find.text('Pick GPX File'), findsOneWidget);
    expect(find.text('Sample GPX'), findsOneWidget);
  });
}
