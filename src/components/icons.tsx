// Every icon in the app, drawn by hand on one 24px grid.
//
// Same hand as the network glyph that started it: thin round strokes, no
// fills except for a dot that has to read as a dot, `currentColor` so an icon
// is only ever the colour of the text it sits beside - grey when later, white
// when now, green when done. An icon never carries a colour of its own; colour
// is for state and state only.
//
// No icon font and no package: a font is one more request to fail on bad
// signal, and a package is a dependency this app does not take on for
// drawings this small.

import type { ReactNode, SVGProps } from 'react'

type IconProps = { className?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({
  className = 'h-5 w-5',
  strokeWidth = 1.5,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

// --- The tab bar -----------------------------------------------------------

/** NOW - a clock face. */
export function NowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.75" />
    </Icon>
  )
}

/** POST - a ticked box, the thing he does on that screen. */
export function PostIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M8.5 12.25l2.5 2.5 4.75-5.25" />
    </Icon>
  )
}

/** BRIEFS - a page with its corner turned. */
export function BriefsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3.75H8a2.25 2.25 0 0 0-2.25 2.25v12A2.25 2.25 0 0 0 8 20.25h8A2.25 2.25 0 0 0 18.25 18V8Z" />
      <path d="M14 3.75V8h4.25" />
      <path d="M9 12.5h6M9 15.75h4" />
    </Icon>
  )
}

/** MONEY - two coins, stacked. */
export function MoneyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="7" rx="6.25" ry="2.5" />
      <path d="M5.75 7v4.75c0 1.38 2.8 2.5 6.25 2.5s6.25-1.12 6.25-2.5V7" />
      <path d="M5.75 11.75v4.75c0 1.38 2.8 2.5 6.25 2.5s6.25-1.12 6.25-2.5v-4.75" />
    </Icon>
  )
}

/** SETUP - three sliders. */
export function SetupIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h9M17.5 7h2M4.5 12h3M11.5 12h8M4.5 17h11" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9.5" cy="12" r="2" />
      <circle cx="17.5" cy="17" r="2" />
    </Icon>
  )
}

// --- Actions ---------------------------------------------------------------

/** FILM - a video camera. */
export function FilmIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="6.75" width="12" height="10.5" rx="2.75" />
      <path d="M15.5 10.25l4.25-2.5v8.5l-4.25-2.5" />
    </Icon>
  )
}

/** Something to go to next. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 6.5L15 12l-5.5 5.5" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 9.5L12 15l5.5-5.5" />
    </Icon>
  )
}

export function BackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 6.5L9 12l5.5 5.5" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6v12M6 12h12" />
    </Icon>
  )
}

/** A tick. `pathLength` is fixed at 1 so the draw-check animation in
 *  index.css can stroke it on with a single dash, whatever its size. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 12.5l4 4 8-9" pathLength={1} className="check-path" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7l10 10M17 7L7 17" />
    </Icon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h15" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6.25 7l.9 11.25a2 2 0 0 0 2 1.75h5.7a2 2 0 0 0 2-1.75L17.75 7" />
      <path d="M9.25 7V5.25a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1V7" />
    </Icon>
  )
}

export function SoundIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 9.75v4.5h3.25L12 17.75V6.25L7.75 9.75Z" />
      <path d="M15.25 9.25a4 4 0 0 1 0 5.5M17.75 7a7.25 7.25 0 0 1 0 10" />
    </Icon>
  )
}

export function MutedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 9.75v4.5h3.25L12 17.75V6.25L7.75 9.75Z" />
      <path d="M15.5 10l4 4M19.5 10l-4 4" />
    </Icon>
  )
}

/** The Post screen's second view - a core with three linked points. */
export function NetworkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeWidth={0.75} opacity={0.35} />
      <path d="M12 12L6.2 8.6M12 12l6.4-2.6M12 12l-1 6.6" strokeWidth={1} />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="6.2" cy="8.6" r="1.3" fill="currentColor" stroke="none" opacity={0.85} />
      <circle cx="18.4" cy="9.4" r="1.3" fill="currentColor" stroke="none" opacity={0.85} />
      <circle cx="11" cy="18.6" r="1.3" fill="currentColor" stroke="none" opacity={0.85} />
    </Icon>
  )
}

/** The Post screen's list view - three rows of boxes. */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.5h10M4.5 12h10M4.5 17.5h10" />
      <rect x="17" y="5" width="3" height="3" rx="0.75" />
      <rect x="17" y="10.5" width="3" height="3" rx="0.75" />
      <rect x="17" y="16" width="3" height="3" rx="0.75" />
    </Icon>
  )
}

/** "Fit everything back on screen" - four corner brackets. */
export function FitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    </Icon>
  )
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 12h12" />
    </Icon>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 5.75v-.5a1.75 1.75 0 0 0-1.75-1.75h-8.5A1.75 1.75 0 0 0 3.5 5.25v8.5a1.75 1.75 0 0 0 1.75 1.75h.5" />
    </Icon>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V4.5M7.75 8.5L12 4.25l4.25 4.25" />
      <path d="M4.5 14.5v2.75a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V14.5" />
    </Icon>
  )
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6Z" />
      <path d="M18 16.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" />
    </Icon>
  )
}

// --- Platforms -------------------------------------------------------------
//
// One line drawing each, grey like the name beside it. They are there so a
// row can be found by shape at a glance across a room - the name still says
// which it is, and nothing about a platform is a state.

function TikTokGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.25 4.5v10.25a3.25 3.25 0 1 1-3.25-3.25" />
      <path d="M13.25 4.5c.4 2.3 2.1 3.9 4.5 4.15" />
    </Icon>
  )
}

function InstagramGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.25" y="4.25" width="15.5" height="15.5" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.6" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  )
}

function YouTubeGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.25" y="6" width="17.5" height="12" rx="3.75" />
      <path d="M10.5 9.5v5l4.25-2.5Z" />
    </Icon>
  )
}

function FacebookGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.25 20v-7.25h2.5l.4-2.75h-2.9V8.4c0-.8.25-1.4 1.45-1.4h1.55V4.6a20 20 0 0 0-2.25-.1c-2.25 0-3.75 1.35-3.75 3.85V10H7.75v2.75h2.5V20" />
    </Icon>
  )
}

function XGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5l14 14M19 5L5 19" />
    </Icon>
  )
}

function SnapchatGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.25c2.75 0 4.5 2 4.5 4.6v2.15l1.85-.5c.5.35.4.95-.15 1.2l-1.85.8c.55 1.55 1.8 2.75 3.4 3.2-.25.7-1.35.95-2.4 1.05-.2.45-.25 1.05-.55 1.15-.55.2-1.35-.2-2.25 0-.9.2-1.45 1.35-2.55 1.35s-1.65-1.15-2.55-1.35c-.9-.2-1.7.2-2.25 0-.3-.1-.35-.7-.55-1.15-1.05-.1-2.15-.35-2.4-1.05 1.6-.45 2.85-1.65 3.4-3.2l-1.85-.8c-.55-.25-.65-.85-.15-1.2l1.85.5V8.85c0-2.6 1.75-4.6 4.5-4.6Z" />
    </Icon>
  )
}

function OtherGlyph(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7.5" />
    </Icon>
  )
}

const GLYPHS: Record<string, (props: IconProps) => ReactNode> = {
  tiktok: TikTokGlyph,
  instagram: InstagramGlyph,
  youtube: YouTubeGlyph,
  facebook: FacebookGlyph,
  x: XGlyph,
  twitter: XGlyph,
  snapchat: SnapchatGlyph,
}

/** The glyph for a platform by name, or a plain circle for one the app does
 *  not know - never a guess at what its logo might be. */
export function PlatformGlyph({ platform, ...props }: IconProps & { platform: string }) {
  const Glyph = GLYPHS[platform.trim().toLowerCase()] ?? OtherGlyph
  return <Glyph {...props} />
}
