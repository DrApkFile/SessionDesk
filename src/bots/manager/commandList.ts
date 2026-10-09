export interface ManagerCommandSpec {
  readonly name: string;
  readonly description: string;
  readonly argsHint: string | null;
}

export const MANAGER_COMMANDS: readonly ManagerCommandSpec[] = [
  { name: "owed", description: "Open promises, overdue first", argsHint: null },
  { name: "themes", description: "What people are raising this week, open items first", argsHint: "nothing, or a page number, or all, or all and a page number" },
  { name: "helpers", description: "Who has contribution points", argsHint: null },
  { name: "member", description: "What I hold about one member", argsHint: "a name, a member code, or nothing when replying" },
  { name: "ack", description: "Tell a member the team has picked something up", argsHint: "the item id" },
  { name: "fixed", description: "Mark something fixed", argsHint: "the item id" },
  { name: "verify", description: "Confirm a fix was checked", argsHint: "the item id" },
  { name: "reopen", description: "Reopen something that was marked fixed", argsHint: "the item id" },
  { name: "duplicate", description: "Close something as already known", argsHint: "the item id" },
  { name: "wontfix", description: "Close something that will not be changed", argsHint: "the item id" },
  { name: "promise", description: "Promise something to a member by a date", argsHint: "item id or name, then YYYY-MM-DD, then what you promise" },
  { name: "done", description: "Mark a promise kept", argsHint: "the promise id" },
  { name: "note", description: "A manager-only note, on a separate account", argsHint: "the note text" },
  { name: "notes", description: "Read the manager-only notes back", argsHint: null },
  { name: "answers", description: "Every answer the community has on record", argsHint: null },
  { name: "retire", description: "Stop an answer being reused", argsHint: "the answer id" },
  { name: "confirm", description: "Allow an answer to be reused", argsHint: "the answer id" },
  { name: "ambassador", description: "Make a member an ambassador", argsHint: "a name or member code" },
  { name: "unambassador", description: "Remove an ambassador badge", argsHint: "a name or member code" },
  { name: "report", description: "A weekly draft written from counted data", argsHint: null },
  { name: "status", description: "Memory, queue, budget and sequence", argsHint: null },
  { name: "claim", description: "Become the owner of this SessionDesk, once", argsHint: "the setup code from the startup log" },
  { name: "addmanager", description: "Let someone else run manager commands", argsHint: "a user id, or reply to their message" },
  { name: "removemanager", description: "Stop someone running manager commands", argsHint: "a user id, or reply to their message" },
  { name: "setup", description: "Use the group this is sent in as the community", argsHint: null },
];

export function commandNames(): readonly string[] {
  return MANAGER_COMMANDS.map((command) => command.name);
}

export function textForCommand(name: string, args: string): string {
  const trimmed = args.trim();
  return trimmed.length === 0 ? `/${name}` : `/${name} ${trimmed}`;
}
