-- GREENLIGHT community: player reviews, comments, helpful votes, reports,
-- points, badges and moderation. Strict RLS everywhere; all privileged
-- writes happen in SECURITY DEFINER triggers/functions with a pinned search_path.

create extension if not exists citext;

-- ---------------------------------------------------------------- settings
create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.app_settings(key, value) values
  ('report_threshold', '3'),          -- distinct reports before an item auto-hides
  ('player_score_min', '3'),          -- reviews needed before a player score is shown
  ('ai_moderation',    'false'),      -- queue new content for the optional Edge Function
  ('rate_limits', '{"reviews_per_hour":5,"comments_per_10min":10,"comment_gap_seconds":10,"reports_per_hour":20,"votes_per_hour":60}');

create or replace function public.setting(k text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as
$$ select value from public.app_settings where key = k $$;

-- ---------------------------------------------------------------- games
-- Mirror of data/issue.json slugs + genres (seeded by greenlight/tools/gen_games_sql.py).
create table public.games (
  slug   text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  title  text not null,
  genres text[] not null default '{}',
  reviewable boolean not null default true,
  opens_on   date not null default current_date   -- player reviews open on release day
);

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name citext not null unique
               check (char_length(display_name) between 2 and 24
                      and display_name ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]*[A-Za-z0-9]$'),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- New auth user -> profile with a neutral default name (never the email).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare base text; n int := 0; candidate text;
begin
  base := 'Player ' || upper(substr(replace(new.id::text, '-', ''), 1, 5));
  candidate := base;
  while exists (select 1 from public.profiles where display_name = candidate) loop
    n := n + 1; candidate := base || n;
  end loop;
  insert into public.profiles(id, display_name) values (new.id, candidate);
  return new;
end $$;
create or replace function public.profiles_before_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p text;
begin
  p := public.content_problem(new.display_name::text);
  if p is not null then raise exception 'That display name isn''t allowed.' using errcode = 'P0422'; end if;
  new.is_admin := old.is_admin;  -- belt and braces: never changeable from the API
  return new;
end $$;
create trigger profiles_before_update before update on public.profiles
  for each row when (current_user in ('authenticated','anon'))
  execute function public.profiles_before_update();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- content filter
create table public.blocked_terms (term text primary key);
-- A deliberately small starter list; admins can extend it with SQL.
insert into public.blocked_terms(term) values
  ('fuck'),('fucking'),('fucker'),('motherfucker'),('shit'),('bullshit'),('cunt'),('bitch'),
  ('asshole'),('bastard'),('dickhead'),('wanker'),('twat'),('slut'),('whore'),('retard'),
  ('faggot'),('fag'),('nigger'),('nigga'),('kike'),('spic'),('chink'),
  ('viagra'),('cialis'),('casino'),('crypto giveaway'),('free vbucks'),('free robux'),('onlyfans');

-- Returns null when OK, otherwise a short reason. Used by triggers and exposed
-- to clients (check_text) so the UI can pre-validate.
create or replace function public.content_problem(t text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lower_t text := lower(coalesce(t, '')); letters int; caps int;
begin
  if exists (select 1 from public.blocked_terms b
             where lower_t ~ ('(^|[^a-z])' || b.term || '($|[^a-z])')) then
    return 'Please keep it civil: that wording isn''t allowed.';
  end if;
  if (select count(*) from regexp_matches(lower_t, '(https?://|www\.)', 'g')) > 1 then
    return 'Too many links.';
  end if;
  if lower_t ~ '(.)\1{7,}' then
    return 'Please avoid long runs of repeated characters.';
  end if;
  letters := char_length(regexp_replace(t, '[^A-Za-z]', '', 'g'));
  caps    := char_length(regexp_replace(t, '[^A-Z]', '', 'g'));
  if letters >= 20 and caps::numeric / letters > 0.7 then
    return 'Please don''t write in all caps.';
  end if;
  return null;
end $$;
create or replace function public.check_text(t text) returns text
language sql stable security definer set search_path = public, pg_temp as
$$ select public.content_problem(t) $$;

-- ---------------------------------------------------------------- rate limits
create or replace function public.rate_limit(tbl regclass, win interval, max_n int, what text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  execute format('select count(*) from %s where user_id = $1 and created_at > now() - $2', tbl)
    into n using auth.uid(), win;
  if n >= max_n then
    raise exception 'Rate limit: too many % — please wait a bit and try again.', what
      using errcode = 'P0429';
  end if;
end $$;

-- ---------------------------------------------------------------- reviews
create table public.reviews (
  id            bigint generated always as identity primary key,
  game_slug     text not null references public.games(slug) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  rating        numeric(2,1) not null check (rating between 0.5 and 5 and rating * 2 = floor(rating * 2)),
  hours         int not null check (hours between 0 and 5000),
  platform      text not null check (platform in ('series-x','series-s','xbox-one','pc','cloud','handheld')),
  body          text not null check (char_length(btrim(body)) between 60 and 1500),
  pros          text[] not null default '{}' check (cardinality(pros) <= 4 and pros <@ array[
                  'Great story','Stunning visuals','Smooth performance','Fun co-op','Satisfying combat',
                  'Great soundtrack','Lots to do','Great value on Game Pass','Accessible','Replayable']),
  cons          text[] not null default '{}' check (cardinality(cons) <= 4 and cons <@ array[
                  'Performance issues','Buggy','Grindy','Too short','Repetitive','Weak story',
                  'Steep learning curve','Monetization','Needs more content','Online issues']),
  status        text not null default 'visible' check (status in ('visible','hidden','removed')),
  helpful_count int not null default 0,
  report_count  int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (game_slug, user_id)
);
create index reviews_game_idx on public.reviews(game_slug, status);
create index reviews_user_idx on public.reviews(user_id, created_at);

create or replace function public.reviews_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p text; lim jsonb := public.setting('rate_limits');
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.games where slug = new.game_slug and reviewable) then
      raise exception 'This game is not open for player reviews.';
    end if;
    if exists (select 1 from public.games where slug = new.game_slug and opens_on > current_date) then
      raise exception 'Player reviews open on release day.';
    end if;
    perform public.rate_limit('public.reviews', interval '1 hour', (lim->>'reviews_per_hour')::int, 'reviews');
    new.status := 'visible'; new.helpful_count := 0; new.report_count := 0; new.created_at := now();
  end if;
  new.body := btrim(new.body);
  p := public.content_problem(new.body);
  if p is not null then raise exception '%', p using errcode = 'P0422'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger reviews_before_write before insert or update of rating, hours, platform, body, pros, cons
  on public.reviews for each row execute function public.reviews_before_write();

-- ---------------------------------------------------------------- comments
create table public.comments (
  id           bigint generated always as identity primary key,
  game_slug    text not null references public.games(slug) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id    bigint references public.comments(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 2 and 800),
  status       text not null default 'visible' check (status in ('visible','hidden','removed','deleted')),
  report_count int not null default 0,
  created_at   timestamptz not null default now()
);
create index comments_game_idx on public.comments(game_slug, created_at);
create index comments_user_idx on public.comments(user_id, created_at);

create or replace function public.comments_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p text; par record; lim jsonb := public.setting('rate_limits');
begin
  if new.parent_id is not null then
    select * into par from public.comments where id = new.parent_id;
    if par is null or par.game_slug <> new.game_slug then raise exception 'Reply target not found.'; end if;
    if par.parent_id is not null then raise exception 'Replies can only be one level deep.'; end if;
    if par.status <> 'visible' then raise exception 'You can''t reply to that comment.'; end if;
  end if;
  perform public.rate_limit('public.comments', interval '10 minutes', (lim->>'comments_per_10min')::int, 'comments');
  perform public.rate_limit('public.comments', make_interval(secs => (lim->>'comment_gap_seconds')::int), 1, 'comments in a row');
  new.body := btrim(new.body);
  p := public.content_problem(new.body);
  if p is not null then raise exception '%', p using errcode = 'P0422'; end if;
  new.status := 'visible'; new.report_count := 0; new.created_at := now();
  return new;
end $$;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comments_before_insert();

-- Deleting a comment that has replies keeps the thread: it becomes a tombstone.
create or replace function public.comments_before_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if pg_trigger_depth() = 1 and old.parent_id is null
     and exists (select 1 from public.comments c where c.parent_id = old.id and c.status <> 'deleted') then
    update public.comments set status = 'deleted', body = '[deleted]' where id = old.id;
    delete from public.point_events where kind = 'comment' and ref_id = old.id;
    return null;
  end if;
  return old;
end $$;
create trigger comments_before_delete before delete on public.comments
  for each row execute function public.comments_before_delete();

-- ---------------------------------------------------------------- helpful votes
create table public.helpful_votes (
  review_id  bigint not null references public.reviews(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);
create index helpful_votes_user_idx on public.helpful_votes(user_id, created_at);

create or replace function public.votes_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare lim jsonb := public.setting('rate_limits');
begin
  if exists (select 1 from public.reviews r where r.id = new.review_id and r.user_id = new.user_id) then
    raise exception 'You can''t mark your own review as helpful.';
  end if;
  if not exists (select 1 from public.reviews r where r.id = new.review_id and r.status = 'visible') then
    raise exception 'Review not found.';
  end if;
  perform public.rate_limit('public.helpful_votes', interval '1 hour', (lim->>'votes_per_hour')::int, 'votes');
  new.created_at := now();
  return new;
end $$;
create trigger votes_before_insert before insert on public.helpful_votes
  for each row execute function public.votes_before_insert();

-- ---------------------------------------------------------------- reports / flag queue
create table public.reports (
  id          bigint generated always as identity primary key,
  target_type text not null check (target_type in ('review','comment')),
  target_id   bigint not null,
  user_id     uuid default auth.uid() references public.profiles(id) on delete set null, -- null = AI/system
  reason      text not null check (reason in ('spam','abuse','spoilers','off-topic','other','ai-flag')),
  note        text check (note is null or char_length(note) <= 300),
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (target_type, target_id, user_id)
);
create index reports_open_idx on public.reports(resolved, target_type, target_id);

create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner uuid; lim jsonb := public.setting('rate_limits');
begin
  if new.target_type = 'review' then select user_id into owner from public.reviews where id = new.target_id;
  else select user_id into owner from public.comments where id = new.target_id; end if;
  if owner is null then raise exception 'Item not found.'; end if;
  if new.user_id is not null then
    if owner = new.user_id then raise exception 'You can''t report your own post.'; end if;
    if new.reason = 'ai-flag' then raise exception 'Invalid reason.'; end if;
    perform public.rate_limit('public.reports', interval '1 hour', (lim->>'reports_per_hour')::int, 'reports');
  end if;
  new.resolved := false; new.created_at := now();
  return new;
end $$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- Count open reports on the target; auto-hide at the threshold (AI flags hide immediately).
create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; th int := (public.setting('report_threshold'))::text::int;
begin
  select count(*) into n from public.reports
   where target_type = new.target_type and target_id = new.target_id and not resolved;
  if new.target_type = 'review' then
    update public.reviews set report_count = n,
      status = case when status = 'visible' and (n >= th or new.reason = 'ai-flag') then 'hidden' else status end
     where id = new.target_id;
  else
    update public.comments set report_count = n,
      status = case when status = 'visible' and (n >= th or new.reason = 'ai-flag') then 'hidden' else status end
     where id = new.target_id;
  end if;
  return null;
end $$;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.reports_after_insert();

-- ---------------------------------------------------------------- points ledger
create table public.point_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('review','helpful','comment')),
  ref_id     bigint not null,          -- review id / vote review id / comment id
  voter_id   uuid,                     -- for helpful votes
  points     int not null,
  created_at timestamptz not null default now(),
  unique (kind, ref_id, voter_id)
);
create unique index point_events_once on public.point_events(kind, ref_id) where voter_id is null;
create index point_events_month_idx on public.point_events(created_at, user_id);

-- Points: review 10, helpful vote received 2, comment 1. Hidden/removed content earns nothing.
create or replace function public.points_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'reviews' then
    if tg_op = 'DELETE' or new.status <> 'visible' then
      delete from public.point_events where kind = 'review' and ref_id = old.id;
      delete from public.point_events where kind = 'helpful' and ref_id = old.id;
    elsif tg_op = 'INSERT' or (old.status <> 'visible' and new.status = 'visible') then
      insert into public.point_events(user_id, kind, ref_id, points) values (new.user_id, 'review', new.id, 10)
        on conflict do nothing;
      insert into public.point_events(user_id, kind, ref_id, voter_id, points)
        select new.user_id, 'helpful', new.id, v.user_id, 2 from public.helpful_votes v where v.review_id = new.id
        on conflict do nothing;
    end if;
  elsif tg_table_name = 'comments' then
    if tg_op = 'DELETE' or new.status <> 'visible' then
      delete from public.point_events where kind = 'comment' and ref_id = old.id;
    elsif tg_op = 'INSERT' or old.status <> 'visible' then
      insert into public.point_events(user_id, kind, ref_id, points) values (new.user_id, 'comment', new.id, 1)
        on conflict do nothing;
    end if;
  elsif tg_table_name = 'helpful_votes' then
    if tg_op = 'INSERT' then
      update public.reviews set helpful_count = helpful_count + 1 where id = new.review_id;
      insert into public.point_events(user_id, kind, ref_id, voter_id, points)
        select r.user_id, 'helpful', r.id, new.user_id, 2 from public.reviews r where r.id = new.review_id
        on conflict do nothing;
    else
      update public.reviews set helpful_count = greatest(helpful_count - 1, 0) where id = old.review_id;
      delete from public.point_events where kind = 'helpful' and ref_id = old.review_id and voter_id = old.user_id;
    end if;
  end if;
  return null;
end $$;
create trigger reviews_points after insert or delete or update of status on public.reviews
  for each row execute function public.points_sync();
create trigger comments_points after insert or delete or update of status on public.comments
  for each row execute function public.points_sync();
create trigger votes_points after insert or delete on public.helpful_votes
  for each row execute function public.points_sync();

-- ---------------------------------------------------------------- AI moderation hook (optional)
-- When app_settings.ai_moderation = true, new reviews/comments are queued here.
-- A Supabase Database Webhook (or cron) calls the `moderate` Edge Function, which
-- uses an LLM key from its own env vars. Without a key nothing happens.
create table public.moderation_jobs (
  id          bigint generated always as identity primary key,
  target_type text not null check (target_type in ('review','comment')),
  target_id   bigint not null,
  body        text not null,
  status      text not null default 'pending' check (status in ('pending','ok','flagged','error','skipped')),
  detail      text,
  created_at  timestamptz not null default now()
);
create or replace function public.enqueue_moderation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce((public.setting('ai_moderation'))::text::boolean, false) then
    insert into public.moderation_jobs(target_type, target_id, body)
      values (case when tg_table_name = 'reviews' then 'review' else 'comment' end, new.id, new.body);
  end if;
  return null;
end $$;
create trigger reviews_ai after insert or update of body on public.reviews
  for each row execute function public.enqueue_moderation();
create trigger comments_ai after insert on public.comments
  for each row execute function public.enqueue_moderation();

-- ---------------------------------------------------------------- read models
create view public.game_stats with (security_invoker = true) as
  select g.slug as game_slug,
         count(r.id)::int as review_count,
         round(avg(r.rating), 1) as avg_rating,
         (count(r.id) >= (public.setting('player_score_min'))::text::int) as show_score
    from public.games g
    left join public.reviews r on r.game_slug = g.slug and r.status = 'visible'
   group by g.slug;

create view public.review_feed with (security_invoker = true) as
  select r.id, r.game_slug, r.user_id, p.display_name, r.rating, r.hours, r.platform, r.body,
         r.pros, r.cons, r.status, r.helpful_count, r.created_at, r.updated_at,
         g.title as game_title
    from public.reviews r join public.profiles p on p.id = r.user_id join public.games g on g.slug = r.game_slug;

create view public.comment_feed with (security_invoker = true) as
  select c.id, c.game_slug, c.parent_id, c.user_id,
         case when c.status = 'deleted' then null else p.display_name end as display_name,
         case when c.status = 'deleted' then '' else c.body end as body,
         c.status, c.created_at
    from public.comments c join public.profiles p on p.id = c.user_id;

create view public.user_stats with (security_invoker = true) as
  select p.id as user_id, p.display_name, p.created_at,
         coalesce((select sum(points) from public.point_events e where e.user_id = p.id), 0)::int as points,
         (select count(*) from public.reviews r where r.user_id = p.id and r.status = 'visible')::int as reviews,
         (select count(*) from public.point_events e where e.user_id = p.id and e.kind = 'helpful')::int as helpful_received,
         (select count(*) from public.comments c where c.user_id = p.id and c.status = 'visible')::int as comments
    from public.profiles p;

-- Badges are derived, never stored, so they can't drift or be self-awarded.
create view public.user_badges with (security_invoker = true) as
  select user_id, 'first-review'::text as code, 'First Review'::text as name, 'Posted a first player review'::text as description
    from public.user_stats where reviews >= 1
  union all
  select user_id, 'five-reviews', '5 Reviews', 'Posted five player reviews' from public.user_stats where reviews >= 5
  union all
  select user_id, 'helpful-10', 'Helpful ×10', 'Reviews marked helpful ten times' from public.user_stats where helpful_received >= 10
  union all
  select user_id, 'talker', 'Conversation Starter', 'Ten comments or replies' from public.user_stats where comments >= 10
  union all
  select x.user_id, 'specialist', 'Genre Specialist', 'Three or more reviews in: ' || string_agg(x.genre, ', ' order by x.genre)
    from (select r.user_id, gg.genre
            from public.reviews r join public.games g on g.slug = r.game_slug
            cross join lateral unnest(g.genres) as gg(genre)
           where r.status = 'visible'
           group by r.user_id, gg.genre having count(*) >= 3) x
   group by x.user_id;

-- Monthly leaderboard (points earned in a calendar month, UTC).
create or replace function public.leaderboard(month date default (now() at time zone 'utc')::date, lim int default 25)
returns table(rank int, user_id uuid, display_name text, points int, reviews int, helpful int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select (row_number() over (order by sum(e.points) desc, min(e.created_at)))::int,
         e.user_id, p.display_name::text, sum(e.points)::int,
         count(*) filter (where e.kind = 'review')::int,
         count(*) filter (where e.kind = 'helpful')::int
    from public.point_events e join public.profiles p on p.id = e.user_id
   where e.created_at >= date_trunc('month', month::timestamp) at time zone 'utc'
     and e.created_at <  (date_trunc('month', month::timestamp) + interval '1 month') at time zone 'utc'
   group by e.user_id, p.display_name
   order by 4 desc, min(e.created_at)
   limit least(greatest(lim, 1), 100)
$$;

-- ---------------------------------------------------------------- admin
create or replace function public.flag_queue()
returns table(target_type text, target_id bigint, game_slug text, author text, body text,
              status text, reports int, reasons text[], last_report timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  return query
    select q.target_type, q.target_id, coalesce(r.game_slug, c.game_slug),
           p.display_name::text, coalesce(r.body, c.body),
           coalesce(r.status, c.status), q.n::int, q.reasons, q.last
      from (select rp.target_type, rp.target_id, count(*) n, array_agg(distinct rp.reason) reasons, max(rp.created_at) last
              from public.reports rp where not rp.resolved group by 1, 2) q
      left join public.reviews r on q.target_type = 'review' and r.id = q.target_id
      left join public.comments c on q.target_type = 'comment' and c.id = q.target_id
      left join public.profiles p on p.id = coalesce(r.user_id, c.user_id)
     order by (coalesce(r.status, c.status) = 'hidden') desc, q.last desc;
end $$;

create or replace function public.moderate(p_type text, p_id bigint, p_action text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare st text;
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_action not in ('restore','remove') then raise exception 'Unknown action.'; end if;
  st := case p_action when 'restore' then 'visible' else 'removed' end;
  if p_type = 'review' then update public.reviews set status = st, report_count = 0 where id = p_id;
  elsif p_type = 'comment' then update public.comments set status = st, report_count = 0 where id = p_id;
  else raise exception 'Unknown type.'; end if;
  update public.reports set resolved = true where target_type = p_type and target_id = p_id;
end $$;

-- ---------------------------------------------------------------- privileges + RLS
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.app_settings    enable row level security;
alter table public.games           enable row level security;
alter table public.profiles        enable row level security;
alter table public.blocked_terms   enable row level security;
alter table public.reviews         enable row level security;
alter table public.comments        enable row level security;
alter table public.helpful_votes   enable row level security;
alter table public.reports         enable row level security;
alter table public.point_events    enable row level security;
alter table public.moderation_jobs enable row level security;   -- no policies: service role only

-- Reads
grant select on public.app_settings, public.games, public.profiles, public.reviews, public.comments
  to anon, authenticated;
-- Points are public, but who voted for whom is not: voter_id is not grantable.
grant select (id, user_id, kind, ref_id, points, created_at) on public.point_events to anon, authenticated;
grant select on public.helpful_votes to authenticated;
grant select on public.game_stats, public.review_feed, public.comment_feed, public.user_stats, public.user_badges
  to anon, authenticated;
create policy "settings readable" on public.app_settings for select using (true);
create policy "games readable"    on public.games        for select using (true);
create policy "profiles readable" on public.profiles     for select using (true);
create policy "points readable"   on public.point_events for select using (true);
create policy "own votes readable" on public.helpful_votes for select to authenticated using (user_id = auth.uid());
create policy "reviews readable" on public.reviews for select
  using (status = 'visible' or user_id = auth.uid() or public.is_admin());
create policy "comments readable" on public.comments for select
  using (status in ('visible','deleted') or user_id = auth.uid() or public.is_admin());

-- Profiles: only your own display name.
grant update (display_name) on public.profiles to authenticated;
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Reviews: one per user per game (unique), edit/delete own; status/counters are not grantable.
grant insert (game_slug, rating, hours, platform, body, pros, cons) on public.reviews to authenticated;
grant update (rating, hours, platform, body, pros, cons) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;
create policy "own review insert" on public.reviews for insert to authenticated with check (user_id = auth.uid());
create policy "own review update" on public.reviews for update to authenticated
  using (user_id = auth.uid() and status <> 'removed') with check (user_id = auth.uid());
create policy "own review delete" on public.reviews for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Comments: insert + delete own (no edits).
grant insert (game_slug, parent_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;
create policy "own comment insert" on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy "own comment delete" on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Helpful votes: add/remove your own.
grant insert (review_id) on public.helpful_votes to authenticated;
grant delete on public.helpful_votes to authenticated;
create policy "own vote insert" on public.helpful_votes for insert to authenticated with check (user_id = auth.uid());
create policy "own vote delete" on public.helpful_votes for delete to authenticated using (user_id = auth.uid());

-- Reports: file your own; see your own (to show "Reported"); admins see all.
grant insert (target_type, target_id, reason, note) on public.reports to authenticated;
grant select on public.reports to authenticated;
create policy "own report insert" on public.reports for insert to authenticated with check (user_id = auth.uid());
create policy "own report read" on public.reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Functions callable by clients
grant execute on function public.check_text(text) to anon, authenticated;
grant execute on function public.leaderboard(date, int) to anon, authenticated;
grant execute on function public.flag_queue() to authenticated;
grant execute on function public.moderate(text, bigint, text) to authenticated;
-- needed inside security_invoker views / policies
grant execute on function public.setting(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
