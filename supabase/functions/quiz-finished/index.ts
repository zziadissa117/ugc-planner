// Tells the owner, through his Telegram bot, that someone finished the
// onboarding quiz: who they are, their goal, their wish, and their week.
//
//   POST { name, timezone, goal, wish, minutesPerDay, week: [string] } -> { sent }
//
// The bot token and his chat id are server secrets (TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID), so they never reach a student's phone. Signed-in callers
// only; the email shown is the verified account's, not anything sent.
// Best-effort: a failure here never stops the quiz from saving.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser, serviceClient } from '../_shared/claude.ts'

const escape = (s: unknown) =>
  String(s ?? '').slice(0, 600).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chat = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chat) return jsonResponse({ sent: false, reason: 'Telegram is not set up.' })

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const { data } = await serviceClient().auth.admin.getUserById(auth.userId)
  const week = Array.isArray(body?.week) ? body.week.slice(0, 14).map((line: unknown) => `• ${escape(line)}`) : []
  const text = [
    '🎓 <b>Quiz finished</b>',
    `<b>${escape(body?.name) || 'No name given'}</b> · ${escape(data?.user?.email ?? 'no email')}`,
    `Time zone: ${escape(body?.timezone)}`,
    `Goal: ${escape(body?.goal)}`,
    `Recording: ${escape(body?.minutesPerDay)} min a day`,
    '',
    '<b>Their week</b>',
    ...week,
    '',
    `<b>One thing that would make it better:</b> ${escape(body?.wish) || '—'}`,
  ].join('\n')

  const answer = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => null)
  return jsonResponse({ sent: answer?.ok === true })
})
