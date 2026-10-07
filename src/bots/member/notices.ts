export const CONSENT_SCOPES = ["storage", "storage_and_dm"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const CONSENT_NOTICE = [
  "I am the memory for this community. Before I keep anything about you, read this.",
  "",
  "What I store: what you ask, bugs and feedback you file, facts you tell me about yourself (role, skills, interests, language), thanks you receive, and promises managers make to you.",
  "Where: Walrus Memory on mainnet. Storage there is public and permanent. Your lines are encrypted, and they are filed under a code derived from your Telegram id, never under your id or name.",
  "What I never store: keys, tokens, passwords, emails, phone numbers, addresses. If you paste one I block the message and warn you.",
  "The honest limit: forgetting means I stop indexing your namespace. The blobs already written stay on Walrus. I cannot delete them. Nobody can.",
  "",
  "Tap I agree to let me store, or I agree + DMs if you also want me to message you when a promise to you comes due.",
].join("\n");

export const ALREADY_CONSENTED = "You have already agreed, so I am keeping your community memory. Use /mydata to see everything I hold and /help for the rest.";

export const CONSENT_RECORDED = [
  "Thank you. I will keep your community memory from now on.",
  "/mydata shows everything I hold about you, with the Walrus receipt for each line.",
  "/correct <number> <new value> fixes a line I got wrong.",
].join("\n");

export const DM_CONSENT_RECORDED = `${CONSENT_RECORDED}\nI will also message you here when a promise made to you comes due.`;

export const HELP = [
  "What I can do:",
  "Ask me anything about this community and I answer from what is on record, never from a guess.",
  "Tell me about a bug or a missing feature and I file it, then keep its current status.",
  "Tell me about yourself (your role, a skill, a language) and I remember it.",
  "",
  "Commands:",
  "/start the consent notice",
  "/mydata everything I hold about you, with a Walrus receipt per line",
  "/correct <number> <new value> fix one line",
  "/help this message",
  "",
  "In the group I only answer when you @mention me or use a command, so I do not fill the chat.",
].join("\n");

export const CONSENT_IN_GROUP = "Message me directly and send /start, and I will show you what I store before I keep anything.";

export const SECRET_WARNING = [
  "I did not store that message: it looks like it contains a key, token, email, phone number or something else private.",
  "Walrus storage is permanent, so I block those rather than write them.",
  "If that was a real key or token, rotate it now, then send the message again without it.",
].join("\n");

export function blobLink(blobId: string): string {
  return `https://walruscan.com/mainnet/blob/${blobId}`;
}

export const HELD_FOR_CLASSIFIER = [
  "I have not stored that message yet: the model that reads messages is not answering.",
  "I am holding it in memory and will file it as soon as a model answers.",
  "If I restart before then it is lost, and I will say so rather than pretend it was saved.",
].join("\n");
