# `todo`: pocketbase with frontend and migrations baked in.
# `todo-serve`: what `nix run` does — serve on :8090, data in ./pb_data.
{
  lib,
  writeShellApplication,
  symlinkJoin,
  pocketbase,
  frontend,
}:
let
  migrations = ../pb_migrations;
  todo = writeShellApplication {
    name = "todo";
    runtimeInputs = [ pocketbase ];
    text = ''
      exec pocketbase \
        --dir="''${PB_DATA_DIR:-./pb_data}" \
        --migrationsDir=${migrations} \
        --publicDir=${frontend} \
        "$@"
    '';
  };
  serve = writeShellApplication {
    name = "todo-serve";
    runtimeInputs = [ todo ];
    text = ''
      exec todo serve --http="''${PB_HTTP:-127.0.0.1:8090}" "$@"
    '';
  };
in
symlinkJoin {
  name = "todo-${pocketbase.version}";
  paths = [
    todo
    serve
  ];
  passthru = {
    inherit frontend pocketbase;
  };
  meta = {
    description = "Synced todo list (PocketBase + PWA)";
    mainProgram = "todo-serve";
    license = lib.licenses.mit;
  };
}
