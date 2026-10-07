const YES_WORDS = ["yes", "yep", "yeah", "yup", "ya", "sure", "thanks", "thank you", "that helped", "it helped", "helpful", "worked", "that worked", "sorted", "perfect", "great"];
const NO_WORDS = [
  "no",
  "nope",
  "nah",
  "not really",
  "didn't help",
  "did not help",
  "doesnt help",
  "does not help",
  "didnt work",
  "did not work",
  "did not answer",
  "didnt answer",
  "didn't answer",
  "does not answer",
  "doesnt answer",
  "not my question",
  "not what i asked",
  "still broken",
  "still not working",
  "that's not it",
  "thats not it",
  "unhelpful",
  "wrong answer",
];

export type FeedbackReading = "helpful" | "unhelpful" | "unclear";

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
}

function mentions(text: string, words: readonly string[]): boolean {
  const padded = ` ${text} `;
  return words.some((word) => padded.includes(` ${word} `) || padded.startsWith(`${word} `) || padded === ` ${word} `);
}

export function readFeedback(text: string): FeedbackReading {
  const cleaned = normalise(text);
  if (cleaned.length === 0 || cleaned.split(" ").length > 12) return "unclear";
  const saysNo = mentions(cleaned, NO_WORDS);
  const saysYes = mentions(cleaned, YES_WORDS);
  if (saysNo && !saysYes) return "unhelpful";
  if (saysYes && !saysNo) return "helpful";
  return "unclear";
}
