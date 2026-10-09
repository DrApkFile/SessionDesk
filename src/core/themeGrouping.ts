import { z } from "zod";
import { refuse, ok, type Result } from "./result.js";
import { THEME_TOPICS_MAX } from "./tuning.js";

export const groupingSchema = z
  .object({
    topics: z
      .array(
        z
          .object({
            title: z.string().min(2).max(60),
            themeLabels: z.array(z.string().min(1).max(60)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(THEME_TOPICS_MAX),
  })
  .strict();

export type Grouping = z.infer<typeof groupingSchema>;

export interface GroupedTheme {
  readonly label: string;
  readonly itemIds: readonly string[];
}

export interface Topic {
  readonly title: string;
  readonly themes: readonly GroupedTheme[];
}

function normalised(label: string): string {
  return label.trim().toLowerCase();
}

export function readGroupingJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function verifiedGrouping(proposal: unknown, themes: readonly GroupedTheme[]): Result<readonly Topic[]> {
  const parsed = groupingSchema.safeParse(proposal);
  if (!parsed.success) return refuse("MODEL_OUTPUT_REFUSED", `grouping did not parse: ${parsed.error.issues[0]?.message ?? "unknown"}`);

  const byLabel = new Map(themes.map((theme) => [normalised(theme.label), theme]));
  const wantedItems = new Set(themes.flatMap((theme) => theme.itemIds));
  const placed = new Set<string>();
  const seenItems = new Set<string>();
  const topics: Topic[] = [];

  for (const topic of parsed.data.topics) {
    const grouped: GroupedTheme[] = [];
    for (const label of topic.themeLabels) {
      const key = normalised(label);
      const theme = byLabel.get(key);
      if (theme === undefined) return refuse("MODEL_OUTPUT_REFUSED", `grouping invented the theme ${label}`);
      if (placed.has(key)) return refuse("MODEL_OUTPUT_REFUSED", `grouping put ${label} in two topics`);
      placed.add(key);
      for (const itemId of theme.itemIds) {
        if (seenItems.has(itemId)) return refuse("MODEL_OUTPUT_REFUSED", `grouping counted ${itemId} twice`);
        seenItems.add(itemId);
      }
      grouped.push(theme);
    }
    topics.push({ title: topic.title.trim(), themes: grouped });
  }

  if (placed.size !== byLabel.size) return refuse("MODEL_OUTPUT_REFUSED", `grouping dropped ${byLabel.size - placed.size} theme(s)`);
  if (seenItems.size !== wantedItems.size) return refuse("MODEL_OUTPUT_REFUSED", `grouping covers ${seenItems.size} items, not ${wantedItems.size}`);
  for (const itemId of wantedItems) if (!seenItems.has(itemId)) return refuse("MODEL_OUTPUT_REFUSED", `grouping dropped ${itemId}`);
  return ok(topics);
}
