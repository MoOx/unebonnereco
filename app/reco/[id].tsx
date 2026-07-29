import { Link, Stack, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RECOMMENDATIONS, episodeOf, formatDate, guestSlug, recoById } from "../../ui/catalogue";
import { COLORS, FONTS, KIND_COLOR, KIND_LABEL, SPACE } from "../../ui/theme";
import { Player } from "../../ui/Player";

/** Pre-render one page per recommendation, so every entry has a shareable URL. */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return RECOMMENDATIONS.map((reco) => ({ id: reco.id }));
}

export default function RecoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reco = recoById(id);

  if (!reco) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Cette recommandation n'existe pas.</Text>
        <Link href="/" style={styles.back}>
          Retour au feed
        </Link>
      </View>
    );
  }

  const kind = KIND_COLOR[reco.kind];
  const episode = episodeOf(reco);
  const host = reco.link ? reco.link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: reco.title }} />

      <Player reco={reco} />

      <View style={styles.body}>
        <View>
          <Text style={styles.title}>{reco.title}</Text>
          <Text style={styles.byline}>
            {KIND_LABEL[reco.kind]}
            {reco.creator ? ` · ${reco.creator}` : ""} — recommandé par{" "}
            {reco.recommendedBy && !reco.attributionCued ? "probablement " : ""}
            {reco.recommendedBy ? (
              <Link href={`/invite/${guestSlug(reco.recommendedBy)}`} style={{ color: kind }}>
                {reco.recommendedBy}
              </Link>
            ) : (
              "un invité"
            )}
          </Text>
        </View>

        {reco.link ? (
          <Pressable style={styles.act} onPress={() => Linking.openURL(reco.link!)}>
            <Text style={styles.actText}>↗ Voir la fiche</Text>
            <Text style={styles.actSub}>{host}</Text>
          </Pressable>
        ) : null}

        {reco.transcriptExcerpt ? (
          <Text style={[styles.quote, { borderLeftColor: kind }]}>
            « {reco.transcriptExcerpt} »
          </Text>
        ) : null}

        {reco.description ? <Text style={styles.desc}>{reco.description}</Text> : null}

        <View style={styles.facts}>
          <Fact label="Épisode" value={episode?.title ?? "—"} />
          <Fact label="Diffusé le" value={formatDate(episode?.date)} />
        </View>

        {reco.recommendedBy && !reco.attributionCued ? (
          <Text style={styles.note}>
            <Text style={styles.noteStrong}>Attribution déduite. </Text>
            Personne n'est nommé autour de ce passage : la transcription n'identifie pas
            les voix, donc le locuteur est déduit du fil de la conversation parmi les
            participants de l'épisode.
          </Text>
        ) : null}

        {reco.linkSource !== "reference" ? (
          <Text style={styles.note}>
            <Text style={styles.noteStrong}>Fiche à confirmer. </Text>
            Pas de page de référence fiable trouvée — le titre vient de la transcription
            et peut être approximatif.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { maxWidth: 520, width: "100%", alignSelf: "center", paddingBottom: SPACE.xxl },
  body: { padding: SPACE.lg, gap: SPACE.lg },

  title: {
    fontFamily: FONTS.display,
    fontSize: 38,
    lineHeight: 38,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: -0.5,
    color: COLORS.text,
  },
  byline: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.muted, marginTop: SPACE.sm },

  act: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACE.lg,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  actText: { fontFamily: FONTS.body, fontSize: 15, fontWeight: "600", color: COLORS.text },
  actSub: { marginLeft: "auto", fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted },

  quote: {
    padding: SPACE.lg,
    borderRadius: 13,
    borderLeftWidth: 3,
    backgroundColor: COLORS.surface,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: "italic",
    color: COLORS.muted,
  },
  desc: { fontFamily: FONTS.body, fontSize: 15, lineHeight: 23, color: COLORS.text },

  facts: { borderTopWidth: 1, borderTopColor: COLORS.hairline, paddingTop: SPACE.md },
  fact: { flexDirection: "row", gap: SPACE.lg, paddingVertical: 6 },
  factLabel: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted, width: "34%" },
  factValue: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.text, flex: 1 },

  note: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
    padding: SPACE.md,
    borderRadius: 11,
    backgroundColor: COLORS.surface2,
  },
  noteStrong: { color: COLORS.text, fontWeight: "700" },

  missing: { padding: SPACE.xxl, gap: SPACE.lg, alignItems: "center" },
  missingText: { fontFamily: FONTS.body, fontSize: 15, color: COLORS.muted },
  back: { fontFamily: FONTS.body, fontSize: 15, color: COLORS.text },
});
