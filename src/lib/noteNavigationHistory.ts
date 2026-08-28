const maximumTrackedJumps = 24;

export interface PreviousNoteJump {
  historyIndex: number;
  route: string;
}

export function addNoteJump(history: string[], route: string) {
  if (history.at(-1) === route) return history;
  return [...history, route].slice(-maximumTrackedJumps);
}

export function getPreviousNoteJumps(
  history: string[],
  maximumResults = 8,
): PreviousNoteJump[] {
  const previousJumps: PreviousNoteJump[] = [];
  const seenRoutes = new Set<string>();

  for (let index = history.length - 2; index >= 0; index -= 1) {
    const route = history[index];
    if (seenRoutes.has(route)) continue;

    previousJumps.push({ historyIndex: index, route });
    seenRoutes.add(route);
    if (previousJumps.length === maximumResults) break;
  }

  return previousJumps;
}
