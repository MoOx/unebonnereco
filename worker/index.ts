/**
 * The only server this project has: it turns a correction from the site into an issue.
 *
 * The site is a static export on GitHub Pages, so the form has nowhere of its own to
 * post to. This is that somewhere —
 * a single endpoint holding the one secret involved,
 * a token that may open issues on the repository and nothing else.
 *
 * It files rather than applies. Every correction becomes an issue for a person to
 * turn into a pull request and merge, which is what lets the door stay open to
 * strangers: the worst a bad submission can do is add a line to a queue.
 *
 * Deploy: see the README. The token goes in with `wrangler secret put GITHUB_TOKEN`.
 */

type Env = {
  /** Fine-grained token, scoped to this repository, Issues: read and write. */
  GITHUB_TOKEN: string;
  /** `owner/name`. Configured rather than hard-coded so a fork needs no patch. */
  REPO: string;
  /** Origin allowed to post here — the site, and nothing else. */
  SITE_ORIGIN: string;
};

/** What the form sends. Anything else is refused before GitHub is touched. */
type Submission = {
  id: string;
  page?: string;
  overrides?: Record<string, unknown>;
  review?: { status: string; reason?: string };
  note?: string;
  by?: string;
};

/**
 * Ids are `<youtube id>-<two digits>`, and YouTube ids can start with a dash.
 *
 * Checked here so an obviously fabricated id never becomes an issue. Whether the id
 * exists is settled later, by the validator, against the actual catalogue — this
 * worker deliberately holds no copy of the data.
 */
const ID = /^[A-Za-z0-9_-]{11}-\d{2}$/;

/** Enough for a long correction, small enough that nobody files a novel. */
const MAX_BYTES = 8_000;
const MAX_NOTE = 2_000;

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "cache-control": "no-store",
    },
  });

/**
 * The issue body, laid out the way GitHub renders the issue form.
 *
 * Same headings either way, so whatever reads these issues later reads one shape
 * whether the correction came through the form on the site or was filed by hand from
 * `.github/ISSUE_TEMPLATE/correction.yml`.
 */
function issueBody(submission: Submission): string {
  const { page, note, ...patch } = submission;
  return [
    "### Identifiant de la fiche",
    "",
    submission.id,
    "",
    "### La fiche concernée",
    "",
    page ?? "—",
    "",
    "### La correction",
    "",
    "```json",
    JSON.stringify(patch, null, 2),
    "```",
    "",
    "### Un mot pour expliquer",
    "",
    note?.trim() || "—",
    "",
    "---",
    "",
    "_Proposé depuis le site. Rien n'est appliqué tant que personne n'a relu._",
  ].join("\n");
}

function problemWith(submission: Submission): string | null {
  if (!ID.test(submission.id)) return "identifiant de fiche invalide";
  if (!submission.overrides && !submission.review) return "correction vide";
  if (submission.review && submission.review.status !== "rejected") {
    return "verdict non reconnu";
  }
  // A rejection has to say why: the entry disappears from the catalogue, and the
  // person merging it has nothing else to go on.
  if (submission.review && !submission.note?.trim()) return "un retrait doit être motivé";
  if ((submission.note?.length ?? 0) > MAX_NOTE) return "explication trop longue";
  if (submission.overrides && Object.keys(submission.overrides).length > 20) {
    return "trop de champs corrigés d'un coup";
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.SITE_ORIGIN;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ error: "POST attendu" }, 405, origin);
    }

    // The site is the only caller. This stops a page elsewhere from posting in a
    // reader's name; it stops nothing scripted, which is what the review before
    // merging is for.
    if (request.headers.get("origin") !== origin) {
      return json({ error: "origine non autorisée" }, 403, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BYTES) {
      return json({ error: "envoi trop volumineux" }, 413, origin);
    }

    let submission: Submission;
    try {
      submission = JSON.parse(raw) as Submission;
    } catch {
      return json({ error: "JSON illisible" }, 400, origin);
    }

    const problem = problemWith(submission);
    if (problem) return json({ error: problem }, 422, origin);

    const title = submission.review
      ? `Fiche à retirer : ${submission.id}`
      : `Correction : ${submission.id}`;

    const created = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        // GitHub refuses an API call without one.
        "user-agent": "unebonnereco-corrections",
      },
      body: JSON.stringify({
        title,
        body: issueBody(submission),
        labels: ["correction"],
      }),
    });

    if (!created.ok) {
      // The reason stays in the logs: it is about the token or the repository, and
      // the reader can do nothing with it except fall back to mail.
      console.error("github refused", created.status, await created.text());
      return json({ error: "dépôt injoignable" }, 502, origin);
    }

    const issue = (await created.json()) as { html_url: string };
    return json({ url: issue.html_url }, 201, origin);
  },
};
