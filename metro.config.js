const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite', 'wasm');
// Development artifacts contain external model checkouts and are never app modules.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  /[/\\]\.local-data[/\\].*/,
  /[/\\]\.tools[/\\].*/,
];

module.exports = config;
