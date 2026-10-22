# Old Reddit DOM Reader

A Violentmonkey/Tampermonkey userscript for `www.reddit.com` that re-renders
pages in an old-reddit-style layout, without redirecting you to
`old.reddit.com`. Images and video stay at "new reddit" size instead of the
tiny old-reddit thumbnails.

[![Screenshot](https://i.postimg.cc/21qf5z8h/Screenshot-2026-09-01-at-10-37-11.png)](https://postimg.cc/21qf5z8h)

## What it does

- Runs on `www.reddit.com` (desktop) — subreddit feeds, the home feed, and
  comment threads.
- Reads the data straight from the page that's already loaded (reddit's
  `<shreddit-post>` and `<shreddit-comment>` elements).
- Draws a classic old-reddit-style feed: vote-count column, title line,
  domain, meta line (submitted by / to r/x / N comments), and sort tabs
  (hot / new / rising / top / controversial / best).
- Shows community highlights (pinned posts) at the top of subreddit feeds,
  marked with a 📌.
- Loads more posts automatically: the feed pre-fills to about 25 posts,
  keeps loading as you scroll, and has a "load more ›" button as a
  fallback. This uses the same-origin "more posts" request reddit's own
  infinite scroll uses, and the HTML it returns is parsed the same way.
- Keeps media large: images, galleries, reddit-hosted video, and embeds
  (YouTube, etc.) all render at "new reddit" size instead of old reddit's
  small thumbnails.
- Renders comment threads as a real nested tree (rebuilt from each
  comment's `depth`) with click-to-collapse.
- Hides reddit's own app behind the scenes so you never see it flash
  before the old-style layout takes over. Clicking any link forces a real
  page navigation (the script re-applies on the next page), matching old
  reddit's page-per-click behavior — reddit's background app is blocked
  from hijacking clicks for client-side routing.
- If the page can't be read (no posts found, markup changed), the script
  gets out of the way and shows the normal reddit page.
- Pages it doesn't know how to redraw (settings, chat, submit, wiki, login,
  search, user pages, etc.) are left completely alone.
- Escape hatch: add `?orr=off` to any URL, or click "view original
  reddit.com" in the header, to see the normal page.

## What it doesn't do

- No voting — that needs reddit's internal CSRF/session flow, which is out
  of scope for a userscript.
- reddit-hosted videos only have audio in browsers with native HLS support
  (Safari). Elsewhere (e.g. Firefox) you get the video-only mp4, because
  reddit serves video and audio as separate streams and muxing them back
  together isn't practical here. A note appears under the video when this
  happens.
- Only the comments reddit includes in the initial page are shown. If a
  thread has more, you'll see "Showing N of M comments" with a link to the
  original page — "N more replies" are not lazily loaded.
- It depends on reddit's current `shreddit-*` element and attribute names.
  If reddit changes them, the script falls back to the normal page until
  the selectors are updated.

## Install

1. Install a userscript manager if you don't have one:
   - Firefox: [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/)
     or [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - Chrome/Edge: [Violentmonkey](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
     or [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
2. Open the extension's dashboard and choose "Create a new script" (or
   "+"), then delete the placeholder content.
3. Open `old-reddit-json.js` from this repo/download, copy its
   full contents, and paste them into the editor.
   - Alternatively, most managers let you drag-and-drop the `.js` file
     straight onto the dashboard to import it.
4. Save. The script activates automatically on `www.reddit.com` — no extra
   configuration needed.

## Updating

To install a new version, open the script in your userscript manager's
editor, select all, and paste in the updated file — then save.

## Uninstall / disable

Toggle the script off (or delete it) from your userscript manager's
dashboard at any time. You can also just visit any reddit URL with
`?orr=off` appended if you want to see the normal page without disabling
the script.
