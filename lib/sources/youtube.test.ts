import assert from "node:assert/strict";
import test from "node:test";

import { parseYoutubeFeed } from "./youtube";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Test Channel</title>
  <published>2006-01-01T00:00:00+00:00</published>
  <entry>
    <title>Video One</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaa"/>
    <published>2026-11-14T10:00:00+00:00</published>
    <media:group>
      <media:description>First video description</media:description>
      <media:statistics views="1234567"/>
    </media:group>
  </entry>
  <entry>
    <title>Entry without a link</title>
    <published>2026-11-13T10:00:00+00:00</published>
  </entry>
</feed>`;

test("parseYoutubeFeed reads title, url, date, description and view count", () => {
  const items = parseYoutubeFeed(FEED, "youtube-test", "tech");
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.title, "Video One");
  assert.equal(item.url, "https://www.youtube.com/watch?v=aaa");
  assert.equal(item.excerpt, "First video description");
  assert.equal(item.meta, "▶ 1.2M");
  assert.equal(item.publishedAt?.toISOString(), "2026-11-14T10:00:00.000Z");
  assert.equal(item.sourceId, "youtube-test");
  assert.equal(item.category, "tech");
});

test("parseYoutubeFeed drops entries without a link instead of inventing one", () => {
  const items = parseYoutubeFeed(FEED, "youtube-test", "tech");
  assert.ok(items.every((i) => i.title !== "Entry without a link"));
});

test("parseYoutubeFeed does not read the feed-level published date as a video date", () => {
  const items = parseYoutubeFeed(FEED, "youtube-test", "tech");
  assert.ok(items.every((i) => i.publishedAt?.getUTCFullYear() !== 2006));
});
