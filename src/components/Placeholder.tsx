/** Scaffolding marker. Every screen below exists so routing can be proven to
 *  work end to end in phase 1; each one names the phase that fills it in.
 *
 *  These deliberately render no campaign data, no rates and no counts. A screen
 *  that showed a plausible number here would be indistinguishable from one that
 *  worked, and that is the exact failure the spec is written to prevent.
 *
 *  Delete this component once the last screen is real. */
export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string
  phase: string
  children?: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-screen-sm">
      <h1 className="text-2xl font-semibold text-text">{title}</h1>
      <p className="mt-3 text-state-later">Not built yet - {phase}.</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  )
}
