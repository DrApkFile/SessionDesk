import { collapseWhitespace } from "./text.js";

export const ABOUT_OTHERS_REFUSAL = "I don't share details about other members. I can tell you what the community has raised, and what I hold about you.";

const PERSONAL_WORDS = [
  "profile",
  "skills",
  "skill",
  "role",
  "job",
  "works as",
  "language",
  "languages",
  "points",
  "tier",
  "ambassador",
  "email",
  "phone",
  "number",
  "promised",
  "promise",
  "notes",
  "note",
  "reported",
  "asked",
  "said",
  "tell me about",
  "who is",
  "what does",
];

export interface OtherPeopleQuestion {
  readonly asksAboutSomeoneElse: boolean;
  readonly handles: readonly string[];
}

export function handlesIn(text: string, selfHandles: readonly string[]): readonly string[] {
  const lowered = selfHandles.map((handle) => handle.toLowerCase().replace(/^@/, ""));
  const found = text.match(/@[A-Za-z0-9_]{2,32}/g) ?? [];
  return [...new Set(found.map((handle) => handle.slice(1)))].filter((handle) => !lowered.includes(handle.toLowerCase()));
}

export function asksAboutAnotherMember(text: string, selfHandles: readonly string[], knownNames: readonly string[]): OtherPeopleQuestion {
  const handles = handlesIn(text, selfHandles);
  const lowered = collapseWhitespace(text).toLowerCase();
  const namedSomeone = knownNames.some((name) => name.length >= 3 && lowered.includes(name.toLowerCase()));
  if (handles.length === 0 && !namedSomeone) return { asksAboutSomeoneElse: false, handles: [] };
  const personal = PERSONAL_WORDS.some((word) => lowered.includes(word));
  return { asksAboutSomeoneElse: personal, handles };
}
