import { Link } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { WorkKind } from "../src/types";
import { RecoCard } from "../ui/RecoCard";
import {
  RECOMMENDATIONS,
  guestSlug,
  guests,
  kindsPresent,
} from "../ui/catalogue";
import { Still } from "../ui/Still";
import { COLORS, FONTS, KIND_LABEL, SPACE } from "../ui/theme";

/** Deterministic until the reader asks otherwise; the seed changes on every shuffle. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function Feed() {
  const [kind, setKind] = useState<WorkKind | "all">("all");
  const [seed, setSeed] = useState(0);

  const kinds = useMemo(kindsPresent, []);
  const people = useMemo(guests, []);

  const list = useMemo(() => {
    const filtered =
      kind === "all"
        ? RECOMMENDATIONS
        : RECOMMENDATIONS.filter((reco) => reco.kind === kind);
    return seed === 0 ? filtered : shuffle(filtered);
  }, [kind, seed]);

  return (
    <FlatList
      data={list}
      keyExtractor={(reco) => reco.id}
      renderItem={({ item }) => <RecoCard reco={item} />}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.toolbar}>
            <Text style={styles.count}>
              {list.length} reco{list.length > 1 ? "s" : ""}
            </Text>
            <Pressable
              style={styles.shuffle}
              onPress={() => setSeed((n) => n + 1)}
              accessibilityRole="button"
            >
              <Text style={styles.shuffleText}>⇄ Au hasard</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {(["all", ...kinds] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setKind(option as WorkKind | "all")}
                style={[styles.chip, kind === option && styles.chipOn]}
              >
                <Text style={[styles.chipText, kind === option && styles.chipTextOn]}>
                  {option === "all" ? "Tout" : KIND_LABEL[option as WorkKind]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {people.map((guest) => (
              <Link key={guest.name} href={`/invite/${guestSlug(guest.name)}`} asChild>
                <Pressable style={styles.person}>
                  <View style={styles.ring}>
                    <Still episodeId={guest.episodeId} style={styles.faceImage} />
                  </View>
                  <Text style={styles.personName} numberOfLines={1}>
                    {guest.name}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </ScrollView>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, gap: SPACE.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  header: { gap: SPACE.md },

  toolbar: { flexDirection: "row", alignItems: "center" },
  count: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  shuffle: {
    marginLeft: "auto",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  shuffleText: { fontFamily: FONTS.body, fontSize: 12, fontWeight: "600", color: COLORS.text },

  rail: { gap: SPACE.sm, paddingRight: SPACE.lg },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  chipOn: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  chipText: { fontFamily: FONTS.body, fontSize: 12, fontWeight: "600", color: COLORS.muted },
  chipTextOn: { color: COLORS.ground },

  person: { width: 64, alignItems: "center", gap: 6 },
  ring: {
    width: 54,
    height: 54,
    borderRadius: 27,
    padding: 2,
    backgroundColor: COLORS.hairline,
  },
  faceImage: { width: "100%", height: "100%", borderRadius: 25 },
  personName: { fontFamily: FONTS.body, fontSize: 10, fontWeight: "600", color: COLORS.muted },
});
