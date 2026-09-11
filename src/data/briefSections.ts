// Pulling one section out of the brief he pasted in whole.
//
// He writes the campaign's working brief once - product, audience, voice,
// formats, hook banks, talking points - and pastes the lot into one box. It
// goes to the hook generator verbatim. The app should not then ask him to copy
// a part of it into a second field by hand: the document already says it.
//
// Deliberately dumb about markdown. It finds a heading by name, takes the
// lines under it until the next heading, and strips list markers. It does not
// try to understand the document, because the one thing it must never do is
// invent a talking point he did not write.

/** Lines under the first heading whose text contains `name`, or [] if the
 *  document has no such heading.
 *
 *  Any heading level, since he may write `## TALKING POINTS` or `# Talking
 *  points`, and case-insensitive for the same reason. A bare bold line
 *  ("**TALKING POINTS**") counts too - it is a heading to a reader. */
export function sectionLines(markdown: string | null, name: string): string[] {
  if (markdown === null || markdown.trim() === '') return []

  const wanted = name.trim().toLowerCase()
  const lines = markdown.split('\n')

  const headingText = (line: string): string | null => {
    const hash = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)
    if (hash) return hash[1].trim()
    const bold = /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line)
    if (bold) return bold[1].trim()
    return null
  }

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const heading = headingText(lines[i])
    if (heading !== null && heading.toLowerCase().includes(wanted)) {
      start = i + 1
      break
    }
  }
  if (start === -1) return []

  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    if (headingText(lines[i]) !== null) break
    const cleaned = stripMarker(lines[i])
    if (cleaned !== '') out.push(cleaned)
  }
  return out
}

/** Drops a leading bullet or number so a pasted list reads as plain lines.
 *
 *  Exported because the same tidying applies to the field he types by hand:
 *  he pastes bullets across from the document, and a stray "- " on screen is
 *  the app showing its working. */
export function stripMarker(line: string): string {
  return line
    .replace(/^\s*[-*\u2022]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim()
}

/** The lines of a pasted brief's talking-points section, if it has one. */
export function talkingPointsFromBrief(markdown: string | null): string[] {
  return sectionLines(markdown, 'talking points')
}
