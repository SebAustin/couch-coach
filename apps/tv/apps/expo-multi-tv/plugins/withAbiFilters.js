const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Fire TV devices are ARM. Prebuilt dependencies (Hermes, etc.) ship x86 and x86_64 .so files too; an
 * `ndk.abiFilters` entry in defaultConfig drops them from the APK. Re-applied on every prebuild.
 */
const ABIS = ["armeabi-v7a", "arm64-v8a"];
const MARKER = "// couch-coach: abiFilters";

module.exports = function withAbiFilters(config) {
  return withAppBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (!src.includes(MARKER)) {
      const filters = ABIS.map((a) => `"${a}"`).join(", ");
      cfg.modResults.contents = src.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ${MARKER}\n        ndk { abiFilters ${filters} }`
      );
    }
    return cfg;
  });
};
