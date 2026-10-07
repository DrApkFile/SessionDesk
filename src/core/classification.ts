import { z } from "zod";
import { MAX_THEME_LABEL_CHARS } from "./tuning.js";
import { MESSAGE_KINDS, PROFILE_FIELDS } from "./vocabulary.js";

export const ClassificationSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    themeLabel: z.string().min(1).max(MAX_THEME_LABEL_CHARS).optional(),
    profile: z.object({ field: z.enum(PROFILE_FIELDS), value: z.string().min(1).max(120) }).strict().optional(),
  })
  .strict();

export type Classification = z.infer<typeof ClassificationSchema>;

export const UNCLASSIFIED: Classification = { kind: "other" };

export interface ClassificationReading {
  readonly classification: Classification;
  readonly wellFormed: boolean;
  readonly problems: readonly string[];
}

export function readClassification(payload: unknown): ClassificationReading {
  const parsed = ClassificationSchema.safeParse(payload);
  if (parsed.success) return { classification: parsed.data, wellFormed: true, problems: [] };
  return {
    classification: UNCLASSIFIED,
    wellFormed: false,
    problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

export function readClassificationJson(raw: string): ClassificationReading {
  try {
    return readClassification(JSON.parse(raw) as unknown);
  } catch {
    return { classification: UNCLASSIFIED, wellFormed: false, problems: ["not JSON"] };
  }
}
