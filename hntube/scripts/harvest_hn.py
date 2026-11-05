#!/usr/bin/env python3
"""Harvest every Hacker News story and comment that links to a YouTube video.

Uses the public HN Algolia API (https://hn.algolia.com/api). Algolia returns at
most 1000 hits per query, so the crawl walks calendar months and recursively
halves any window that fills up. Results are cached per (query, tag, month) as
JSON files so the crawl is resumable and cheap to re-run.

Usage:
    python3 harvest_hn.py <cache_dir>
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://hn.algolia.com/api/v1/search_by_date"
HN_EPOCH = int(dt.datetime(2006, 10, 1, tzinfo=dt.timezone.utc).timestamp())
STORY_ATTRS = "title,url,points,num_comments,author,created_at_i,objectID"
COMMENT_ATTRS = "comment_text,story_id,story_title,author,created_at_i,objectID,parent_id"
JOBS = [
    # (query, tag, extra params)
    ("youtube", "story", {"restrictSearchableAttributes": "url", "attributesToRetrieve": STORY_ATTRS}),
    ("youtu.be", "story", {"restrictSearchableAttributes": "url", "attributesToRetrieve": STORY_ATTRS}),
    ("youtube", "comment", {"attributesToRetrieve": COMMENT_ATTRS}),
    ("youtu.be", "comment", {"attributesToRetrieve": COMMENT_ATTRS}),
]
PAGE = 1000
MIN_WINDOW = 600  # seconds; never split below this
REQUESTS = 0


def fetch(params, attempt=0):
    global REQUESTS
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "hn-video-harvest/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            REQUESTS += 1
            return json.load(r)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
        if attempt >= 6:
            raise
        wait = 2 ** attempt
        print(f"  retry in {wait}s: {e}", file=sys.stderr, flush=True)
        time.sleep(wait)
        return fetch(params, attempt + 1)


def window(query, tag, extra, start, end):
    """Return all hits in [start, end). Splits the window when it fills up."""
    params = dict(extra)
    params.update({
        "query": query,
        "tags": tag,
        "hitsPerPage": PAGE,
        "numericFilters": f"created_at_i>={start},created_at_i<{end}",
    })
    data = fetch(params)
    hits = data.get("hits", [])
    time.sleep(0.12)
    if len(hits) >= PAGE and end - start > MIN_WINDOW:
        mid = (start + end) // 2
        return window(query, tag, extra, start, mid) + window(query, tag, extra, mid, end)
    if len(hits) >= PAGE:
        print(f"  WARNING: window {start}-{end} still full at minimum size", file=sys.stderr, flush=True)
    return hits


def months():
    now = dt.datetime.now(dt.timezone.utc)
    y, m = 2006, 10
    while True:
        start = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = dt.datetime(ny, nm, 1, tzinfo=dt.timezone.utc)
        if start > now:
            return
        yield f"{y:04d}-{m:02d}", int(start.timestamp()), int(end.timestamp()), end > now
        y, m = ny, nm


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    t0 = time.time()
    for query, tag, extra in JOBS:
        for label, start, end, is_current in months():
            path = os.path.join(cache, f"{tag}_{query}_{label}.json")
            # The current month is always refreshed; completed months are cached.
            if os.path.exists(path) and not is_current:
                continue
            hits = window(query, tag, extra, start, end)
            with open(path + ".tmp", "w") as f:
                json.dump(hits, f)
            os.replace(path + ".tmp", path)
            print(f"{tag:7s} {query:9s} {label} hits={len(hits):5d} requests={REQUESTS} elapsed={time.time()-t0:.0f}s", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
