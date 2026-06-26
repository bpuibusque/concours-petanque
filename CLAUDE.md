# CLAUDE.md — Logiciel de gestion de concours de pétanque "4 Parties"

## Contexte du projet

Application desktop de gestion de concours de pétanque **en 4 parties**, inspirée du
logiciel historique d'Alain Valat (Cadix) — système "Gagnants contre Gagnants /
Perdants contre Perdants" (GG/PP) avec classement par parties gagnées puis goal
average.

Usage : organisation de concours ponctuels (club, anniversaire, mariage, tournoi
inter-sociétaires). Le logiciel doit être **100% local**, sans aucune dépendance
réseau ou cloud, et tourner à l'identique sur **Windows et macOS**.

## Stack technique imposée

- **Tauri 2.x** — desktop cross-platform, binaire natif léger (pas d'Electron)
- **Frontend** : React 18 + TypeScript (mode strict)
- **Backend** : Rust — toute la logique métier sensible (tirages, calculs de
  classement, persistance) vit côté Rust, pas côté JS
- **Stockage** : SQLite embarqué (`rusqlite` ou `tauri-plugin-sql`), un fichier
  `.sqlite` par concours, stocké en local (dossier `Documents/ConcoursPetanque`
  par défaut)
- **Pas de serveur, pas d'auth, pas de compte** — mono-poste, mono-utilisateur
- **Export** : PDF (feuilles équipes, feuilles de rencontres, classement) via
  génération HTML→PDF ou crate `printpdf`
- **Distribution** : `.exe` (Windows) + `.dmg`/`.app` (macOS Intel + Apple
  Silicon) via `tauri build`, publication GitHub Releases

## Règles métier — Format "4 Parties" façon Alain Valat

### 1. Inscription des équipes
- Format configurable à la création du concours : tête-à-tête (1 joueur),
  doublette (2), triplette (3) — **un seul format par concours** en MVP
- Minimum 9 équipes (en-dessous, le système GG/PP n'a pas vraiment de sens) —
  pas de plafond imposé en dur dans le code (le logiciel d'origine limitait à
  96, mais c'est une limite UI, pas une règle métier)
- Champs équipe : nom/numéro, club, liste des joueurs
- Inscriptions tardives possibles **uniquement jusqu'à la clôture du tour 1**
  (tirage du tour 1 effectué = inscriptions fermées)

### 2. Tirage du tour 1
- Tirage aléatoire des oppositions
- Option activable : interdiction que deux équipes du même club se rencontrent
  au tour 1
- Si nombre d'équipes impair : une équipe est tirée **exempte** ("blanc") pour
  ce tour. *Règle par défaut retenue : victoire actée, 0 au goal average pour
  cette rencontre — à valider avec toi si tu veux une autre convention.*
- Impression : feuille des équipes inscrites + feuille des rencontres du tour 1

### 3. Tours 2, 3, 4 — Système Gagnants/Perdants (GG/PP)
- Le tirage d'un tour ne peut se faire que si tous les résultats du tour
  précédent sont saisis et validés
- Principe : on regroupe les équipes par nombre cumulé de parties gagnées
  (ex. au tour 3 : paquet 2-0, paquet 1-1, paquet 0-2), et on tire les
  oppositions **au sein de chaque paquet**
- Anti-doublon : deux équipes déjà opposées à un tour précédent ne doivent pas
  se retirer si possible. Si l'effectif est trop faible pour l'éviter, on
  autorise en dernier recours et on le signale clairement à l'écran
- Effectif impair dans un paquet → même règle d'exemption qu'au tour 1, ou
  rattachement au paquet voisin (à rendre configurable)
- 4 tours fixes en MVP (prévoir le champ en base pour passer à 3/5/6 plus tard
  sans tout refondre)

### 4. Saisie des résultats
- Par rencontre : score équipe A / score équipe B, **sans imposer de score
  max** (certains concours se jouent en temps limité, pas forcément à 13)
- Annulation/correction possible à tout moment → recalcul automatique du
  classement
- Recherche du parcours d'une équipe à tout moment (ses 4 rencontres, scores,
  adversaires, tours)

### 5. Classement
Tri par :
1. Nombre de parties gagnées (décroissant)
2. **Goal average** = total points marqués − total points encaissés sur les 4
   parties (décroissant). *Si tu préfères la variante "quotient" (marqués /
   encaissés) utilisée par certains clubs, dis-le-moi et je change la règle.*
3. Égalité totale persistante : points marqués bruts, puis tirage au sort (à
   trancher)
- Mise à jour en temps réel à chaque validation de résultat
- Impression/export du classement général définitif en fin de concours

### 6. Sauvegarde
- Autosave en SQLite après chaque action (pas de bouton "sauvegarder" séparé)
- "Exporter le concours" → copie du fichier `.sqlite` vers un dossier au choix
  (remplace la logique "clé USB de secours" du logiciel d'origine)
- "Importer un concours" pour reprendre sur une autre machine

## Architecture attendue

```
/src                    → frontend React/TS
  /components
  /screens               (Inscription, Tirage, Saisie, Classement, Recherche, Impression)
  /hooks
  /lib                    (wrappers autour des invoke() Tauri)
/src-tauri
  /src
    main.rs
    db.rs                 (init SQLite + migrations)
    models.rs             (Concours, Equipe, Joueur, Tour, Rencontre)
    tirage.rs             (tour 1 + logique GG/PP + anti-doublon + exemptions)
    classement.rs         (calcul classement + goal average)
    export.rs             (génération PDF)
  Cargo.toml
  tauri.conf.json
```

## Modèle de données (SQLite)
- `concours` (id, nom, date, format_equipe, nb_equipes_min, nb_tours,
  anti_club_tour1, regle_exempte)
- `equipes` (id, concours_id, nom, club, numero_tirage)
- `joueurs` (id, equipe_id, nom, prenom, role[tireur/pointeur])
- `tours` (id, concours_id, numero, statut[ouvert/clos])
- `rencontres` (id, tour_id, equipe_a_id, equipe_b_id, score_a, score_b,
  terrain, statut[a_jouer/joue/annule], exempte boolean)

## Écrans (UI)
1. Création du concours (format équipe, nb équipes, options anti-club, règle
   d'exemption)
2. Inscription équipes/joueurs (+ retardataires si tour 1 pas encore clos)
3. Tirage + visualisation des rencontres du tour en cours
4. Saisie des scores (liste des rencontres, formulaire score, validation)
5. Classement général en temps réel
6. Recherche / parcours d'une équipe
7. Impressions/export PDF (feuille équipes, feuilles de rencontres par tour,
   classement final)

## Contraintes non négociables
- Zéro appel réseau, zéro télémétrie, zéro dépendance cloud
- Build et fonctionnement identiques sur Windows 10/11 et macOS (Intel +
  Apple Silicon)
- Pas d'auth, pas de compte, mono-utilisateur local
- TypeScript strict, pas de `any` non justifié
- Logique sensible (tirage, classement) testée unitairement côté Rust
  (`cargo test`)

## MVP vs V2
**MVP (V1)** : tout ce qui est décrit ci-dessus — un format d'équipe par
concours, 4 tours fixes, export PDF basique.

**V2 (pas maintenant, à ne pas anticiper dans le code MVP)** : concours
multiples en parallèle, mêlée tournante, format poules ABC, gestion
club/licences FFPJP, personnalisation logo/thème des impressions.

## Méthode de travail attendue de Claude Code
- Avancer par petites étapes : poser le schéma SQLite + modèles Rust avant
  toute UI
- Ne pas introduire de dépendance externe (crate ou package npm) sans la
  justifier dans le commit/message
- Toujours garder le projet buildable sur les deux OS — signaler explicitement
  toute API spécifique à une plateforme avant de l'utiliser
