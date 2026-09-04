/** Turns a field_key into something readable without inventing wording:
 *  underscores become spaces and nothing else changes. Renaming a field for
 *  display risks describing it as something it is not. */
export function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ')
}
