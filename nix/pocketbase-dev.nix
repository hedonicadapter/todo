# Dev runner: pocketbase --dev + vite HMR. Same as ./dev.sh, with deps on PATH.
{
  writeShellApplication,
  pocketbase,
  nodejs,
}:
writeShellApplication {
  name = "todo-dev";
  runtimeInputs = [
    pocketbase
    nodejs
  ];
  text = ''
    exec ${../dev.sh} "$@"
  '';
}
