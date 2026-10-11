// Fixture-model replies for pipelines prompts, used by the browser acceptance
// server and unit tests through referenceReply. Owned by the pipelines area.
// Return undefined for prompts this area does not handle.
export function pipelinesReply(_system: string, _context: any): unknown {
  return undefined;
}
