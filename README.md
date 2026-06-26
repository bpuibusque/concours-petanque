# Concours Pétanque

Application desktop de gestion de concours de pétanque en 4 parties, système **Gagnants/Perdants (GG/PP)**.  
100 % local, aucune connexion internet requise.

---

## Télécharger et installer

👉 **[Aller sur la page Releases](https://github.com/bpuibusque/concours-petanque/releases/latest)**

| Système | Fichier à télécharger |
|---|---|
| Windows 10/11 | `.msi` |
| macOS Apple Silicon (M1/M2/M3/M4) | `.dmg` contenant `aarch64` |
| macOS Intel | `.dmg` contenant `x86_64` |

Double-cliquez sur le fichier téléchargé et suivez l'installation. Aucune dépendance supplémentaire requise.

> **macOS** : si macOS bloque l'application ("développeur non identifié"), faites clic droit → Ouvrir → Ouvrir quand même.

---

## Fonctionnalités

- Création de concours (tête-à-tête, doublette, triplette)
- Inscription des équipes avec prénoms des joueurs
- Tirage aléatoire du tour 1
- Tours 2-4 en GG/PP avec anti-doublon et tri par goal average
- Saisie des scores avec validation par ligne
- Classement en temps réel (victoires → goal average → points bruts)
- Recherche du parcours d'une équipe
- Sauvegarde automatique en SQLite (un fichier par concours)

---

## Règles métier

- **Minimum 9 équipes** pour lancer le tour 1
- **Tour 1** : tirage aléatoire
- **Tours 2-4** : système GG/PP — au sein de chaque paquet (même nb de victoires), les équipes sont triées par goal average
- **Équipe impaire** : tirée exempte, victoire automatique actée
- **Anti-doublon** : deux équipes déjà opposées ne se retrouvent pas sauf si inévitable (signalé à l'écran)
- **Classement** : victoires → goal average (marqués − encaissés) → points marqués bruts

---

## Développement

**Stack :** Tauri 2 · React 19 · TypeScript · Rust · SQLite

### Prérequis

| Outil | Version |
|---|---|
| Node.js | 20 LTS |
| Rust (stable) | ≥ 1.77 |
| Visual Studio Build Tools + C++ *(Windows uniquement)* | 2019+ |

### Lancer en développement

```bash
git clone https://github.com/bpuibusque/concours-petanque.git
cd concours-petanque
npm install
npm run tauri dev
```

### Compiler un installateur local

```bash
npm run tauri build
# → src-tauri/target/release/bundle/
```

### Publier une release

```bash
git tag v1.0.0
git push origin main --tags
# GitHub Actions compile et publie automatiquement le .msi et les .dmg
```

---

## Structure du projet

```
/src                   → Frontend React/TypeScript
  /lib                 → Types et wrappers API Tauri
  /screens             → Accueil, Inscription, Tirage, Saisie, Classement, Recherche
/src-tauri/src
  lib.rs               → Commandes Tauri (IPC)
  db.rs                → SQLite : migrations, requêtes
  models.rs            → Structs Rust
  tirage.rs            → Logique tirage GG/PP + anti-doublon
  classement.rs        → Calcul classement + parcours équipe
```
