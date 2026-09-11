# The prompt that fills "Brief for the hook writer"

He does not write hooks by hand. The workflow is: send this prompt to
Claude along with the campaign's brief and contract, then paste the whole
answer into the **Brief for the hook writer** box on the campaign's page.
That box goes to the hook generator verbatim and outranks every other
section of the request.

The section that matters most is ANGLES. Inflow's generated hooks were
varied and Vertus's were ten rewordings of one sentence, and the whole
difference was that Inflow had six named angles to spread across. Angles
are not a feature to maintain in the app - there is no angles UI and there
should not be one - they are just distinct storylines, and naming eight of
them in this document is what makes a batch of ten hooks feel like ten
hooks.

Do not ask for the pay rate, the daily quota, handles or logins. Those are
app fields, typed in on the campaign page, and no document states them.

---

## The prompt

```
Read the attached brand brief and contract for a UGC campaign I am
creating short-form videos for.

Write me a single working brief in markdown that I will paste into my
video app, which feeds it to a hook generator. Output only that document
- no preamble, no commentary afterwards.

Use exactly these sections, in this order:

## PRODUCT
What the product or service actually is, and what I am permitted to claim
about it. State any attribution the brief demands - if a claim has to be
phrased as something the company says rather than as established fact, say
so explicitly and show the phrasing. Then a short "never claim" list: the
things that sound sayable but are not.

## AUDIENCE
Who the videos are for. If the brief names several segments, list them all
with the depth of language each expects, and note that one video addresses
one segment.

## VOICE
The register, in concrete terms - what it sounds like and what it must
never sound like. Include phrasings and deliveries the brief forbids. If
different formats want different energy, say which.

## STRUCTURE
What the video does AFTER the hook: the beats in order, plus any timing
the brief fixes. Be clear that this is the body of the video, not the
opening line.

## TALKING POINTS
A plain bullet list. At least 6 bullets, at most 8. Format exactly:

- One thing to say
- The next thing to say

Work through this skeleton in this order, one bullet each. Skip any slot
the brief does not support rather than inventing something to fill it -
a five-bullet list of things the brief actually says beats an eight-bullet
list with three guesses in it:

1. THE PROBLEM - the pain the viewer already has, in their words.
2. WHY IT HAPPENS - the mechanism behind it, one line. This is what makes
   the video sound informed rather than like a complaint.
3. THE TURN - what this product does differently. Attributed if the brief
   demands attribution.
4. THE CONCRETE DETAIL - the one number, price or specific the brief
   actually permits. Exactly as written, never rounded or improved.
5. THE PROOF - who uses it, where it has been tested, what is checkable.
6. THE OBJECTION - what a sceptic says, answered in one line.
7. WHY NOW - a launch, a waitlist, a deadline. Only if the brief states one.
8. THE STAKE - what it costs to carry on the old way.

Rules for this section specifically, because I read it off a screen with
the camera already running:

- One idea per bullet. Never two joined by "and" or a semicolon.
- Twelve words or fewer per bullet. If it does not fit, it is two bullets
  or it is not a talking point.
- No sub-bullets, no bold, no headings, no numbering, no trailing notes
  in brackets. A bullet is one line of plain text and nothing else.
- Write what I would actually say out loud, not what a brief would write.
  "Paid out instantly, not in seven days" - not "emphasise the instant
  settlement value proposition".
- Order them the way they should come out in the video.
- Keep any attribution the PRODUCT section demands, inside the bullet:
  "Vertus says it reasons instead of predicting", never just "it reasons".
- Nothing that needs interpreting mid-take. If a bullet would make me stop
  and work out what it meant, rewrite it.
- No opening line and no call to action. I have hooks for the first and I
  write the last one myself.

## FORMATS
Each repeatable video shape the brief implies or states, named, with what
it looks like on screen and how long it runs.

## ANGLES
Eight to twelve distinct storylines, each on one line as:
  ID - FAMILY: one-sentence concept

The ID is short and human (A-FROZEN, B-WAIT). The FAMILY groups them into
two or three emotional registers so a batch can alternate rather than
hammering one - fear/greed, or whatever the brief's own logic suggests.
Each angle must be a genuinely different reason someone would stop
scrolling, not the same claim rephrased. This section is the most
important one in the document: it is what stops every generated hook
being a reworded version of the campaign's thesis.

## HOOK BANK
Any hooks, openers or viral references already in the brief, grouped by
format. If there are none, write "none in the brief" - do not invent a
bank and pass it off as theirs.

## NEVER DO
The absolute restrictions, as a flat list of short imperatives. Include
compliance and disclosure requirements. This list is treated as hard
constraints, so leave nothing implied.

Rules for you while writing it:
- Work only from the documents I gave you. Never add a statistic, price,
  percentage, guarantee or feature that is not in them.
- Where the brief is silent, write "not stated in the brief" for that
  section rather than filling it in. A gap I can see is useful; a
  plausible invention reaches a brand as though I said it.
- The ANGLES and FORMATS sections may be your own structuring of what the
  brief describes - that is the point of them - but every angle must trace
  back to something the brief actually supports.
- End with a short "GAPS" list of anything I should go and ask the brand.
```

---

## After pasting it

Open the campaign, paste the whole thing into **Brief for the hook
writer**, Save. That is all of it - the FILM console reads the TALKING
POINTS section straight out of this document and pins it to the top of
the screen while filming, so there is nothing to copy across twice.

**Say this in the video** on the brief page overrides that section when
it has anything in it. Use it when a batch wants something the document
does not say, and leave it empty the rest of the time.

Then FILM -> that campaign -> set a goal -> **Write me some hooks**.

The generator is told the working brief outranks the short fields above
it, so the four brief fields can stay thin if this document is good.
