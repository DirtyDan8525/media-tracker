# Spec v1.2 — social excerpt (authoritative; copied from the claude.ai Project 2026-11-16)

Amended by docs/specs/decisions-2026-11-15.md (wins on conflict). Dan chose: full Phase 4 at once (2026-11-16).

## 2. Decisions
- Access: private and invite-only through Cloudflare Access (free up to 50 users); only Dan can approve new people.
- Social: browse friends' lists, compare ratings, an activity feed with reactions and comments.
- Friends: added by username or personal invite link.
- Privacy: per-entry "private" flag and per-entry "private notes" flag, enforced on the server.

## 3. Architecture
- `api`: endpoints for entries, seasons, settings, friends, the feed, comments, comparisons and import. Each endpoint checks permissions through one shared `canView` / `canEdit` function.

## 4. Data model (D1)
- `users`: id, email (from Access), username (unique, changeable), display_name, avatar, theme, settings_json, is_admin, invite_code
- `friendships`: user_a, user_b, status (pending / accepted), requested_by, created_at
- `entries`: … is_private, notes_private …
- `activity`: id, user_id, entry_id, type (rated, re-rated, status changed, added), payload_json, created_at, updated_at  (exists — migration 0003)
- `reactions`: activity_id or entry_id, user_id, emoji
- `comments`: id, activity_id or entry_id, user_id, body, created_at, deleted_at

**Visibility rule (one function, tested):** a viewer can see an entry if they own it, or if they're an accepted friend of the owner and the entry isn't private. Notes are left out of the response when `notes_private` is set. Private entries never create feed posts and are excluded from friend comparisons. Comparisons (rating picks) are never shown to friends.

## 5.4 Social
- **Usernames:** chosen at first sign-in, unique, can be changed. (Already exist since Phase 1.)
- **Adding friends:** search by username, or open someone's personal invite link (`/add/<code>`, which can be regenerated to stop the old link from working). Friendships go both ways and can be removed.
- **Admin invite (Dan only):** enter a friend's email; the Worker adds it to the Cloudflare Access policy through the Cloudflare API and returns that person's link to send.
- **Friend profile:** read-only tabs, Top 5 and Stats, with private items left out. Every entry has "Add to mine".
- **Comparisons:** "Both rated" (side by side, sorted by how much you disagree), "Theirs, not yours" (their best-rated titles you haven't logged), and a group Top 5 per category.
- **Feed:** posts are created automatically for new ratings, status changes and re-ratings from Compare ("re-rated" when Save changes a title's shown score by 0.5 or more, or moves it to another tier). Changes to the same entry within 10 minutes merge into one post. Imports and note edits post nothing.
- **Reactions** (a fixed set of 6 emoji) and **comments** (up to 500 characters) on feed items and entries. You can delete your own comments, and anything on your own entries.
- **Notifications:** an unread badge in the app. Web push is Phase 6.

## 5.6 Settings and admin
- Settings: … username and display name, invite link.
- Admin (Dan): approve emails, see who has joined, check lookup source health, and diagnose a lookup.

## 6. Design
- Screens are mocked up first and Dan approves them: … friend profile, feed …

## 8. Testing
- Permission tests: a non-friend, a pending friend, and a friend trying to read a private entry or private notes all get the right result. A friend can never read comparisons.

## 9. Rollout
4. **Social:** admin invites, friends, profiles, comparisons, feed, reactions, comments, privacy. Friends on Windows and Android can join.
5. **iPhone:** test how Access sign-in behaves in an app installed to the iPhone home screen; swap the `auth` module for in-app Google sign-in if needed.

## 10. Risks
- Phase 5 sign-in on iPhone is unknown. Mitigated by keeping sign-in in its own module. Most of Dan's friends use iPhones, so the social features won't reach them until Phase 5.
