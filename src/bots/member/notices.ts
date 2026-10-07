import { walruscanBlobUrl } from "../../evidence/links.js";

export const CONSENT_SCOPES = ["storage", "storage_and_dm"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const DM_START_PAYLOAD = "dm";

export function dmStartLink(botUsername: string): string {
  return `https://t.me/${botUsername}?start=${DM_START_PAYLOAD}`;
}

export function blobLink(blobId: string): string {
  return walruscanBlobUrl(blobId);
}

export const CONSENT_NOTICE = [
  "I am this community's memory. Before I keep anything about you, here is the deal.",
  "",
  "I remember what you ask, problems and ideas you raise, what you tell me about yourself, thanks you get, and promises managers make you. It is kept encrypted on Walrus, a public network, and it is permanent: I can stop looking at your memory, but a single memory cannot be deleted once written, by me or by anyone.",
  "Never share a key, password, phone number or email here. If you do, I block the message and warn you instead of saving it.",
  "",
  "Tap I agree, or I agree + DMs if you also want me to message you when a promise to you is due. Either way you can type /mydata to me any time to see everything I remember, or /help for what else I can do.",
].join("\n");

export const ALREADY_CONSENTED = "You are already in. Type /mydata to see everything I remember about you, or /help for what else I can do.";

export const CONSENT_RECORDED = [
  "You're in, thank you. From now on I remember what you raise and ask.",
  "Type /mydata any time to see everything I hold, with a receipt for each line.",
].join("\n");

export const DM_CONSENT_RECORDED = `${CONSENT_RECORDED}\nI will also message you here when a promise to you is due.`;

export const HELP = [
  "Ask me anything about this community and I answer from what I actually have on record, never from a guess.",
  "Tell me about a problem or an idea and I pass it to the team and keep track of what happens to it.",
  "Tell me about yourself and I remember it, so nobody has to ask twice.",
  "",
  "/mydata everything I remember about you, with a receipt for each line",
  "/correct 3 new wording   fix line 3 of what /mydata shows",
  "/help this message",
  "",
  "In the group I only answer when you @mention me, so I do not fill the chat.",
].join("\n");

export const CONSENT_IN_GROUP = "Message me here and send /start, and I will show you what I keep before I keep anything.";

export const SECRET_WARNING = [
  "I did not save that message: it looks like it has something private in it, like a key, a password, a phone number or an email.",
  "Walrus storage is permanent, so I block those rather than write them down.",
  "If that was a real key or password, change it now, then send me the message without it.",
].join("\n");

export const HELD_FOR_CLASSIFIER = [
  "I have not saved that one yet: my AI is not answering right now.",
  "I am holding your message and will file it as soon as it comes back.",
  "If I restart before then it is lost, and I will tell you rather than pretend it was saved.",
].join("\n");

export const GROUP_OPTIN_NOTICE = [
  "I am this community's memory. Tap below if you want me to remember you.",
  "",
  "I remember what you ask, problems and ideas you raise, what you tell me about yourself, thanks you get, and promises managers make you. It is kept encrypted on Walrus, a public network, and it is permanent: a single memory cannot be deleted once written, by me or by anyone.",
  "Never share a key, password, phone number or email here. If you do, I block the message and warn you.",
  "",
  "Once you are in, type /mydata to me and you will see everything I remember, with a receipt for each line.",
].join("\n");

export const GROUP_OPTIN_PROMPT = [
  "I do not keep anything about you until you say yes. Tap below and I will start remembering.",
  "Walrus storage is permanent: I can stop looking at your memory, but a single memory cannot be deleted once written.",
].join("\n");

export function tapWelcome(botUsername: string): string {
  return `You're in. Type /mydata to @${botUsername} anytime.`;
}

export const TAP_ALREADY = "You're already in.";

export function tapNeedsDmStart(botUsername: string): string {
  return `You're in. For messages from me, open @${botUsername} and press Start, then I can tell you when a promise to you is due.`;
}

export const NOTHING_HELD = "I do not hold anything about you yet. Say yes above, then talk to me and I will keep track.";

export const MYDATA_FOOTER = "If I stop looking at your memory, the lines above stay on Walrus. Nobody can delete them, including me.";

export const CORRECT_USAGE = "To fix something, type /correct and the line number from /mydata, then the new wording. For example: /correct 3 I am a designer.";

export function correctUnknownLine(position: number): string {
  return `I do not have a line ${position} for you, so nothing changed. Type /mydata to see the numbers.`;
}

export const CORRECT_NOT_POSSIBLE = "That line is not one you can change, so nothing changed. You can fix something you told me about yourself, or the wording of something you raised.";

export function correctDone(value: string): string {
  return `Done, I have it as "${value}" now. It takes a moment to save; check /mydata in a minute for the receipt.`;
}

export const FEEDBACK_NOT_HELPFUL = "Thanks, I've passed your question to the team.";
export const FEEDBACK_HELPFUL = "Good, thanks for telling me. I will keep using that answer.";
