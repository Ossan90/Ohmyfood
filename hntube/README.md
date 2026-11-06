# Kazak — videos Hacker News keeps recommending

A YouTube-style static site restricted to the videos that Hacker News has
linked repeatedly, by different people, in different years. Nothing is
hand-picked: inclusion is decided entirely by HN's own history.

Open `index.html` directly in a browser or serve the folder with any static
server. No build step, no dependencies, no API keys.

## How a video gets in

1. `scripts/harvest_hn.py` crawls the public [HN Algolia API](https://hn.algolia.com/api)
   for every story whose URL is a YouTube link and every comment containing one,
   month by month since 2006. Windows that hit Algolia's 1,000-hit cap are
   split recursively, and each month is cached so the crawl is resumable.
2. `scripts/build_data.py` groups every mention by YouTube video id and keeps a
   video only if it was linked at least 5 times, in at least 3 different
   calendar years, by at least 3 different users (thresholds are flags).
3. Each candidate is checked against YouTube's oEmbed endpoint. Deleted or
   private videos are dropped; the title and channel come from YouTube.
4. The result is written to `data/videos.js` (loaded by the page) and
   `data/videos.json` (same payload for other consumers).

## AI edition (`ai/`)

`ai/index.html` serves the same site restricted to videos about artificial
intelligence, from `data/videos-ai.js`. The sidebar links the two editions.

- A video is about AI when its YouTube title, its channel, or one of the HN
  headlines it was submitted under matches the terms in `scripts/ai_filter.py`
  (acronyms such as AI, LLM and GPT are matched as whole, case-sensitive words).
- The bar is lower than the general edition (5 mentions, 3 years, 3 users),
  because most AI videos are recent.
- The keyword matches were reviewed by hand: `ALWAYS` and `NEVER` in
  `ai_filter.py` hold the overrides, each with a one-line reason.

## Rebuilding the data

```sh
python3 scripts/harvest_hn.py /path/to/hn-cache          # ~15 min first run, incremental afterwards
python3 scripts/build_data.py /path/to/hn-cache /path/to/oembed-cache
python3 scripts/build_data.py /path/to/hn-cache /path/to/oembed-cache \
    --topic ai --min-mentions 5 --min-years 3 --min-users 3   # AI edition
```

Python 3.9+ standard library only.

## Pages

- `#/` home grid, sortable (most recommended, most HN points, most years,
  oldest classics, recently resurfaced) and filterable by the decade a video
  first appeared on HN.
- `#/watch/<id>` embedded player plus the full HN history of the video: every
  submission with points and comments, and every comment that recommended it,
  all linked back to news.ycombinator.com.
- `#/channel/<name>` all catalogued videos from one YouTube channel.
- `#/search/<query>` search over titles, channels and HN headlines.
- `#/about` methodology, thresholds and dataset counts.

Press `/` to focus search. Dark mode follows the system and can be toggled.

## Known limits

- Durations and view counts are not shown; YouTube does not expose them
  without an API key.
- Only youtube.com, youtu.be and youtube-nocookie.com links are recognised.
