// A student's own posts, read from their Postiz with the key they saved in
// SETUP (the `postiz-posts` function): each video's live link, a preview, and
// its views. The planner never sees the key - the function reads it from the
// vault (user_ai_keys, provider 'postiz') and answers with the posts.
//
// Postiz allows 30 requests an hour per key and reads views one post at a
// time, so the function keeps what it has read (postiz_posts, server only)
// and reads a few more each time it is asked: a video's views can be null
// for a while after it goes out, and `reading` says how many are still due.
//
// Online only by nature - views live on the platforms. Null when there is no
// server or no sign-in.

import { toAiError } from '../ai/errors'
import { getSupabaseClient } from './auth'

/** One video as it went out on one account. */
export interface PostizPostView {
  /** Postiz's post id. */
  id: string
  /** Postiz's group: the posts of one video sent to several accounts at once
   *  share it, so a screen can show the video once with each platform's link
   *  (and borrow a TikTok/YouTube preview for its Instagram post). */
  group: string | null
  /** The planner's platform name: 'Instagram', 'TikTok', 'YouTube', 'Facebook'... */
  platform: string
  /** The account's handle as Postiz knows it, without the @. */
  handle: string
  /** The video on the platform - the link that opens on Instagram/TikTok. */
  url: string | null
  /** An image or video to show as its preview, when there is one. */
  preview: string | null
  /** 'image' when `preview` is a picture, 'video' when it is the video file. */
  previewKind: 'image' | 'video' | null
  caption: string
  /** Where it stands: waiting to go out at `publishedAt`, out, or failed -
   *  or, from the cutter's records, made and waiting for him to approve it. */
  status: 'scheduled' | 'posted' | 'failed' | 'waiting'
  /** When it goes (or went) out. */
  publishedAt: string | null
  /** Null until Postiz has been asked - never a guess. */
  views: number | null
  viewsAt: string | null
  /** The cutter's campaign it was made for, when it came from the cutter's
   *  records; null from Postiz, which knows only accounts. */
  campaign: { id: string; name: string } | null
}

export interface PostizPostsAnswer {
  /** False when no Postiz key is saved. */
  connected: boolean
  posts: PostizPostView[]
  /** Videos in the range whose views are still to be read. */
  reading: number
  /** Why Postiz could not be read this time, in plain words. */
  error?: string
  /** 'cutter' when the key is one the silence cutter posts with: the posts
   *  and views are the cutter's own records, and no Postiz request was spent. */
  source?: 'cutter' | 'postiz'
}

export interface PostizRange {
  /** ISO instant, inclusive. */
  from: string
  /** ISO instant, exclusive. */
  to: string
}

export async function loadPostizPosts(range: PostizRange): Promise<PostizPostsAnswer | null> {
  const client = getSupabaseClient()
  if (!client) return null
  const { data: session } = await client.auth.getSession()
  if (!session.session) return null
  const { data, error } = await client.functions.invoke('postiz-posts', { body: { from: range.from, to: range.to } })
  if (error) throw new Error((await toAiError(error)).message)
  return data as PostizPostsAnswer
}
