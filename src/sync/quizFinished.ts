// Tells the owner on Telegram that someone finished the quiz (the
// `quiz-finished` function). Best-effort: offline, signed out or failing, the
// quiz has already saved and nothing waits on this.

import { getSupabaseClient } from './auth'

export interface QuizFinished {
  name: string
  timezone: string
  goal: string
  wish: string
  minutesPerDay: number
  week: string[]
}

export async function sendQuizFinished(answers: QuizFinished): Promise<void> {
  try {
    const client = getSupabaseClient()
    if (!client) return
    const { data } = await client.auth.getSession()
    if (!data.session) return
    await client.functions.invoke('quiz-finished', { body: answers })
  } catch {
    // Never in his way.
  }
}
