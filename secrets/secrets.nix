# agenix recipients. Re-encrypt after editing: `agenix -r` (run from secrets/).
let
  # Your key(s): ~/.ssh/azure-todo.pub
  sam = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA azure-todo";
  # VM host key, after install: ssh-keyscan -t ed25519 <ip-or-tailnet-name>
  azure-todo = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA root@azure-todo";
  all = [
    sam
    azure-todo
  ];
in
{
  "todo.age".publicKeys = all; # PB_ENCRYPTION_KEY: 32 chars, e.g. `openssl rand -hex 16`
  "tailscale.age".publicKeys = all; # tskey-auth-… (reusable, pre-authorized, tag:server)
  "restic-env.age".publicKeys = all; # AZURE_ACCOUNT_NAME=…\nAZURE_ACCOUNT_KEY=…
  "restic-password.age".publicKeys = all; # restic repo password
}
