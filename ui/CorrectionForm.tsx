import { useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { WORK_KINDS, type Recommendation, type WorkKind } from "../src/types";
import { RECOMMENDATIONS, episodeOf, hms } from "./catalogue";
import {
  SUBMIT_URL,
  contributionOf,
  isEmpty,
  mailtoUrl,
  serialise,
  submitCorrection,
  type Draft,
} from "./contribute";
import { COLORS, FONTS, KIND_COLOR, KIND_LABEL, SPACE } from "./theme";

/**
 * The correction a reader is drafting, on the page of the entry it corrects.
 *
 * The catalogue is machine-made and wrong in places — 81% of its attributions are a
 * model's inference and 63% of its entries have no verified reference page. Nobody
 * fixes that at scale except the people who listened to the episode, and they will
 * not clone a repository to do it. So the form is on the page, pre-filled with what
 * the entry currently says, and sending it takes one press — no account, no
 * repository, and a pre-filled mail as the route when the endpoint cannot be reached.
 *
 * Nothing it sends is applied on its own. Every route out of here lands in front of a
 * person who decides whether to merge it, which is the only reason it can afford to
 * take corrections from strangers.
 */
export function CorrectionForm({
  reco,
  draft,
  onChange,
}: {
  reco: Recommendation;
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [rejected, setRejected] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState("");
  const [failure, setFailure] = useState("");

  /**
   * Who was in the room, offered as one tap each.
   *
   * Attribution is the correction most worth making and the most tedious to type, and
   * the answer is nearly always one of the handful of names already on this episode.
   */
  const speakers = useMemo(
    () => [
      ...new Set(
        RECOMMENDATIONS.filter((other) => other.episodeId === reco.episodeId)
          .map((other) => other.recommendedBy)
          .filter(Boolean),
      ),
    ],
    [reco.episodeId],
  );

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    onChange({ ...draft, [field]: value });

  const contribution = contributionOf(reco, draft, { note, by, rejected });
  const nothingToSend = isEmpty(contribution);
  // The validator refuses a rejection without a reason, so the form does too rather
  // than letting someone find that out from a failed check on their pull request.
  const missingReason = rejected && !note.trim();
  const blocked = nothingToSend || missingReason || sending;

  const send = async () => {
    setSending(true);
    setFailure("");
    try {
      setSent(await submitCorrection(reco, contribution));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "envoi impossible");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Pressable
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
      >
        <Text style={styles.triggerText}>✎ Proposer une correction</Text>
        <Text style={styles.triggerSub}>
          {reco.corrected ? "déjà corrigée une fois" : "en 30 secondes"}
        </Text>
      </Pressable>
    );
  }

  if (sent) {
    return (
      <View style={styles.form}>
        <Text style={styles.thanksTitle}>Merci — c'est parti.</Text>
        <Text style={styles.legend}>
          La proposition est enregistrée telle quelle. Quelqu'un la relit, et la fiche
          se met à jour une fois la correction acceptée.
        </Text>
        <Pressable onPress={() => Linking.openURL(sent)} accessibilityRole="link">
          <Text style={styles.disclose}>▸ Suivre la proposition</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.legend}>
        Ce que la machine a compris, à corriger. Ne touche que ce qui est faux : le
        reste continuera de s'améliorer tout seul.
      </Text>

      {/* First, because it is the answer that makes every other field pointless. */}
      <Toggle
        label="Ce n'est pas une recommandation"
        hint="Doublon, contresens, ou passage qui n'en est pas un. La fiche sortira du catalogue."
        value={rejected}
        onValueChange={setRejected}
      />

      {rejected ? null : (
        <>
          <Field
            label="Titre"
            value={draft.title}
            onChangeText={(value) => set("title", value)}
          />
          <Field
            label="Auteur, réalisateur, groupe…"
            value={draft.creator}
            onChangeText={(value) => set("creator", value)}
          />

          <Group label="Type">
            <View style={styles.chips}>
              {WORK_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  label={KIND_LABEL[kind]}
                  active={draft.kind === kind}
                  color={KIND_COLOR[kind]}
                  onPress={() => set("kind", kind as WorkKind)}
                />
              ))}
            </View>
          </Group>

          <Group label="Recommandé par">
            <View style={styles.chips}>
              {speakers.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  active={draft.recommendedBy === name}
                  onPress={() => set("recommendedBy", name)}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={draft.recommendedBy}
              onChangeText={(value) => set("recommendedBy", value)}
              placeholder="ou un autre nom"
              placeholderTextColor={COLORS.muted}
            />
            <Toggle
              label="Le nom est dit dans l'épisode"
              hint="Sinon la fiche continuera d'afficher « probablement »."
              value={Boolean(draft.attributionCued)}
              onValueChange={(value) => set("attributionCued", value)}
            />
          </Group>

          <Field
            label="Lien vers la fiche de l'œuvre"
            value={draft.link ?? ""}
            onChangeText={(value) => set("link", value)}
            placeholder="https://…"
          />

          <Trim reco={reco} draft={draft} onChange={onChange} />
        </>
      )}

      <Field
        label={rejected ? "Pourquoi (obligatoire)" : "Un mot pour expliquer"}
        value={note}
        onChangeText={setNote}
        placeholder="ce que tu as entendu, où tu l'as vérifié…"
        multiline
      />
      <Field
        label="Ton nom, si tu veux être crédité"
        value={by}
        onChangeText={setBy}
        placeholder="facultatif"
      />

      <Pressable onPress={() => setShowPayload(!showPayload)}>
        <Text style={styles.disclose}>
          {showPayload ? "▾" : "▸"} Ce qui sera envoyé
          {nothingToSend ? " — rien pour l'instant" : ""}
        </Text>
      </Pressable>
      {showPayload && !nothingToSend ? (
        <Text style={styles.payload}>{serialise(contribution)}</Text>
      ) : null}

      <View style={styles.actions}>
        {SUBMIT_URL && !failure ? (
          <Pressable
            style={[styles.send, blocked && styles.sendOff]}
            disabled={blocked}
            onPress={send}
            accessibilityRole="button"
          >
            <Text style={styles.sendText}>
              {sending ? "Envoi…" : "Envoyer la correction"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.send, blocked && styles.sendOff]}
            disabled={blocked}
            onPress={() => Linking.openURL(mailtoUrl(reco, contribution))}
            accessibilityRole="button"
          >
            <Text style={styles.sendText}>Envoyer par mail</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.footnote}>
        {failure
          ? `L'envoi n'est pas passé (${failure}). Le mail arrive au même endroit.`
          : missingReason
            ? "Il manque la raison du retrait."
            : nothingToSend
              ? "Rien n'a changé pour l'instant."
              : "Rien n'est publié automatiquement : quelqu'un relit avant."}
      </Text>

      <Pressable onPress={() => setOpen(false)}>
        <Text style={styles.close}>Fermer</Text>
      </Pressable>
    </View>
  );
}

/**
 * The bounds of the passage, to the second.
 *
 * Steppers rather than a slider: the useful correction here is "it starts four
 * seconds too late", and a drag handle over a 90-second clip cannot express that on a
 * phone. The player above follows every press, so the adjustment is heard rather than
 * guessed.
 */
function Trim({
  reco,
  draft,
  onChange,
}: {
  reco: Recommendation;
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  // Same floor and ceiling the validator enforces, so nothing built here can fail it.
  const MIN_S = 5;
  const MAX_S = 600;
  const episodeEnd = episodeOf(reco)?.durationS ?? Number.MAX_SAFE_INTEGER;
  const length = draft.clipEndS - draft.clipStartS;

  const moveStart = (delta: number) =>
    onChange({
      ...draft,
      clipStartS: Math.min(
        Math.max(0, draft.clipStartS + delta),
        draft.clipEndS - MIN_S,
      ),
    });

  const moveEnd = (delta: number) =>
    onChange({
      ...draft,
      clipEndS: Math.min(
        Math.max(draft.clipStartS + MIN_S, draft.clipEndS + delta),
        Math.min(draft.clipStartS + MAX_S, episodeEnd),
      ),
    });

  return (
    <Group label="Le passage">
      <View style={styles.trimRow}>
        <Text style={styles.trimLabel}>Début</Text>
        <Text style={styles.trimValue}>{hms(draft.clipStartS)}</Text>
        {[-5, -1, 1, 5].map((delta) => (
          <Step key={delta} delta={delta} onPress={() => moveStart(delta)} />
        ))}
      </View>
      <View style={styles.trimRow}>
        <Text style={styles.trimLabel}>Fin</Text>
        <Text style={styles.trimValue}>{hms(draft.clipEndS)}</Text>
        {[-5, -1, 1, 5].map((delta) => (
          <Step key={delta} delta={delta} onPress={() => moveEnd(delta)} />
        ))}
      </View>
      <Text style={styles.hint}>
        {length} s — le lecteur en haut de la page joue déjà l'extrait ajusté.
      </Text>
    </Group>
  );
}

function Step({ delta, onPress }: { delta: number; onPress: () => void }) {
  const label = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  return (
    <Pressable
      style={styles.step}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? "avancer" : "reculer"} de ${Math.abs(delta)} secondes`}
    >
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <Group label={label}>
      <TextInput
        style={[styles.input, multiline && styles.inputTall]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={multiline}
      />
    </Group>
  );
}

function Chip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.chip,
        active && { backgroundColor: color ?? COLORS.text, borderColor: color ?? COLORS.text },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: COLORS.text, false: COLORS.hairline }}
        thumbColor={COLORS.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACE.lg,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.hairline,
  },
  triggerText: { fontFamily: FONTS.body, fontSize: 15, fontWeight: "600", color: COLORS.text },
  triggerSub: { marginLeft: "auto", fontFamily: FONTS.body, fontSize: 12, color: COLORS.muted },

  form: {
    gap: SPACE.lg,
    padding: SPACE.lg,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  legend: { fontFamily: FONTS.body, fontSize: 13, lineHeight: 19, color: COLORS.muted },
  thanksTitle: {
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "800",
    textTransform: "uppercase",
    color: COLORS.text,
  },

  group: { gap: SPACE.sm },
  label: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  hint: { fontFamily: FONTS.body, fontSize: 12, lineHeight: 17, color: COLORS.muted },

  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.surface2,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  inputTall: { minHeight: 72, textAlignVertical: "top" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  chip: {
    paddingHorizontal: SPACE.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface2,
  },
  chipText: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.text },
  chipTextOn: { color: COLORS.onKind, fontWeight: "700" },

  toggle: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.text },

  trimRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  trimLabel: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted, width: 44 },
  trimValue: { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text, width: 64 },
  step: {
    minWidth: 34,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  stepText: { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text },

  disclose: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted },
  payload: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
    backgroundColor: COLORS.ground,
    borderRadius: 9,
    padding: SPACE.md,
  },

  actions: { flexDirection: "row", gap: SPACE.sm },
  send: {
    flex: 1,
    paddingVertical: SPACE.md,
    borderRadius: 11,
    alignItems: "center",
    backgroundColor: COLORS.text,
  },
  sendText: { fontFamily: FONTS.body, fontSize: 14, fontWeight: "700", color: COLORS.ground },
  sendAlt: {
    flex: 1,
    paddingVertical: SPACE.md,
    borderRadius: 11,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface2,
  },
  sendAltText: { fontFamily: FONTS.body, fontSize: 14, fontWeight: "600", color: COLORS.text },
  sendOff: { opacity: 0.4 },

  footnote: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.muted, textAlign: "center" },
  close: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted, textAlign: "center" },
});
