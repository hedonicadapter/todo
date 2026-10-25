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

One-time, see PLAN.md for the reasoning:

1. `az vm create …` (commands in PLAN.md). Note the public IP.
2. Put your public key in `hosts/azure/default.nix` and `secrets/secrets.nix`.
3. Create secrets (from `secrets/`): `agenix -e todo.age` (32-char key, e.g.
   `openssl rand -hex 16`), `tailscale.age`, `restic-env.age`, `restic-password.age`.
4. `nixos-anywhere --flake .#azure root@<ip>` — kexec installer, disko, install.
   If kexec runs out of memory on B2ats_v2, install on B1ms and resize down.
5. `ssh-keyscan -t ed25519 <ip>` → add the host key to `secrets/secrets.nix`, `agenix -r`,
   then `nix run .#deploy` so the VM can decrypt its secrets.
6. Remove the SSH rule from the NSG; SSH goes over the tailnet from now on.

Every later change: `nix run .#deploy` (builds on your machine, pushes the closure).
On a Mac this needs a Linux builder (`nix.linux-builder` in nix-darwin) since the VM
is x86_64-linux and never builds anything itself.

App URL: `https://azure-todo.<tailnet>.ts.net`. Install as PWA once per device.

## Keyboard

`n` new · `j`/`k` select · `space` toggle · `e`/`Enter` edit · `d` delete · `J`/`K` reorder · `Esc` clear
