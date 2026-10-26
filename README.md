# todo

Synced todo list. PocketBase backend, vanilla TypeScript PWA, packaged as a Nix flake,
hosted on one NixOS VM in Azure. See [PLAN.md](PLAN.md) for the full design.

## Run locally

```
nix run github:hedonicadapter/todo        # http://127.0.0.1:8090, data in ./pb_data
```

First start: open `http://127.0.0.1:8090/_/`, create the superuser, then add a record in
the `users` collection (public signup is disabled). Sign in to the app with that user.

## Develop

```
nix develop
./dev.sh            # pocketbase --dev on :8090 + vite HMR on :5173 (same as `nix run .#dev`)
```

Schema changes: edit in the admin UI, then snapshot and commit:

```
pocketbase migrate collections --dir ./pb_data --migrationsDir ./pb_migrations
```

Migrations in `pb_migrations/` apply automatically on service start.

Frontend deps: after changing `frontend/package.json`, run `npm install` in `frontend/`
and update `npmDepsHash` in `nix/frontend.nix` (`nix build .#frontend` prints the right hash).

## Layout

```
flake.nix            packages, apps, nixosModules.default, nixosConfigurations.azure
pb_migrations/       PocketBase JS migrations (schema + API rules)
frontend/            Vite + TS + pocketbase SDK; public/ has manifest, sw.js, icons
nix/module.nix       services.todo.*
nix/frontend.nix     buildNpmPackage → static dir served by PocketBase
nix/todo.nix         `todo` / `todo-serve` wrappers (what `nix run` does)
hosts/azure/         VM config: disko, tailscale, optional caddy, restic → Blob
secrets/             agenix recipients + encrypted secrets
```

## Deploy (Azure)

Do the first install from the NixOS PC, using the `az` from `nix develop` for everything.
Mixing `az` versions on one `~/.azure` breaks its msal cache; `rm ~/.azure/msal_http_cache.bin`
if you see a pickle `AttributeError`. A Mac works for later deploys once it has a
Linux builder (`nix.linux-builder.enable = true` in nix-darwin); the VM is x86_64-linux and
never builds anything itself.

### 1. Keys

```
ssh-keygen -t ed25519 -N '' -C azure-todo -f ~/.ssh/azure-todo          # your key
mkdir -p /tmp/azure-todo/etc/ssh
ssh-keygen -t ed25519 -N '' -C root@azure-todo \
  -f /tmp/azure-todo/etc/ssh/ssh_host_ed25519_key                        # VM host key, pre-generated
```

Put `~/.ssh/azure-todo.pub` in `hosts/azure/default.nix` (`authorizedKeys`) and as `sam` in
`secrets/secrets.nix`; put `/tmp/azure-todo/etc/ssh/ssh_host_ed25519_key.pub` as `azure-todo`.
Pre-generating the host key lets the VM decrypt its secrets on first boot.

### 2. Secrets

```
cd secrets
agenix -i ~/.ssh/azure-todo -e todo.age             # openssl rand -hex 16
agenix -i ~/.ssh/azure-todo -e tailscale.age        # tskey-auth-… (reusable, pre-authorized, tag:server)
agenix -i ~/.ssh/azure-todo -e restic-password.age  # any long string, keep a copy
agenix -i ~/.ssh/azure-todo -e restic-env.age       # AZURE_ACCOUNT_NAME=…  AZURE_ACCOUNT_KEY=…  (two lines)
cd ..
```

Blob storage for the backups (name must be globally unique, lowercase):

```
az storage account create -g rg-todo -n sttodobackups -l swedencentral --sku Standard_LRS --kind StorageV2
az storage container create --account-name sttodobackups -n todo-backups
az storage account keys list -g rg-todo -n sttodobackups --query '[0].value' -o tsv
```

### 3. VM

```
az group create -n rg-todo -l swedencentral
az vm create -g rg-todo -n azure-todo \
  --image Ubuntu2404 --size Standard_B2ats_v2 \
  --os-disk-size-gb 32 --storage-sku StandardSSD_LRS \
  --admin-username nixos --ssh-key-values ~/.ssh/azure-todo.pub \
  --public-ip-sku Standard --nsg-rule SSH
```

Note the public IP.

### 4. Install NixOS

```
nix develop
nixos-anywhere --flake .#azure --extra-files /tmp/azure-todo -i ~/.ssh/azure-todo nixos@<ip>
```

kexec, disko, install, reboot into NixOS. If kexec dies for lack of RAM (B2ats_v2 has 1 GiB):
`az vm resize -g rg-todo -n azure-todo --size Standard_B2als_v2`, install, resize back.

### 5. First boot

```
ssh -i ~/.ssh/azure-todo root@<ip> systemctl status todo tailscaled tailscale-serve
```

App: `https://azure-todo.<tailnet>.ts.net`. Create the superuser via the one-time link
(`journalctl -u todo | grep pbinstal`, swap the host for the tailnet URL) or:

```
ssh root@azure-todo   # over the tailnet; Tailscale SSH is on
PB_ENCRYPTION_KEY=$(cat /run/agenix/todo) sudo -u todo --preserve-env=PB_ENCRYPTION_KEY \
  pocketbase --dir /var/lib/todo --encryptionEnv PB_ENCRYPTION_KEY superuser upsert you@example.com 'pw'
```

Then in the dashboard create your app user (Collections → users). Finally close the public
port: `az network nsg rule delete -g rg-todo --nsg-name azure-todoNSG -n default-allow-ssh`.

### Afterwards

Every change: `nix run .#deploy` (builds locally, pushes the closure, switches). Override the
target with `TODO_TARGET=root@<ip>`. Migrations apply on service restart. Backups run nightly
at 03:17; `restic -r azure:todo-backups:/ snapshots` on the VM to check.

## Keyboard

`n` new · `j`/`k` select · `space` toggle · `e`/`Enter` edit · `t` due · `r` repeat · `d` delete · `J`/`K` reorder · `Esc` clear

## Repeats and late

A todo can repeat (daily, every other day, weekdays, weekly, monthly, …; stored as an RRULE
subset in `repeat`). Completing a repeating todo doesn't mark it done: `due` moves to the next
occurrence *after today* (the completion date), so a late task catches up in one tick and an
early one still waits a full period. Clear the repeat to finish it for good.

Open todos past their due date get a red "N days late" pill and a red edge.
