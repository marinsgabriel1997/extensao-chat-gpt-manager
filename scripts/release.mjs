// Publica uma release da extensão: valida o repositório, gera o build limpo,
// empacota o .zip instalável e cria a tag e a release no GitHub com as notas
// da versão extraídas do CHANGELOG.md.
//
// Uso:
//   npm run release              publica a versão atual do package.json
//   npm run release -- --dry-run gera o .zip e mostra as notas, sem publicar

import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const dryRun = process.argv.includes("--dry-run");

// Arquivos que o Chrome precisa para carregar a extensão. `dist/` entra
// inteiro, depois de um build feito a partir de uma pasta vazia.
const STATIC_FILES = [
  "manifest.json",
  "sidepanel.html",
  "icon/icon-16.png",
  "icon/icon-32.png",
  "icon/icon-48.png",
  "icon/icon-128.png",
];

// Data fixa nas entradas do .zip, para o pacote não variar a cada build.
// Formato DOS: (ano - 1980) << 9 | mês << 5 | dia.
const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;

if (manifest.version !== version) {
  fail(`Versões divergentes: package.json ${version}, manifest.json ${manifest.version}.`);
}

const notes = extractReleaseNotes(await readFile("CHANGELOG.md", "utf8"), version);

if (!dryRun) {
  checkRepository(tag);
}

await rm("dist", { recursive: true, force: true });
runNpm(["run", "check"]);

const distFiles = (await readdir("dist")).map((name) => `dist/${name}`);
const zipPath = join("release", `chatgpt-manager-${tag}.zip`);
await mkdir("release", { recursive: true });
await writeFile(zipPath, await createZip([...STATIC_FILES, ...distFiles]));
console.log(`\nPacote gerado: ${zipPath}`);

if (dryRun) {
  console.log(`\nNotas da release ${tag}:\n\n${notes}`);
  process.exit(0);
}

const notesPath = join("release", `notes-${tag}.md`);
await writeFile(notesPath, notes);

run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
run("git", ["push", "origin", tag]);
run("gh", ["release", "create", tag, zipPath, "--title", tag, "--notes-file", notesPath, "--verify-tag"]);
console.log(`\nRelease ${tag} publicada.`);

function checkRepository(tag) {
  if (output("git", ["status", "--porcelain"]) !== "") {
    fail("Há alterações não commitadas. Faça o commit antes de publicar.");
  }

  if (output("git", ["branch", "--show-current"]) !== "main") {
    fail("Releases são publicadas somente a partir da branch main.");
  }

  run("git", ["fetch", "--tags", "origin"]);

  if (output("git", ["tag", "--list", tag]) !== "") {
    fail(`A tag ${tag} já existe. Atualize a versão antes de publicar.`);
  }

  if (output("git", ["rev-parse", "HEAD"]) !== output("git", ["rev-parse", "origin/main"])) {
    fail("A main local não está sincronizada com origin/main. Faça push ou pull antes de publicar.");
  }
}

// Retorna o corpo da seção `## [versão]` do changelog, sem o título.
function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));

  if (start === -1) {
    fail(`CHANGELOG.md não tem uma seção para ${version}.`);
  }

  const end = lines.findIndex((line, index) => index > start && /^## \[|^\[[^\]]+\]: /.test(line));
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();

  if (body === "") {
    fail(`A seção ${version} do CHANGELOG.md está vazia.`);
  }

  return `${body}\n`;
}

// Monta um .zip (deflate) sem dependências externas, para funcionar também
// em máquinas sem o utilitário `zip`, como o Windows.
async function createZip(paths) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const path of paths) {
    const data = await readFile(path);
    const compressed = deflateRawSync(data);
    const name = Buffer.from(path, "utf8");
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // versão necessária para extrair
    localHeader.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    localHeader.writeUInt16LE(8, 8); // método deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, name, compressed);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

// Executa o npm pelo mesmo Node, via `npm_execpath`, porque no Windows o
// comando `npm` é um script .cmd que só rodaria através de um shell.
function runNpm(args) {
  const npmCli = process.env.npm_execpath;

  if (!npmCli) {
    fail("Execute pelo npm: npm run release.");
  }

  execFileSync(process.execPath, [npmCli, ...args], { stdio: "inherit" });
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}
