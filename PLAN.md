# todo — project plan

Synced todo list. v1 = web PWA. TickTick-widget feel later (native/desktop clients).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | PocketBase (nixpkgs) | 1 binary, SQLite, realtime SSE, auth, admin UI, migrations |
| Frontend | Vanilla TS + `pocketbase` JS SDK, Vite | No framework overhead for a list; swap later if needed |
| Realtime | PB `collection.subscribe('*')` | Push on every create/update/delete |
| Packaging | Nix flake | `nix run` locally, `nixosModules.default` for host |
| Hosting v1 | NixOS VM on Azure (B2ats_v2, managed disk) | SQLite needs a real disk, not Azure Files; see Infra |

## Repo layout

```
flake.nix
pb_migrations/
  1_init_todos.js          # collection schema + rules, checked in
frontend/
  index.html
  src/main.ts
  src/pb.ts                # client singleton, auth
  src/store.ts             # list state + subscribe
  src/ui.ts                # render, optimistic updates
  manifest.webmanifest
  sw.js                    # cache shell only, no offline writes in v1
  package.json, vite.config.ts
nix/
  module.nix               # NixOS module (services.todo.*)
  frontend.nix             # buildNpmPackage → pb_public
  pocketbase-dev.nix       # dev runner
hosts/azure/
  default.nix              # nixosConfigurations.azure: todo module, azure agent, tailscale/caddy
  disko.nix                # /dev/disk/azure/root, GPT, ESP + ext4
secrets/
  todo.age, tailscale.age  # agenix
dev.sh                     # pb serve --dev + vite, same thing `nix run .#dev` does
```

## Data model

Collection `todos`:

| Field | Type | Notes |
|---|---|---|
| `title` | text, required | |
| `done` | bool | |
| `due` | date, optional | |
| `order` | number | manual sort; float, insert between |
| `owner` | relation → users | set server-side |
| `created`/`updated` | system | |

Rules (all): `@request.auth.id != "" && owner = @request.auth.id`. Create rule sets `owner` from auth via hook or `@request.data.owner = @request.auth.id`.

Single user in v1. Rules exist so v2 sharing is a rule change, not a migration.

## Frontend behaviour (v1)

- Login screen → PB email/password, token in localStorage (SDK default).
- List: sorted by `done asc, order asc, due asc`.
- Add: input at top, Enter creates. Optimistic insert, reconcile on SSE echo.
- Toggle: checkbox → `update({done})`. Optimistic.
- Edit title inline (click), due via native `<input type=date>`.
- Delete: swipe / `×`.
- Keyboard: `n` new, `j/k` move, `space` toggle, `d` delete — widget feel on desktop.
- Reconnect: SDK auto-resubscribes; on reconnect do a full `getFullList` to catch gaps.
- Theme: system dark/light, no settings.

Non-goals v1: offline writes, recurring tasks, subtasks, lists/projects, notifications, sharing.

## Flake outputs

```
packages.<sys>.frontend      # pb_public dir
packages.<sys>.default       # pocketbase wrapper: --publicDir frontend --migrationsDir
apps.<sys>.default           # nix run → local server on :8090, data in ./pb_data
apps.<sys>.dev               # pb --dev + vite HMR
nixosModules.default         # services.todo
nixosConfigurations.azure    # the VM
apps.<sys>.deploy            # nixos-rebuild switch --flake .#azure --target-host root@azure-todo
devShells.<sys>.default      # node, pocketbase, typescript, azure-cli, nixos-anywhere
checks.<sys>.frontend-build
```

`nix run github:<you>/todo` must work from any machine with Nix = instant local instance.

## Dev loop

1. `nix develop` → `./dev.sh` (`nix run .#dev`).
2. Edit schema in admin UI → `pocketbase migrate collections` snapshots to `pb_migrations/` → commit.
3. Frontend HMR via Vite proxying `/api` → 8090.

## Infra / deploy (Azure)

Self-hosting repo: VM config and secrets live here. Dotfiles untouched (Tailscale client at most).

### Why a VM, not Container Apps

PocketBase = SQLite. ACA/ACI only offer Azure Files volumes. SQLite byte-range locks fail over SMB; workaround is `nobrl`, which disables locking and risks corruption. NFS shares need VNet + premium storage + managed env — more moving parts than a VM, and the Nix module gets thrown away. VM + managed disk: SQLite fine, ~€5/mo.

### VM (one-time, az cli)

No IaC. One VM, created once, config lives in NixOS from then on.

```
az group create -n rg-todo -l swedencentral
az vm create -g rg-todo -n azure-todo \
  --image Ubuntu2404 --size Standard_B2ats_v2 \
  --os-disk-size-gb 32 --storage-sku StandardSSD_LRS \
  --admin-username nixos --ssh-key-values ~/.ssh/azure-todo.pub \
  --public-ip-sku Standard --nsg-rule SSH
```

Outputs public ip. Note it; it's static enough (Standard SKU doesn't change on stop/start, only on delete).

After Tailscale is up (ingress A): `az vm open-port` reverse — delete the SSH rule from the NSG in portal or `az network nsg rule delete -g rg-todo --nsg-name azure-todoNSG -n default-allow-ssh`.

Rebuild from scratch = rerun these two commands + nixos-anywhere. Good enough.

### Bootstrap Ubuntu → NixOS (once)

`nixos-anywhere --flake .#azure root@<ip>`. Kexec installer, disko, install. Ubuntu gone.

`hosts/azure/default.nix` needs:

```nix
virtualisation.azure.agent.enable = true;        # waagent; portal/resize keep working
boot.loader.grub.device = "/dev/disk/azure/root"; # systemd-boot if gen2 image
services.openssh.enable = true;
users.users.root.openssh.authorizedKeys.keys = [ ... ];
services.todo = {
  enable = true; port = 8090; dataDir = "/var/lib/todo";
  encryptionKeyFile = config.age.secrets.todo.path;
};
```

Kexec needs ~1 GiB RAM; B2ats_v2 is at the floor. If it fails: install on `B1ms` (2 GiB), resize down after. Fallback: `nixos-generators -f azure` → VHD → `azurerm_image` → VM from image. No kexec.

### Ingress — pick one

**A. Tailscale (default).** `services.tailscale` + `authKeyFile` from agenix. `tailscale serve --bg 8090` → `https://azure-todo.<tailnet>.ts.net`. NSG: remove 22 after first rebuild, SSH over tailnet. Zero public surface. Every device needs Tailscale client.

**B. Public.** `services.caddy` reverse_proxy 127.0.0.1:8090, auto Let's Encrypt. Needs domain + A record. NSG 80/443. Keep SSH tailnet-only regardless.

Both can coexist.

### Secrets

agenix. `PB_ENCRYPTION_KEY`, tailscale auth key. After install: `ssh-keyscan` VM host key → add recipient → `agenix -r`. PB superuser set once in admin UI, lives in pb_data.

### Backups

`services.restic.backups.todo` → Azure Blob (`azure:` backend, key via agenix). Daily, keep 7d/4w.

### Deploy loop

- Code/config change → `nix run .#deploy` from Mac or PC. Builds locally, pushes closure. Never build on the VM.
- VM size/disk change → portal or `az vm resize`. Rare.
- Migrations apply on service restart.

### Clients

Mac (nix-darwin), NixOS PC, phone: Tailscale + browser. "Add to Home Screen"/install PWA once per device. No config.

## Milestones

- **M0 scaffold** — flake, migration, PB runs, admin UI reachable. `nix run` works.
- **M1 list** — add/toggle/delete, persisted, realtime across two browser tabs.
- **M2 PWA** — manifest, icons, installable on iOS/macOS, HTTPS via Tailscale.
- **M3 polish** — due dates, reorder, keyboard, inline edit.
- **M4 deploy** — az vm create, nixos-anywhere, `nix run .#deploy` works from Mac, restic → Blob.

Then stop. v2 candidates: offline-first (switch store to CRDT or PB + local queue), Tauri desktop widget reusing frontend, sharing.

## Risks

- PocketBase pre-1.0: pin version in flake, read changelog on bumps. Migrations format has changed before.
- iOS PWA SSE in background: connection drops when app backgrounded; full refetch on `visibilitychange` covers it.
- Single instance, no HA. Acceptable.
- VM too small to build closures: `nix run .#deploy` builds on the client, never on the VM.

## Day-1 commands

```
nix flake init -t <template or blank>
nix run nixpkgs#pocketbase -- serve --dev          # confirm admin UI
# create todos collection in UI, export migration
nix run nixpkgs#pocketbase -- migrate collections
```

## Implementation notes (deviations from the plan above)

- **Migration name** is `pb_migrations/1761390000_init_todos.js`, not `1_init_todos.js`.
  PocketBase applies migrations in filename order; `1_…` sorts *after* timestamp-prefixed
  snapshots (`_` > digits), so a fresh install would run later snapshots first.
- **Owner is not set server-side.** PocketBase 0.38 evaluates API rules *before* request
  hooks run, so a hook can't inject `owner`. The client sends `owner`, and the create rule
  `owner = @request.auth.id` rejects anything else. The update rule additionally pins
  `owner` (`@request.body.owner:isset = false || @request.body.owner = @request.auth.id`).
  No `pb_hooks/` dir.
- **Public signup disabled**: the migration sets `users.createRule = null`. Users are created
  in the admin UI.
- **nixpkgs** pinned to `nixos-26.05` (PocketBase 0.38.0, `nixos-rebuild` = nixos-rebuild-ng).
- **Boot**: GRUB with `efiSupport` + `efiInstallAsRemovable` plus a 1 MiB BIOS boot partition,
  so the same config boots Gen1 and Gen2 VMs. `virtualisation.azure.agent` is deprecated;
  `azure-common.nix` (waagent + cloud-init + `/dev/disk/azure/*` udev rules) is imported instead.
- **Backups** snapshot SQLite with `sqlite3 .backup` into `/var/backup/todo` before restic runs,
  rather than copying the live `data.db`.
- `manifest.webmanifest` and `sw.js` live in `frontend/public/` (Vite copies them verbatim).
- **Recurrence added after v1 scope** (user request): `repeat` text field (migration 2) holding an
  RRULE subset; `frontend/src/recur.ts` computes the next occurrence from the *due date*
  (one step, month-end clamped, UTC calendar days). Completing a repeating todo advances `due`
  and keeps `done = false`. Late = open and `due` < today; shown as a pill with day/week/month
  granularity.
