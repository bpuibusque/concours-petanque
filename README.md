# Concours Pétanque

Application desktop de gestion de concours de pétanque en 4 parties, système **Gagnants/Perdants (GG/PP)**.  
100 % local, aucune connexion internet requise.

**Stack :** Tauri 2 · React 18 · TypeScript · Rust · SQLite

---

## Fonctionnalités

- Création de concours (tête-à-tête, doublette, triplette)
- Inscription des équipes avec prénoms des joueurs
- Tirage aléatoire du tour 1
- Tours 2-4 en GG/PP avec anti-doublon et tri par goal average
- Saisie des scores avec auto-complétion (score < 13 → adverse à 13)
- Classement en temps réel (victoires → goal average → points bruts)
- Recherche du parcours d'une équipe
- Sauvegarde automatique en SQLite (un fichier par concours)

---

## Prérequis communs

| Outil | Version | Lien |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org |
| Rust (stable) | ≥ 1.77 | https://rustup.rs |

---

## Installation & lancement en développement

### macOS

```bash
# 1. Installer Homebrew si besoin
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Installer Node.js et Rust
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 3. Cloner le dépôt
git clone https://github.com/Baptiste-Puibusque/concours-petanque.git
cd concours-petanque

# 4. Installer les dépendances JS
npm install

# 5. Lancer en mode développement
npm run tauri dev
```

> La première compilation Rust prend 2-3 minutes. Les suivantes sont quasi-instantanées.

### Windows

```powershell
# 1. Installer Node.js
#    Télécharger le .msi LTS sur https://nodejs.org et l'exécuter

# 2. Installer Rust
#    Aller sur https://rustup.rs, télécharger rustup-init.exe
#    Choisir l'option 1 (installation par défaut, toolchain MSVC)

# 3. Installer Visual Studio Build Tools
#    https://visualstudio.microsoft.com/visual-cpp-build-tools/
#    Cocher : "Desktop development with C++"

# 4. Redémarrer le terminal (PowerShell ou cmd), puis :
git clone https://github.com/Baptiste-Puibusque/concours-petanque.git
cd concours-petanque
npm install
npm run tauri dev
```

> La première compilation Rust prend 3-5 minutes sur Windows.

---

## Compiler l'installateur final (.exe / .dmg)

```bash
npm run tauri build
```

Les fichiers sont générés dans `src-tauri/target/release/bundle/` :

| Plateforme | Format | Emplacement |
|---|---|---|
| Windows | `.exe` (installateur NSIS) | `bundle/nsis/` |
| Windows | `.msi` | `bundle/msi/` |
| macOS | `.dmg` | `bundle/dmg/` |
| macOS | `.app` | `bundle/macos/` |

L'installateur Windows fonctionne sur tout PC **Windows 10/11 64-bit** sans dépendance externe (WebView2 est inclus dans Windows 10/11).

---

## Structure du projet

```
/src                   → Frontend React/TypeScript
  /lib                 → Types et wrappers API Tauri (invoke.ts, types.ts)
  /screens             → Écrans : Accueil, Inscription, Tirage, Saisie, Classement, Recherche
/src-tauri
  /src
    lib.rs             → Commandes Tauri (IPC)
    db.rs              → SQLite : ouverture, migrations, requêtes
    models.rs          → Structs : Concours, Equipe, Joueur, Tour, Rencontre…
    tirage.rs          → Logique tirage GG/PP + anti-doublon + goal average
    classement.rs      → Calcul classement + parcours équipe
  tauri.conf.json      → Config Tauri (nom app, taille fenêtre…)
```

---

## Règles métier

- **Minimum 9 équipes** pour lancer le tour 1
- **Tour 1** : tirage aléatoire
- **Tours 2-4** : système GG/PP — au sein de chaque paquet (même nb de victoires), les équipes sont triées par goal average pour que les forts affrontent les forts et les faibles les faibles
- **Équipe impaire** : tirée exempte, victoire automatique 13-0 actée
- **Anti-doublon** : deux équipes déjà opposées ne se retrouvent pas sauf si inévitable (signalé à l'écran)
- **Classement** : victoires → goal average (marqués − encaissés) → points marqués bruts
