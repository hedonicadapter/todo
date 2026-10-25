# nixosConfigurations.azure — the one VM. Installed once with nixos-anywhere,
# updated with `nix run .#deploy`.
{
  config,
  lib,
  pkgs,
  modulesPath,
  ...
}:
let
  # Ingress B (public via Caddy + Let's Encrypt). null = Tailscale only.
  publicDomain = null;
  pbPort = 8090;
in
{
  imports = [
    # waagent + cloud-init + Hyper-V modules + /dev/disk/azure/* udev rules
    "${modulesPath}/virtualisation/azure-common.nix"
    ./disko.nix
  ];

  networking.hostName = "azure-todo";
  system.stateVersion = "26.05";
  time.timeZone = "Europe/Stockholm";

  # Works for Gen1 (BIOS boot partition) and Gen2 (ESP, removable-path EFI).
  boot.loader.grub = {
    enable = true;
    device = "/dev/disk/azure/root";
    efiSupport = true;
    efiInstallAsRemovable = true;
  };
  boot.loader.efi.canTouchEfiVariables = false;

  # --- access ---------------------------------------------------------------
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };
  users.users.root.openssh.authorizedKeys.keys = [
    # TODO: replace with ~/.ssh/azure-todo.pub
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA azure-todo"
  ];

  # SSH only over tailnet once Tailscale is up; drop the NSG 22 rule after first rebuild.
  networking.firewall = {
    enable = true;
    allowedTCPPorts = lib.optionals (publicDomain != null) [
      80
      443
    ];
    trustedInterfaces = [ config.services.tailscale.interfaceName ];
  };

  # --- secrets (agenix) ------------------------------------------------------
  age.secrets = {
    todo.file = ../../secrets/todo.age; # 32-char PB_ENCRYPTION_KEY
    tailscale.file = ../../secrets/tailscale.age; # tskey-auth-…
    restic-env.file = ../../secrets/restic-env.age; # AZURE_ACCOUNT_NAME= / AZURE_ACCOUNT_KEY=
    restic-password.file = ../../secrets/restic-password.age;
  };

  # --- app -------------------------------------------------------------------
  services.todo = {
    enable = true;
    port = pbPort;
    dataDir = "/var/lib/todo";
    encryptionKeyFile = config.age.secrets.todo.path;
  };

  # --- ingress A: Tailscale (default) -----------------------------------------
  services.tailscale = {
    enable = true;
    authKeyFile = config.age.secrets.tailscale.path;
    useRoutingFeatures = "server";
    extraUpFlags = [ "--ssh" ];
  };

  # `tailscale serve` persists in tailscaled state; re-applying is idempotent.
  # → https://azure-todo.<tailnet>.ts.net
  systemd.services.tailscale-serve = {
    description = "Expose todo via tailscale serve";
    after = [
      "tailscaled.service"
      "tailscaled-autoconnect.service"
      "todo.service"
    ];
    wants = [ "tailscaled-autoconnect.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      Restart = "on-failure";
      RestartSec = 10;
    };
    script = ''
      # Wait for tailscaled to be logged in.
      for _ in $(seq 1 30); do
        ${lib.getExe pkgs.tailscale} status >/dev/null 2>&1 && break
        sleep 2
      done
      exec ${lib.getExe pkgs.tailscale} serve --bg --https=443 http://127.0.0.1:${toString pbPort}
    '';
  };

  # --- ingress B: public (optional) -------------------------------------------
  services.caddy = lib.mkIf (publicDomain != null) {
    enable = true;
    virtualHosts.${publicDomain}.extraConfig = ''
      encode zstd gzip
      reverse_proxy 127.0.0.1:${toString pbPort}
    '';
  };

  # --- backups: restic → Azure Blob --------------------------------------------
  # SQLite is snapshotted with `.backup` first; copying a live db file is unsafe.
  services.restic.backups.todo = {
    initialize = true;
    repository = "azure:todo-backups:/";
    environmentFile = config.age.secrets.restic-env.path;
    passwordFile = config.age.secrets.restic-password.path;
    paths = [ "/var/backup/todo" ];
    backupPrepareCommand = ''
      mkdir -p /var/backup/todo
      ${lib.getExe pkgs.sqlite} /var/lib/todo/data.db ".backup /var/backup/todo/data.db"
      ${lib.getExe pkgs.sqlite} /var/lib/todo/auxiliary.db ".backup /var/backup/todo/auxiliary.db"
      ${pkgs.rsync}/bin/rsync -a --delete /var/lib/todo/storage/ /var/backup/todo/storage/ 2>/dev/null || true
    '';
    backupCleanupCommand = "rm -rf /var/backup/todo";
    timerConfig = {
      OnCalendar = "03:17";
      RandomizedDelaySec = "30m";
      Persistent = true;
    };
    pruneOpts = [
      "--keep-daily 7"
      "--keep-weekly 4"
    ];
  };

  # --- misc --------------------------------------------------------------------
  environment.systemPackages = [
    pkgs.sqlite
    pkgs.restic
  ];
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };
  # Small VM: never build here, closures are pushed from the client.
  nix.settings.max-jobs = 0;
  documentation.enable = false;
}
