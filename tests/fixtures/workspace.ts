// Fixture-model replies for workspace prompts, used by the browser acceptance
// server and unit tests through referenceReply. Owned by the workspace area.
// Return undefined for prompts this area does not handle.
export function workspaceReply(_system: string, _context: any): unknown {
  return undefined;
}
