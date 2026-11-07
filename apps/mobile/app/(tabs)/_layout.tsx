import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../../src/theme';

function TabGlyph({
  glyph,
  label,
  focused,
}: {
  glyph: string;
  label: string;
  focused: boolean;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 2, minWidth: 56 }}>
      <Text
        style={{
          fontFamily: fonts.monoSemi,
          fontSize: 13,
          color: focused ? colors.teal400 : colors.textTertiary,
        }}
      >
        {glyph}
      </Text>
      <Text
        style={{
          fontFamily: fonts.sansSemi,
          fontSize: 10,
          color: focused ? colors.teal400 : colors.textTertiary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 10 : Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 8,
          // @ts-expect-error web
          boxShadow: Platform.OS === 'web' ? '0 -8px 24px rgba(0,0,0,0.25)' : undefined,
        },
        tabBarActiveTintColor: colors.teal400,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="◉" label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="charging"
        options={{
          title: 'Charging',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="⊥" label="Charge" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="↗" label="Trips" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="▦" label="Stats" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="◎" label="You" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
