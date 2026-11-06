#!/usr/bin/env python3
"""Aggregate harvested HN mentions into the site's video dataset.

Reads the per-month cache produced by harvest_hn.py, groups every mention by
YouTube video id, keeps the videos that Hacker News has recommended repeatedly
over the years, verifies each one against YouTube's oEmbed endpoint (title,
channel, availability) and writes hntube/data/videos.js + videos.json.

Usage:
    python3 build_data.py <hn_cache_dir> <oembed_cache_dir> [--min-mentions N]
                          [--min-years N] [--min-users N]
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import glob
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "data")

ID = r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])"
HOST = r"(?:youtube(?:-nocookie)?\.com|youtu\.be)\.?/"
VIDEO_PATTERNS = [
    re.compile(r"youtu\.be\.?/" + ID, re.I),
    re.compile(r"youtube(?:-nocookie)?\.com\.?/(?:embed|v|shorts|live|e)/" + ID, re.I),
    re.compile(r"youtube(?:-nocookie)?\.com\.?/watch/" + ID, re.I),
    # Any youtube-family URL carrying a v= parameter (watch, #/watch, attribution_link, ...).
    re.compile(HOST + r"[^\s\"'<>]*?[?&;#]v=" + ID, re.I),
]
# Any youtube-ish URL in free text (used to pull ids out of comment HTML).
URL_IN_TEXT = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)*(?:youtube(?:-nocookie)?\.com|youtu\.be)/[^\s\"'<>]+", re.I)


def video_ids_from_url(url):
    """Return the set of video ids referenced by one URL."""
    if not url:
        return set()
    candidates = [url]
    # attribution_link / redirect wrappers carry the real URL in a query param.
    try:
        q = urllib.parse.urlparse(url).query
        for key, val in urllib.parse.parse_qsl(q, keep_blank_values=True):
            if key in ("u", "q", "url", "continue") and "youtu" in val:
                candidates.append(val if val.startswith("http") else "https://www.youtube.com" + val)
    except ValueError:
        pass
    ids = set()
    for cand in candidates:
        cand = urllib.parse.unquote(cand)
        for pat in VIDEO_PATTERNS:
            for m in pat.finditer(cand):
                ids.add(m.group(1))
    return ids


def video_ids_from_comment(text):
    ids = set()
    text = html.unescape(text or "")
    for m in URL_IN_TEXT.finditer(text):
        ids |= video_ids_from_url(m.group(0))
    return ids


def load_hits(cache_dir):
    seen = set()
    stories, comments = [], []
    for path in sorted(glob.glob(os.path.join(cache_dir, "*.json"))):
        kind = os.path.basename(path).split("_")[0]
        with open(path) as f:
            for h in json.load(f):
                oid = h.get("objectID")
                if not oid or oid in seen:
                    continue
                seen.add(oid)
                (stories if kind == "story" else comments).append(h)
    return stories, comments


def year_of(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).year


def aggregate(stories, comments):
    videos = {}

    def bucket(vid):
        return videos.setdefault(vid, {"id": vid, "submissions": [], "commentMentions": []})

    for s in stories:
        for vid in video_ids_from_url(s.get("url")):
            bucket(vid)["submissions"].append({
                "id": s["objectID"],
                "title": s.get("title") or "",
                "points": s.get("points") or 0,
                "comments": s.get("num_comments") or 0,
                "author": s.get("author") or "",
                "date": s["created_at_i"],
            })
    for c in comments:
        for vid in video_ids_from_comment(c.get("comment_text")):
            bucket(vid)["commentMentions"].append({
                "id": c["objectID"],
                "author": c.get("author") or "",
                "date": c["created_at_i"],
                "storyId": c.get("story_id"),
                "storyTitle": c.get("story_title") or "",
            })

    for v in videos.values():
        v["submissions"].sort(key=lambda x: x["date"])
        v["commentMentions"].sort(key=lambda x: x["date"])
        items = v["submissions"] + v["commentMentions"]
        dates = [i["date"] for i in items]
        v["mentions"] = len(items)
        v["storyCount"] = len(v["submissions"])
        v["commentCount"] = len(v["commentMentions"])
        v["users"] = len({i["author"] for i in items if i["author"]})
        v["years"] = sorted({year_of(d) for d in dates})
        v["firstSeen"] = min(dates)
        v["lastSeen"] = max(dates)
        v["points"] = sum(s["points"] for s in v["submissions"])
        v["discussion"] = sum(s["comments"] for s in v["submissions"])
        v["topStory"] = max(v["submissions"], key=lambda s: (s["points"], s["comments"]), default=None)
    return videos


def oembed(vid, cache_dir):
    """Fetch (and cache) YouTube oEmbed metadata. Returns dict with 'status'."""
    path = os.path.join(cache_dir, vid + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    url = "https://www.youtube.com/oembed?" + urllib.parse.urlencode({
        "url": "https://www.youtube.com/watch?v=" + vid, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "hn-video-build/1.0"})
    result = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
                result = {"status": 200, "title": data.get("title"), "author": data.get("author_name"),
                          "authorUrl": data.get("author_url"), "thumbnail": data.get("thumbnail_url")}
                break
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                result = {"status": e.code}
                break
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(2 ** attempt)
    if result is None:
        raise RuntimeError("oEmbed failed repeatedly for " + vid)
    with open(path, "w") as f:
        json.dump(result, f)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("hn_cache")
    ap.add_argument("oembed_cache")
    ap.add_argument("--min-mentions", type=int, default=8)
    ap.add_argument("--min-years", type=int, default=4)
    ap.add_argument("--min-users", type=int, default=5)
    ap.add_argument("--max-comment-mentions", type=int, default=10,
                    help="keep only the N most recent comment mentions per video in the output")
    ap.add_argument("--topic", choices=["all", "ai"], default="all",
                    help="'ai' keeps only videos about artificial intelligence (see ai_filter.py)")
    ap.add_argument("--stats-only", action="store_true")
    args = ap.parse_args()

    stories, comments = load_hits(args.hn_cache)
    videos = aggregate(stories, comments)
    print(f"stories={len(stories)} comments={len(comments)} distinct videos={len(videos)}")

    def qualifies(v):
        return (v["mentions"] >= args.min_mentions and len(v["years"]) >= args.min_years
                and v["users"] >= args.min_users)

    selected = [v for v in videos.values() if qualifies(v)]
    print(f"qualifying videos={len(selected)}")
    if args.stats_only:
        for mm in (3, 4, 5, 6, 8, 10):
            for my in (2, 3, 4):
                n = sum(1 for v in videos.values()
                        if v["mentions"] >= mm and len(v["years"]) >= my and v["users"] >= args.min_users)
                print(f"  mentions>={mm:2d} years>={my}: {n}")
        return

    os.makedirs(args.oembed_cache, exist_ok=True)
    out, dropped = [], {}
    ordered = sorted(selected, key=lambda v: -v["mentions"])
    with ThreadPoolExecutor(max_workers=8) as pool:
        metas = list(pool.map(lambda v: oembed(v["id"], args.oembed_cache), ordered))
    for v, meta in zip(ordered, metas):
        if meta["status"] != 200 or not meta.get("title"):
            dropped[meta["status"]] = dropped.get(meta["status"], 0) + 1
            continue
        v = dict(v)
        v["title"] = meta["title"]
        v["channel"] = meta.get("author") or ""
        v["channelUrl"] = meta.get("authorUrl") or ""
        v["thumbnail"] = f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg"
        # commentCount keeps the full number; the list itself is trimmed for page weight.
        v["commentMentions"] = v["commentMentions"][-args.max_comment_mentions:]
        out.append(v)
    print(f"available={len(out)} dropped by oEmbed status={dropped}")
    if args.topic == "ai":
        sys.path.insert(0, HERE)
        import ai_filter
        out = [v for v in out if ai_filter.is_ai(v)]
        print(f"about AI={len(out)}")

    out.sort(key=lambda v: (-v["mentions"], -v["points"], v["firstSeen"]))
    payload = {
        "builtAt": int(time.time()),
        "topic": args.topic,
        "criteria": {"minMentions": args.min_mentions, "minYears": args.min_years, "minUsers": args.min_users},
        "source": {"stories": len(stories), "comments": len(comments), "distinctVideos": len(videos),
                   "qualifying": len(selected), "available": len(out) if args.topic == "all" else None,
                   "onTopic": len(out),
                   "from": min(h["created_at_i"] for h in stories + comments),
                   "to": max(h["created_at_i"] for h in stories + comments)},
        "videos": out,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    stem = "videos" if args.topic == "all" else "videos-" + args.topic
    with open(os.path.join(OUT_DIR, stem + ".json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(OUT_DIR, stem + ".js"), "w") as f:
        f.write("// Generated by scripts/build_data.py. Do not edit by hand.\n")
        f.write("window.HNTUBE_DATA = ")
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    print("wrote", os.path.join(OUT_DIR, stem + ".js"))


if __name__ == "__main__":
    main()
