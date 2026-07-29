import { Link, Stack, useLocalSearchParams } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { RecoCard } from "../../ui/RecoCard";
import { byGuest, guestFromSlug, guestSlug, guests } from "../../ui/catalogue";
import { Still } from "../../ui/Still";
import { COLORS, FONTS, SPACE } from "../../ui/theme";

/** Pre-render one page per guest, so "toutes les recos d'Orelsan" is a shareable link. */
export async function generateStaticParams(): Promise<{ name: string }[]> {
  return guests().map((guest) => ({ name: guestSlug(guest.name) }));
}

export default function GuestPage() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const guest = guestFromSlug(name);
  const list = guest ? byGuest(guest) : [];

  if (!guest) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Cet invité n'existe pas.</Text>
        <Link href="/" style={styles.back}>
          Retour au feed
        </Link>
      </View>
    );
  }

  return (
    <FlatList
      data={list}
      keyExtractor={(reco) => reco.id}
      renderItem={({ item }) => <RecoCard reco={item} />}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.hero}>
          <Stack.Screen options={{ title: guest }} />
          <Still episodeId={list[0]!.episodeId} style={styles.face} />
          <View style={styles.heroText}>
            <Text style={styles.name}>{guest}</Text>
            <Text style={styles.count}>
              {list.length} recommandation{list.length > 1 ? "s" : ""}
            </Text>
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, gap: SPACE.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  hero: { flexDirection: "row", alignItems: "center", gap: SPACE.lg, paddingBottom: SPACE.sm },
  face: { width: 68, height: 68, borderRadius: 34 },
  heroText: { flex: 1, gap: 2 },
  name: {
    fontFamily: FONTS.display,
    fontSize: 30,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: -0.5,
    color: COLORS.text,
  },
  count: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted },

  missing: { padding: SPACE.xxl, gap: SPACE.lg, alignItems: "center" },
  missingText: { fontFamily: FONTS.body, fontSize: 15, color: COLORS.muted },
  back: { fontFamily: FONTS.body, fontSize: 15, color: COLORS.text },
});
