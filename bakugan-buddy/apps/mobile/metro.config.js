const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [packageRoot];
if (!config.resolver.assetExts.includes("glb")) {
  config.resolver.assetExts.push("glb");
}

const previousResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "bakugan-on-device-brain") {
    const onDevice = process.env.EXPO_PUBLIC_ON_DEVICE_BRAIN === "1";
    const filePath = path.join(
      projectRoot,
      onDevice ? "src/room/brain/onDeviceLlama.ts" : "src/room/brain/onDeviceStub.ts",
    );
    return { type: "sourceFile", filePath };
  }
  if (typeof previousResolve === "function") {
    return previousResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
