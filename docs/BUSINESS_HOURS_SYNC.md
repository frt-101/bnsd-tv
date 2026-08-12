# Business Hours Sync — Future Enhancement (Not Yet Implemented)

**Status:** idea captured for later; nothing below has been built.

## The problem

BNSD TV has no concept of open/closed hours at all — once the page loads, the
player loops the catalog forever with no stop condition. Today "off" is
handled entirely outside the app, via the projector/FreeKiosk power schedule
(see `docs/ANDROID_PROJECTOR_SETUP.md`, Section 3).

That's fine *if* the schedule fully powers the Android device down (the
WebView process dies, so the app dies with it). But if FreeKiosk/the
projector only blanks the screen while the device and FreeKiosk's WebView
process keep running in the background, BNSD TV would keep looping the
catalog and hitting YouTube the entire time it's "off" — invisible, and
entirely wasted.

## The idea

BNSD's sister app **REBA** already syncs open/closed hours from the Square
POS API and stores it in Firestore. Rather than inventing a second,
independently-maintained schedule inside BNSD TV, read that same data and use
it as the single source of truth for whether the stream should be running.

This also means an unexpected early closure (not just the normal daily
schedule) would propagate to the projectors automatically if it's a live
Firestore value rather than a static weekly schedule.

## Why this is the right direction (vs. building our own schedule)

- One real answer to "are we open," not two schedules that can silently
  drift apart (holiday hours, early closures, etc.).
- We already have the plumbing: `src/firebase.js` (currently pointed at
  placeholder keys) and the `subscribeChannelConfig` pattern in
  `src/firebase.js`/`src/main.js` are a direct template for a read-only
  `subscribeBusinessHours()` listener.
- Pointing `firebaseConfig` at the real project this would require is the
  same prerequisite already needed for the (also not-yet-built)
  cross-projector admin sync discussed separately — this work would unlock
  both.

## What we need before this can actually be built

These are open questions for whoever owns REBA/the Firestore schema, not
things to guess at in code:

1. Which Firestore project and collection/document REBA writes hours to.
2. The document shape — a per-day open/close schedule we'd need to evaluate
   ourselves? A single live `isOpen` boolean REBA already computes? Timezone
   handling? Holiday/exception overrides?
3. Whether BNSD TV should get its own scoped read-only Firestore access, or
   go through some other read path (e.g. a small REBA-side API) instead of
   reading REBA's collection directly.

## Rough shape of the implementation (sketch only)

- A `subscribeBusinessHours(locationId, callback)` function, read-only,
  mirroring `subscribeChannelConfig` in `src/firebase.js`.
- A narrow addition to `firestore.rules`: `allow read: if true; allow write: if false;`
  scoped to just that collection — same pattern already used for `channels/{channelId}`.
- A pause/resume capability on `playerEngine` (stop the clip timer and
  loading new videos while closed; resume cleanly at open) rather than
  tearing the whole page down.
- `src/watchdog.js` needs to know about "intentionally paused because
  closed" so it doesn't mistake that for a stall and force a reload.
- A decision on what the screen actually shows while closed (black? a
  static "closed" card? whatever FreeKiosk shows once the app stops
  updating it?) and whether this is meant to *replace* the physical
  power-cycle schedule or run alongside it as a second, app-level guarantee.

## Revisit when

Someone has the REBA Firestore project/collection details, or this becomes
a priority on its own.
