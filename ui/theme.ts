import { Platform } from "react-native";

import type { WorkKind } from "../src/types";

/**
 * One saturated colour per kind of work.
 *
 * This is the identity rather than a single accent: it makes an entry legible at a
 * glance while scrolling, and it means a card without a poster still looks deliberate.
 */
export const KIND_COLOR: Record<WorkKind, string> = {
  film: "#FF4E64",
  series: "#8B6BFF",
  book: "#3DBE8B",
  comic: "#F2705C",
  podcast: "#FFB020",
  game: "#00C2D1",
  show: "#FF7A2F",
  music: "#FF3D91",
  youtube_channel: "#FF3D71",
  documentary: "#5B8DEF",
  restaurant: "#C7B23F",
  other: "#7E8F8B",
};

export const KIND_LABEL: Record<WorkKind, string> = {
  film: "Film",
  series: "Série",
  book: "Livre",
  comic: "BD",
  podcast: "Podcast",
  game: "Jeu",
  show: "Spectacle",
  music: "Musique",
  youtube_channel: "YouTube",
  documentary: "Docu",
  restaurant: "Resto",
  other: "Autre",
};

/** Neutrals biased towards the page's blue-green, so nothing reads as default grey. */
export const COLORS = {
  ground: "#0F1416",
  surface: "#171F22",
  surface2: "#1F292C",
  text: "#E8EEEC",
  muted: "#7E8F8B",
  hairline: "#263134",
  onKind: "#0B0F10",
};

/**
 * Condensed display type is available on Apple platforms, which is what this is
 * mostly read on; the stack degrades to a normal grotesque elsewhere rather than
 * silently swapping to something unrelated.
 */
export const FONTS = {
  display: Platform.select({
    web: '"Avenir Next Condensed", "Helvetica Neue", system-ui, sans-serif',
    default: "Avenir Next Condensed",
  }),
  body: Platform.select({
    web: '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif',
    default: "System",
  }),
  mono: Platform.select({
    web: 'ui-monospace, "SF Mono", Menlo, monospace',
    default: "Menlo",
  }),
};

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
