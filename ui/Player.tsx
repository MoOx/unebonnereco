import { createElement } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { Recommendation } from "../src/types";
import { embedUrl, hms } from "./catalogue";
import { COLORS, FONTS, SPACE } from "./theme";

/**
 * The recommendation itself, playing in place.
 *
 * This is the thing the site has that nothing else does: not a trailer, but the
 * moment the guest actually says it. The embed is bounded by `start` and `end`, so it
 * stops on its own rather than running into the rest of the episode.
 *
 * Web gets a real iframe; native has no such element, so it hands off to the YouTube
 * app at the same timecode.
 */
export function Player({ reco }: { reco: Recommendation }) {
  const length = reco.clipEndS - reco.clipStartS;

  if (Platform.OS === "web") {
    return (
      <View style={styles.frame}>
        {createElement("iframe", {
          src: embedUrl(reco),
          style: { width: "100%", height: "100%", border: 0, display: "block" },
          allow: "accelerometer; encrypted-media; picture-in-picture; web-share",
          allowFullScreen: true,
          loading: "lazy",
          title: `${reco.title} — le passage`,
        })}
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.frame, styles.fallback]}
      onPress={() => Linking.openURL(reco.timestampedUrl)}
      accessibilityRole="button"
      accessibilityLabel={`Écouter le passage, ${length} secondes`}
    >
      <Text style={styles.play}>▶︎</Text>
      <Text style={styles.label}>
        Écouter le passage · {hms(reco.clipStartS)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  fallback: { alignItems: "center", justifyContent: "center", gap: SPACE.md },
  play: { fontSize: 40, color: "#fff" },
  label: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.text },
});
