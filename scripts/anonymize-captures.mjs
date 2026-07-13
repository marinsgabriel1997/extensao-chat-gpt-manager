import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const files = process.argv.slice(2);

if (files.length === 0) {
  throw new Error("Informe pelo menos um arquivo JSON ou JavaScript.");
}

const identifiers = new Map();
let identifierSequence = 0;

for (const file of files) {
  const extension = extname(file).toLowerCase();
  const source = await readFile(file, "utf8");

  if (extension === ".json") {
    const parsed = JSON.parse(source);
    const anonymized = anonymizeJson(parsed);
    await writeFile(file, `${JSON.stringify(anonymized, null, 2)}\n`, "utf8");
    continue;
  }

  if (extension === ".js") {
    await writeFile(file, anonymizeJavaScript(source), "utf8");
    continue;
  }

  throw new Error(`Formato não suportado: ${file}`);
}

function anonymizeJson(value, key = "") {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return isTimestampKey(key) ? 1700000000 : value;
  }

  if (typeof value === "string") {
    return anonymizeString(value, key);
  }

  if (Array.isArray(value)) {
    if (key === "parts") {
      return value.map(() => "[CONTEUDO_REMOVIDO]");
    }
    if (key === "safe_urls" || key === "blocked_urls") {
      return value.map(() => "https://example.invalid/");
    }
    return value.map((item) => anonymizeJson(item, key));
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const anonymizedKey = key === "mapping" ? anonymizeIdentifier(childKey) : childKey;
    result[anonymizedKey] = anonymizeJson(childValue, childKey);
  }
  return result;
}

function anonymizeString(value, key) {
  if (isContentKey(key)) {
    return `[${key.toUpperCase()}_REMOVIDO]`;
  }

  if (isTimestampKey(key)) {
    return "1700000000";
  }

  if (isIdentifierKey(key) || looksLikeIdentifier(value)) {
    return anonymizeIdentifier(value);
  }

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [TOKEN_REMOVIDO]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "usuario@example.invalid")
    .replace(/https?:\/\/[^\s"']+/gi, "https://example.invalid/");
}

function anonymizeJavaScript(source) {
  return source
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [TOKEN_REMOVIDO]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "usuario@example.invalid")
    .replace(/g-p-[a-zA-Z0-9-]+/g, (value) => anonymizeIdentifier(value))
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (value) => anonymizeIdentifier(value),
    )
    .replace(
      /("x-oai-is-client-observation"\s*:\s*)"[^"]+"/g,
      '$1"[OBSERVACAO_REMOVIDA]"',
    )
    .replace(/([?&]cursor=)[^&"\\]+/g, "$1[CURSOR_REMOVIDO]");
}

function anonymizeIdentifier(value) {
  if (value === "all" || value === "client-created-root") {
    return value;
  }

  let placeholder = identifiers.get(value);
  if (placeholder === undefined) {
    identifierSequence += 1;
    placeholder = `ID_ANONIMO_${String(identifierSequence).padStart(4, "0")}`;
    identifiers.set(value, placeholder);
  }
  return placeholder;
}

function looksLikeIdentifier(value) {
  return (
    /^g-p-[a-zA-Z0-9-]+$/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^(user-|authsess_)/.test(value)
  );
}

function isIdentifierKey(key) {
  return (
    key === "id" ||
    key === "parent" ||
    key === "current_node" ||
    key === "current_node_id" ||
    key === "conversation_id" ||
    key === "conversation_template_id" ||
    key === "gizmo_id" ||
    key === "message_id" ||
    key === "request_id" ||
    key === "turn_exchange_id" ||
    key === "working_turn_id" ||
    key === "workspace_id" ||
    key === "sugar_item_id" ||
    key.endsWith("_id")
  );
}

function isContentKey(key) {
  return (
    key === "title" ||
    key === "snippet" ||
    key === "description" ||
    key === "user_profile" ||
    key === "user_instructions" ||
    key === "about_user_message" ||
    key === "email" ||
    key === "name" ||
    key === "given_name" ||
    key === "family_name" ||
    key === "picture" ||
    key === "cursor" ||
    key === "content"
  );
}

function isTimestampKey(key) {
  return key.endsWith("_time") || key.endsWith("_at");
}
