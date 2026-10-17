{
  description = "OSRS route planner: frontend and route service for osrs.collisionlab.world";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      # The plugin's build asks for a Java 11 toolchain: point Gradle at
      # Nix's JDK 11 instead of letting it search for or download one.
      gradle = pkgs.writeShellScriptBin "gradle" ''
        exec ${pkgs.gradle}/bin/gradle \
          -Porg.gradle.java.installations.paths=${pkgs.jdk11_headless}/lib/openjdk \
          -Porg.gradle.java.installations.auto-download=false "$@"
      '';
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.jdk21_headless
          gradle
          pkgs.python3
          pkgs.nodejs_24
        ];
      };

      formatter.${system} = pkgs.nixpkgs-fmt;
    };
}
