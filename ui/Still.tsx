import { useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { stillUrl } from "./catalogue";

/**
 * An episode thumbnail, cropped from the left.
 *
 * Two things this handles that a plain `<Image resizeMode="cover">` does not:
 *
 * Size — `maxresdefault` is the only variant that is genuinely 16:9. `hqdefault` is a
 * 4:3 frame with the picture letterboxed inside it, which shows up as black bars on
 * every card. It is present for every episode here, but it is also the one variant
 * YouTube does not guarantee, so a miss falls back to the small 16:9 rather than to
 * the letterboxed one.
 *
 * Framing — the guests sit on the left of the show's thumbnails, and `cover` crops
 * from the centre with no way to say otherwise in React Native. Anchoring the image
 * at the left edge and letting its width follow its height keeps them in frame,
 * whatever the container's aspect ratio.
 */
export function Still({
  episodeId,
  style,
}: {
  episodeId: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.frame, style]}>
      <Image
        source={{ uri: stillUrl(episodeId, failed ? "mq" : "max") }}
        style={styles.image}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: "#05070A" },
  image: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    // Width follows height through the source's own ratio, so the crop eats the
    // right-hand side rather than both sides.
    aspectRatio: 16 / 9,
    height: "120%",
  },
});
