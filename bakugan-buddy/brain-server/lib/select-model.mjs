import fs from "node:fs";

const models = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cfg = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const tier = models[cfg.model];
if (!tier) {
  console.error(`brain.json model is unknown: ${cfg.model}`);
  process.exit(2);
}

function sh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

process.stdout.write(
  [
    `MODEL_ID=${sh(cfg.model)}`,
    `MODEL_FILE=${sh(tier.file)}`,
    `MODEL_CTX=${sh(tier.context)}`,
    `MODEL_WARN=${tier.warn ? "1" : "0"}`,
    `MODEL_LABEL=${sh(tier.label)}`,
    `MODEL_RAM=${sh(tier.llamaGb)}`,
    "",
  ].join("\n"),
);
