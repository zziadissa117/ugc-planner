/** Turns a field_key into something readable without inventing wording:
 *  underscores become spaces and nothing else changes. Renaming a field for
 *  display risks describing it as something it is not. */
export function fieldLabel(key: string): string {
  // "cents" is the storage unit, and every money field is shown in dollars,
  // so it is the one word dropped: "pay per video", not "pay per video cents".
  return key.replace(/_cents$/, '').replace(/_/g, ' ')
}
