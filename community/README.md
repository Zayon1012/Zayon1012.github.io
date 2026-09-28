# GREENLIGHT community backend (Supabase)

Player reviews, comments, helpful votes, reports, points, badges, a monthly leaderboard and
moderation for the static GREENLIGHT site (`/greenlight`). The site stays static: the browser
talks to Supabase (Postgres + Auth + Row Level Security) using the public anon/publishable key.

**Status:** community is **off** on the live site (`greenlight/js/config.js` is empty), so every
community area shows "Coming soon". Turning it on is a one-file change.

## What's here
| Path | Purpose |
|---|---|
| `supabase/migrations/20260928150000_community.sql` | Schema, strict RLS, column grants, triggers (rate limits, word/spam filter, one-level replies, auto-hide after N reports, points ledger), views (`game_stats`, `review_feed`, `comment_feed`, `user_stats`, `user_badges`), RPCs (`leaderboard`, `flag_queue`, `moderate`, `check_text`) |
| `supabase/migrations/20260928150100_games.sql` | Games mirror of `greenlight/data/issue.json` (regenerate with `greenlight/tools/gen_games_sql.py`) |
| `supabase/functions/moderate/index.ts` | Optional AI moderation Edge Function (no paid key required; without a key it does nothing) |

Tests (run locally, not deployed): 65 API/RLS checks and a 33-check Playwright flow at 1440×900 and 390×844.

## Rules enforced in the database
- One review per user per game; 0.5–5 stars in half steps; hours 0–5000; platform from a fixed list; 60–1500 characters; up to 4 pros and 4 cons from fixed tag lists; reviews open on release day.
- Users can only edit/delete their own content (RLS + column-level grants: status, counters, `is_admin` and `user_id` are not writable).
- Helpful votes are private to the voter (points are public; `point_events.voter_id` is not readable).
- Player score shows only after 3 visible reviews (`app_settings.player_score_min`).
- Rate limits: 5 reviews/hour, 10 comments/10 min with a 10 s gap, 20 reports/hour, 60 votes/hour (`app_settings.rate_limits`).
- Word/spam filter: blocked terms, >1 link, repeated characters, all caps.
- Reports: can't report your own post; after 3 distinct reports (`app_settings.report_threshold`) a post hides until an admin restores or removes it at `#/admin`.
- Points: review +10, helpful vote received +2, comment +1; hidden/removed posts earn nothing. Badges are derived (never stored): First Review, 5 Reviews, Helpful ×10, Genre Specialist (3 reviews in one genre), Conversation Starter.

## Go-live setup (project owner)
1. Create a free project at https://supabase.com (New project → any region → set a DB password).
2. Run the SQL: Dashboard → SQL Editor → paste and run `20260928150000_community.sql`, then `20260928150100_games.sql`.
3. Auth → URL Configuration: Site URL `https://zayon1012.github.io/greenlight/`; add Redirect URL `https://zayon1012.github.io/greenlight/**`.
4. Auth → Providers → Email: enabled (magic link is the default). For real traffic add custom SMTP (Auth → SMTP), because the built-in sender is heavily rate-limited.
5. Share the **Project URL** and the **anon / publishable key** (Settings → API). These go in `greenlight/js/config.js`. Never share or commit the service_role/secret key; it isn't needed.
6. After signing in once, make yourself admin in the SQL Editor:
   `update public.profiles set is_admin = true where id = (select id from auth.users where email = 'YOUR_EMAIL');`

Optional: GitHub/Google OAuth (Auth → Providers; callback `https://<project-ref>.supabase.co/auth/v1/callback`), then set `oauth.github/google: true` in `config.js`.

Optional AI moderation: `supabase functions deploy moderate`, add secrets `MODERATION_API_KEY` (+ `MODERATION_MODE`, `MODERATION_API_URL`, `MODERATION_MODEL`, `MODERATION_WEBHOOK_SECRET`), create a Database Webhook on `moderation_jobs` INSERT → the function, then `update public.app_settings set value = 'true' where key = 'ai_moderation';`. Flags only hide posts for human review; nothing is auto-deleted.

## Adding games or issues
Edit `greenlight/data/issue.json`, then run `python greenlight/tools/gen_games_sql.py` and run the output in the SQL Editor (idempotent upsert). Games with a review page (`reviewed: true`) accept player reviews from `playerReviewsOpen` or their Game Pass date.
