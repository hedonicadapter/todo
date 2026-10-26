{
  description = "todo — synced todo list: PocketBase backend, vanilla TS PWA";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    agenix = {
      url = "github:ryantm/agenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      disko,
      agenix,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          frontend = pkgs.callPackage ./nix/frontend.nix { };
          # PocketBase version is pinned by flake.lock (nixpkgs rev).
          pocketbase = pkgs.pocketbase;
          todo = pkgs.callPackage ./nix/todo.nix { inherit frontend pocketbase; };
        in
        {
          inherit frontend pocketbase todo;
          default = todo;
          dev = pkgs.callPackage ./nix/pocketbase-dev.nix { inherit pocketbase; };
          deploy = pkgs.writeShellApplication {
            name = "todo-deploy";
            runtimeInputs = [ pkgs.nixos-rebuild ];
            text = ''
              # Build on this machine, push closure, switch. Never builds on VM.
              exec nixos-rebuild switch --flake "${self}#azure" --target-host "''${TODO_TARGET:-root@azure-todo}" "$@"
            '';
          };
        }
      );

      apps = forAllSystems (pkgs: {
        # nix run → local instance on :8090, data in ./pb_data
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.todo}/bin/todo-serve";
        };
        dev = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.dev}/bin/todo-dev";
        };
        deploy = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.deploy}/bin/todo-deploy";
        };
      });

      nixosModules.default =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.todo.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.pocketbase;
          services.todo.publicDir = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.frontend;
          services.todo.migrationsDir = lib.mkDefault ./pb_migrations;
        };

      nixosConfigurations.azure = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          disko.nixosModules.disko
          agenix.nixosModules.default
          self.nixosModules.default
          ./hosts/azure
        ];
      };

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.pocketbase
            pkgs.typescript
            pkgs.nixos-rebuild
            agenix.packages.${pkgs.stdenv.hostPlatform.system}.default
          ]
          ++ pkgs.lib.optionals (!pkgs.stdenv.hostPlatform.isDarwin) [ pkgs.nixos-anywhere ]
          # Use this az for everything in this repo. Mixing az versions on one ~/.azure
          # breaks its pickled msal cache (rm ~/.azure/msal_http_cache.bin to recover).
          ++ pkgs.lib.optionals (pkgs.stdenv.hostPlatform.isx86_64) [ pkgs.azure-cli ];
        };
      });

      checks = forAllSystems (pkgs: {
        frontend-build = self.packages.${pkgs.stdenv.hostPlatform.system}.frontend;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
