import assert from "node:assert/strict";
import test from "node:test";

import type { ArticleBody } from "./article-body";
import { collectImageUrls, originalFromProxy, rewriteImageRefs } from "./assets";
import type { Asset } from "./assets";

function body(overrides: Partial<ArticleBody> = {}): ArticleBody {
  return {
    url: "https://example.com/a",
    title: "标题",
    ogImage: null,
    blocks: ["正文"],
    images: [],
    charCount: 2,
    ...overrides,
  };
}

test("collectImageUrls puts the cover first and drops duplicates", () => {
  const urls = collectImageUrls(
    body({
      ogImage: "https://cdn/cover.jpg",
      images: ["https://cdn/a.png", "https://cdn/cover.jpg", "https://cdn/b.webp"],
    }),
  );
  assert.deepEqual(urls, [
    "https://cdn/cover.jpg",
    "https://cdn/a.png",
    "https://cdn/b.webp",
  ]);
});

test("collectImageUrls keeps body order and respects the cap", () => {
  const images = Array.from({ length: 12 }, (_, i) => `https://cdn/${i}.jpg`);
  assert.equal(collectImageUrls(body({ images }), 5).length, 5);
  assert.equal(collectImageUrls(body({ images }))[0], "https://cdn/0.jpg");
});

test("collectImageUrls returns nothing for a figureless article", () => {
  assert.deepEqual(collectImageUrls(body()), []);
});

test("rewriteImageRefs swaps IMGn for the downloaded relative path", () => {
  const assets: Asset[] = [
    { ref: "IMG1", sourceUrl: "https://cdn/a.jpg", relPath: "assets/01.jpg" },
    { ref: "IMG2", sourceUrl: "https://cdn/b.png", relPath: "assets/02.png" },
  ];
  const md = "开头\n\n![现场照片](IMG1)\n\n中间\n\n![](IMG2)";
  assert.equal(
    rewriteImageRefs(md, assets),
    "开头\n\n![现场照片](assets/01.jpg)\n\n中间\n\n![](assets/02.png)",
  );
});

test("rewriteImageRefs leaves a ref with no downloaded file untouched", () => {
  const md = "![图](IMG1)";
  assert.equal(rewriteImageRefs(md, []), md);
});

test("originalFromProxy recovers the original behind a resize endpoint", () => {
  const proxied =
    "https://npr.brightspotcdn.com/dims3/default/strip/false/crop/4300x2418+0+16/resize/1400/quality/85/format/webp/?url=http%3A%2F%2Fnpr-brightspot.s3.amazonaws.com%2F51%2F97%2Fap.jpg";
  assert.equal(
    originalFromProxy(proxied),
    "https://npr-brightspot.s3.amazonaws.com/51/97/ap.jpg",
  );
  assert.equal(originalFromProxy("https://cdn.example.com/a.jpg"), null);
  assert.equal(originalFromProxy("not a url"), null);
  assert.equal(originalFromProxy("https://proxy.example.com/?url=%2Frelative.jpg"), null);
});

test("collectImageUrls treats two renditions of one original as one figure", () => {
  const first =
    "https://cdn.example.com/resize/1400/?url=https%3A%2F%2Fs3.example.com%2Fa.jpg";
  const second =
    "https://cdn.example.com/resize/800/?url=https%3A%2F%2Fs3.example.com%2Fa.jpg";
  const urls = collectImageUrls(
    body({ ogImage: first, images: [second, "https://cdn.example.com/b.jpg"] }),
  );
  assert.deepEqual(urls, [first, "https://cdn.example.com/b.jpg"]);
});
