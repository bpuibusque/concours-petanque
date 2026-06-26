import { invoke } from '@tauri-apps/api/core';
import type {
  Concours,
  Equipe,
  FormatEquipe,
  Joueur,
  LigneClassement,
  ParcoursEquipe,
  RencontreDetail,
  TirageInfo,
  Tour,
} from './types';

// Tauri 2.x : paramètres en camelCase côté JS → snake_case Rust automatiquement.

export const api = {
  // --- Concours ---
  creerConcours: (p: {
    nom: string;
    date: string;
    formatEquipe: FormatEquipe;
    nbTours: number;
    antiClubTour1: boolean;
    regleExempte: string;
  }) => invoke<Concours>('creer_concours', p),

  ouvrirConcours: (path: string) =>
    invoke<Concours>('ouvrir_concours', { path }),

  listerFichiersConcours: () =>
    invoke<string[]>('lister_fichiers_concours'),

  getConoursCourant: () =>
    invoke<Concours>('get_concours_courant'),

  supprimerFichierConcours: (path: string) =>
    invoke<void>('supprimer_fichier_concours', { path }),

  exporterConcours: (destination: string) =>
    invoke<void>('exporter_concours', { destination }),

  // --- Équipes ---
  inscrireEquipe: () =>
    invoke<Equipe>('inscrire_equipe'),

  listEquipes: () =>
    invoke<Equipe[]>('list_equipes'),

  supprimerEquipe: (equipeId: number) =>
    invoke<void>('supprimer_equipe', { equipeId }),

  inscrireJoueur: (equipeId: number, nom: string, prenom: string, role: string | null) =>
    invoke<Joueur>('inscrire_joueur', { equipeId, nom, prenom, role }),

  modifierJoueur: (joueurId: number, nom: string, prenom: string, role: string | null) =>
    invoke<void>('modifier_joueur', { joueurId, nom, prenom, role }),

  supprimerJoueur: (joueurId: number) =>
    invoke<void>('supprimer_joueur', { joueurId }),

  listJoueurs: (equipeId: number) =>
    invoke<Joueur[]>('list_joueurs', { equipeId }),

  // --- Tirage ---
  tirerProchainTour: () =>
    invoke<TirageInfo>('tirer_prochain_tour'),

  // --- Tours & Rencontres ---
  listTours: () =>
    invoke<Tour[]>('list_tours'),

  listRencontresTour: (tourId: number) =>
    invoke<RencontreDetail[]>('list_rencontres_tour', { tourId }),

  saisirScore: (rencontreId: number, scoreA: number, scoreB: number) =>
    invoke<void>('saisir_score', { rencontreId, scoreA, scoreB }),

  annulerScore: (rencontreId: number) =>
    invoke<void>('annuler_score', { rencontreId }),

  // --- Classement ---
  getClassement: () =>
    invoke<LigneClassement[]>('get_classement'),

  getParcoursEquipe: (equipeId: number) =>
    invoke<ParcoursEquipe>('get_parcours_equipe', { equipeId }),
};
