const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [packageRoot];
if (!config.resolver.assetExts.includes("glb")) {
  config.resolver.assetExts.push("glb");
}

module.exports = config;
