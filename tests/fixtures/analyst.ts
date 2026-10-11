// Fixture-model replies for analyst prompts, used by the browser acceptance
// server and unit tests through referenceReply. Owned by the analyst area.
// Return undefined for prompts this area does not handle.
export function analystReply(_system: string, _context: any): unknown {
  return undefined;
}
