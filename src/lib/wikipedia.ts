import { getJson } from "./http.ts";

export type WikiCandidate = { page: string; snippet: string };

type SearchResponse = {
  query?: { search?: { title: string; snippet: string }[] };
};

type SummaryResponse = {
  type?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

/** Full-text search, returning page titles a judge can pick from. */
export async function search(
  query: string,
  { lang = "fr", limit = 8 } = {},
): Promise<WikiCandidate[]> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json`;
  const body = await getJson<SearchResponse>(url);
  return (body.query?.search ?? []).map((hit) => ({
    page: hit.title,
    snippet: hit.snippet.replace(/<[^>]+>/g, ""),
  }));
}

/** Fetch a page summary. Null for a disambiguation page — never a real answer. */
export async function summary(
  page: string,
  lang = "fr",
): Promise<{ description: string; link: string } | null> {
  const url =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
    encodeURIComponent(page.replace(/ /g, "_"));
  const body = await getJson<SummaryResponse>(url);
  if (body.type === "disambiguation") return null;
  const link = body.content_urls?.desktop?.page;
  if (!link) return null;
  return { description: body.extract ?? "", link };
}

export function searchUrl(query: string, lang = "fr"): string {
  return `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}
