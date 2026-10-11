// Fixture-model replies for data prompts, used by the browser acceptance
// server and unit tests through referenceReply. Owned by the data area.
// Return undefined for prompts this area does not handle.
export function dataReply(_system: string, _context: any): unknown {
  return undefined;
}
