// Fixture-model replies for ontology prompts, used by the browser acceptance
// server and unit tests through referenceReply. Owned by the ontology area.
// Return undefined for prompts this area does not handle.
export function ontologyReply(_system: string, _context: any): unknown {
  return undefined;
}
