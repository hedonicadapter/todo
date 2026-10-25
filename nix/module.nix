# services.todo — PocketBase serving the todo frontend.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.todo;
in
{
  options.services.todo = {
    enable = lib.mkEnableOption "todo (PocketBase + PWA)";

    package = lib.mkPackageOption pkgs "pocketbase" { };

    publicDir = lib.mkOption {
      type = lib.types.path;
      description = "Built frontend, served at `/`.";
    };

    migrationsDir = lib.mkOption {
      type = lib.types.path;
      description = "JS migrations, applied on service start.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Listen address. Keep loopback; put Tailscale/Caddy in front.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8090;
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/todo";
      description = "pb_data: SQLite db, storage, backups. Needs a real disk (not SMB).";
    };

    encryptionKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        File with 32-char AES key for PocketBase settings encryption
        (passed as PB_ENCRYPTION_KEY via systemd credentials). Set on day 1;
        PocketBase can't switch an existing pb_data between encrypted/plain.
      '';
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.todo = {
      isSystemUser = true;
      group = "todo";
      home = cfg.dataDir;
    };
    users.groups.todo = { };

    systemd.tmpfiles.rules = [ "d ${cfg.dataDir} 0750 todo todo -" ];

    systemd.services.todo = {
      description = "todo (PocketBase)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        User = "todo";
        Group = "todo";
        WorkingDirectory = cfg.dataDir;
        LoadCredential = lib.optional (
          cfg.encryptionKeyFile != null
        ) "pb-encryption-key:${cfg.encryptionKeyFile}";
        ExecStart = pkgs.writeShellScript "todo-start" ''
          set -eu
          extra=()
          if [ -n "''${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CREDENTIALS_DIRECTORY/pb-encryption-key" ]; then
            PB_ENCRYPTION_KEY=$(tr -d '\n' < "$CREDENTIALS_DIRECTORY/pb-encryption-key")
            export PB_ENCRYPTION_KEY
            extra+=(--encryptionEnv=PB_ENCRYPTION_KEY)
          fi
          exec ${lib.getExe cfg.package} \
            --dir=${cfg.dataDir} \
            --publicDir=${cfg.publicDir} \
            --migrationsDir=${cfg.migrationsDir} \
            --automigrate=false \
            "''${extra[@]}" \
            serve --http=${cfg.host}:${toString cfg.port}
        '';
        Restart = "on-failure";
        RestartSec = 2;

        # Hardening
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
        ];
        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        UMask = "0077";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
