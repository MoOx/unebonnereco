import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { Recommendation } from "../src/types";
import { hms } from "./catalogue";
import { Still } from "./Still";
import { COLORS, FONTS, KIND_COLOR, KIND_LABEL, SPACE } from "./theme";

/** Kinds we can realistically source a cover for; the rest lean on the episode still. */
const HAS_COVER: Partial<Record<Recommendation["kind"], true>> = {
  film: true,
  series: true,
  documentary: true,
  book: true,
  comic: true,
  podcast: true,
  game: true,
};

const INK = "rgba(5,7,10,";

export function RecoCard({ reco }: { reco: Recommendation }) {
  const kind = KIND_COLOR[reco.kind];
  const unverified = reco.linkSource !== "reference";

  return (
    <Link href={`/reco/${reco.id}`} asChild>
      <Pressable style={styles.card}>
        <View style={styles.art}>
          <Still episodeId={reco.episodeId} style={styles.still} />

          {/* Sits behind the badge and the title. */}
          <LinearGradient
            colors={[`${INK}0.88)`, `${INK}0.45)`, "transparent"]}
            locations={[0, 0.4, 1]}
            style={styles.topVeil}
            pointerEvents="none"
          />

          {/* The show's thumbnails usually carry their own caption in the bottom-right,
              which fights anything placed there. A diagonal wash anchored on that corner
              buries it, and gives the poster something to sit on. */}
          <LinearGradient
            colors={["transparent", `${INK}1)`]}
            locations={[0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={styles.topStack}>
            <View style={styles.badges}>
              <View style={[styles.tag, { backgroundColor: kind }]}>
                <Text style={styles.tagText}>{KIND_LABEL[reco.kind]}</Text>
              </View>
              {unverified ? (
                <View style={styles.flag}>
                  <Text style={styles.flagText}>à confirmer</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.title} numberOfLines={3}>
              {reco.title}
            </Text>
          </View>

          {reco.posterUrl ? (
            <Image
              source={{ uri: reco.posterUrl }}
              style={styles.poster}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : HAS_COVER[reco.kind] ? (
            // A coloured plate holds the slot for kinds whose art we could source but
            // did not find, so the composition stays the same either way.
            <View
              style={[styles.poster, { backgroundColor: kind, opacity: 0.9 }]}
            />
          ) : null}
        </View>

        <View style={styles.meta}>
          <View style={styles.who}>
            <Still
              episodeId={reco.episodeId}
              style={[styles.face, { borderColor: kind }]}
            />
            {/* An inferred name is hedged rather than stated: the transcript carries
                no speaker labels, so most attributions are the model's best guess. */}
            {reco.recommendedBy && !reco.attributionCued ? (
              <Text style={styles.maybe}>probablement </Text>
            ) : null}
            <Text
              style={[styles.name, !reco.attributionCued && styles.nameSoft]}
              numberOfLines={1}
            >
              {reco.recommendedBy || "Quelqu'un"}
            </Text>
            <Text style={styles.tc}>{hms(reco.timecodeS)}</Text>
          </View>
          {reco.description ? (
            <Text style={styles.blurb} numberOfLines={2}>
              {reco.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    borderRadius: 18,
    overflow: "hidden",
  },
  /* Square rather than portrait: the source is 16:9, and a 4:5 frame kept barely a
     quarter of its width. */
  art: { aspectRatio: 1, backgroundColor: "#05070A" },
  // Written out rather than `StyleSheet.absoluteFillObject`, which react-native-web
  // has but react-native's own types no longer declare.
  still: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  topVeil: { position: "absolute", left: 0, right: 0, top: 0, height: "60%" },

  /* Badge first, title directly under it, both anchored top-left. */
  topStack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    padding: SPACE.lg,
    gap: SPACE.md,
    alignItems: "flex-start",
  },
  badges: { flexDirection: "row", gap: SPACE.sm },
  tag: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  tagText: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: COLORS.onKind,
  },
  flag: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  flagText: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
  },

  title: {
    fontFamily: FONTS.display,
    fontSize: 34,
    lineHeight: 34,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: -0.5,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowRadius: 14,
  },

  poster: {
    position: "absolute",
    right: SPACE.lg,
    bottom: SPACE.lg,
    width: "40%",
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: "#05070A",
  },

  meta: { padding: SPACE.lg, gap: SPACE.sm },
  who: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  face: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5 },
  name: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },
  nameSoft: { fontWeight: "500", color: COLORS.muted },
  maybe: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.muted },
  verb: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.muted,
    flexShrink: 1,
  },
  tc: {
    marginLeft: "auto",
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.muted,
  },
  blurb: {
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
  },
});
