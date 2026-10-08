export function strippedTelegramText(text: string, botUsername: string): string {
  const handle = botUsername.toLowerCase();
  return text
    .split(/\s+/)
    .filter((word) => word.toLowerCase().replace(/[^a-z0-9_@]/g, "") !== `@${handle}`)
    .join(" ")
    .trim();
}
