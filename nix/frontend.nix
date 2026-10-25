# Builds frontend/ → static dir served by PocketBase as --publicDir.
{
  lib,
  buildNpmPackage,
}:
buildNpmPackage (finalAttrs: {
  pname = "todo-frontend";
  version = (lib.importJSON ../frontend/package.json).version;
  src = lib.fileset.toSource {
    root = ../frontend;
    fileset = lib.fileset.unions [
      ../frontend/package.json
      ../frontend/package-lock.json
      ../frontend/index.html
      ../frontend/tsconfig.json
      ../frontend/vite.config.ts
      ../frontend/src
      ../frontend/public
    ];
  };
  npmDepsHash = "sha256-xcsGO4oL0Lz0Z/ao2MlQNScwzcHkOJvGs+mM8g8Uhwg=";
  # Keep build hermetic and quiet.
  env.CI = "true";
  installPhase = ''
    runHook preInstall
    cp -r dist "$out"
    runHook postInstall
  '';
  meta = {
    description = "todo PWA frontend";
    license = lib.licenses.mit;
  };
})
