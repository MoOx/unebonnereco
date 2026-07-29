import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { COLORS, FONTS } from "../ui/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.ground },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontFamily: FONTS.display, fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: COLORS.ground },
          // Every screen is reachable by URL, so a direct visit needs a way back.
          headerBackTitle: "Retour",
        }}
      >
        <Stack.Screen name="index" options={{ title: "Un Bon Moment" }} />
        <Stack.Screen name="reco/[id]" options={{ title: "" }} />
        <Stack.Screen name="invite/[name]" options={{ title: "" }} />
      </Stack>
    </>
  );
}
