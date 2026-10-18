// M9 fix 853: a folder from Explorer's Open in Emerald items: once the
// window is synced, a new layout tab, and in its pane a Claude on the face
// the opens-on pick says, or a shell. With no new tab made, the session
// goes beside the focused pane rather than over it.

export interface FolderOpenDeps {
  synced(): Promise<void>;
  // The new tab's pane, or null when no tab was made (a daemon before tabs).
  newTab(): Promise<{ tabId: string; paneId: string } | null>;
  roomBesideFocused(): Promise<string>;
  startClaudeIn(paneId: string, folder: string, opts: { chat: boolean }): Promise<void>;
  startShellIn(paneId: string, folder: string): Promise<void>;
  opensOn(): 'terminal' | 'chat';
}

export async function openFolder(folder: string, kind: 'claude' | 'shell', deps: FolderOpenDeps): Promise<void> {
  await deps.synced();
  const made = await deps.newTab();
  const paneId = made?.paneId ?? (await deps.roomBesideFocused());
  if (kind === 'claude') await deps.startClaudeIn(paneId, folder, { chat: deps.opensOn() === 'chat' });
  else await deps.startShellIn(paneId, folder);
}
