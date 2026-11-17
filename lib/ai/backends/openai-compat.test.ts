import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LlmIncompleteResponseError } from "../errors";
import { PRESETS, runOpenAICompat } from "./openai-compat";

test("DeepSeek sends JSON mode only to JSON callers and rejects truncation", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestBodies.push(JSON.parse(body) as Record<string, unknown>);
      requestCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `test-${requestCount}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  requestCount === 1
                    ? '{"ok":true}'
                    : requestCount === 2
                      ? '{"ok":'
                      : "# 标题\n\n正文",
              },
              finish_reason: requestCount === 2 ? "length" : "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");

  const previousApiKey = process.env.DEEPSEEK_API_KEY;
  const previousCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-brief-test-"));
  process.env.DEEPSEEK_API_KEY = "test-key-openai-compat";
  process.chdir(tempDir);

  const cfg = {
    ...PRESETS.deepseek,
    defaultBaseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
  const jsonOptions = {
    systemPrompt: "Return JSON.",
    userPrompt: "Return an object.",
    jsonMode: true,
  };

  try {
    const result = await runOpenAICompat(jsonOptions, cfg);
    assert.equal(result.text, '{"ok":true}');

    await assert.rejects(
      runOpenAICompat(jsonOptions, cfg),
      LlmIncompleteResponseError,
    );

    const freeForm = await runOpenAICompat(
      { systemPrompt: "写一篇文章。", userPrompt: "题目：测试" },
      cfg,
    );
    assert.equal(freeForm.text, "# 标题\n\n正文");

    assert.equal(requestBodies.length, 3);
    for (const body of requestBodies.slice(0, 2)) {
      assert.deepEqual(body.response_format, { type: "json_object" });
    }
    assert.equal(requestBodies[2].response_format, undefined);
    for (const body of requestBodies) {
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.max_tokens, 8192);
    }
  } finally {
    process.chdir(previousCwd);
    if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousApiKey;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
