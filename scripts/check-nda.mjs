// Fails when a client name we are not allowed to publish appears in a tracked file.
// The names themselves are never stored here — only their SHA-256 fingerprints.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BANNED = new Set([
  "893436e0f4b8f59366af620cf6bd02cea33bb673eee995a4ee0d477aeebe9156",
  "d74c21361df6f5d7468284bcd91822d7bfbe69350d748f93e40f0da2a4cc357b",
]);

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const hits = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // tracked but deleted in the working tree
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary

  buf.toString("utf8").split("\n").forEach((line, i) => {
    for (const word of line.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (!word) continue;
      const hash = createHash("sha256").update(word).digest("hex");
      if (BANNED.has(hash)) hits.push(`${file}:${i + 1}`);
    }
  });
}

if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("nda ok");
