import assert from "node:assert/strict";
import test from "node:test";

import { DebugLogger } from "../dist/logger.js";

test("DebugLogger remove segredos do contexto", () => {
  const logger = new DebugLogger();
  logger.info("test", "sanitized", {
    authorization: "Bearer secret",
    nested: { accessToken: "secret", safe: "visible" },
  });

  const [event] = logger.getEvents();
  assert.equal(event.context.authorization, "[redacted]");
  assert.deepEqual(event.context.nested, {
    accessToken: "[redacted]",
    safe: "visible",
  });
});

test("DebugLogger não registra eventos comuns quando desativado", () => {
  const logger = new DebugLogger();
  logger.setEnabled(false);
  const countAfterToggle = logger.getEvents().length;
  logger.info("test", "ignored");

  assert.equal(logger.getEvents().length, countAfterToggle);
});

