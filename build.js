const esbuild = require("esbuild");

async function build() {
  try {
    await esbuild.build({
      entryPoints: [
        "server.js",
        "redirect-server.js",
      ],
      outdir: "dist",
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      minify: false,
      sourcemap: false,
      keepNames: true,
      logLevel: "info",
      external: [
        // Native modules and things that shouldn't be bundled
        "mongodb-client-encryption",
      ],
    });

    console.log("✅ Build completed successfully.");
  } catch (err) {
    console.error("❌ Build failed.");
    console.error(err);
    process.exit(1);
  }
}

build();