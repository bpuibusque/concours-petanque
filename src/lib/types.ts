export type FormatEquipe = 'tete_a_tete' | 'doublette' | 'triplette';
export type StatutTour = 'en_attente' | 'ouvert' | 'clos';
export type StatutRencontre = 'a_jouer' | 'jouee' | 'annulee';
export type RoleJoueur = 'tireur' | 'pointeur' | 'milieu';

export interface Concours {
  id: number;
  nom: string;
  date: string;
  format_equipe: FormatEquipe;
  nb_tours: number;
  anti_club_tour1: boolean;
  regle_exempte: string;
}

export interface Equipe {
  id: number;
  concours_id: number;
  nom: string;
  club: string | null;
  numero_tirage: number | null;
}

export interface Joueur {
  id: number;
  equipe_id: number;
  nom: string;
  prenom: string;
  role: RoleJoueur | null;
}

export interface Tour {
  id: number;
  concours_id: number;
  numero: number;
  statut: StatutTour;
}

export interface RencontreDetail {
  id: number;
  tour_id: number;
  equipe_a_id: number;
  equipe_a_nom: string;
  equipe_a_joueurs: string[];
  equipe_b_id: number | null;
  equipe_b_nom: string | null;
  equipe_b_joueurs: string[];
  score_a: number | null;
  score_b: number | null;
  terrain: number | null;
  statut: StatutRencontre;
  exempte: boolean;
}

export interface LigneClassement {
  rang: number;
  equipe_id: number;
  equipe_nom: string;
  joueurs: string[];
  club: string | null;
  parties_gagnees: number;
  goal_average: number;
  points_marques: number;
  points_encaisses: number;
}

export interface ParcoursTour {
  tour_numero: number;
  adversaire_id: number | null;
  adversaire_nom: string | null;
  score_equipe: number | null;
  score_adversaire: number | null;
  victoire: boolean | null;
  exempte: boolean;
}

export interface ParcoursEquipe {
  equipe: Equipe;
  tours: ParcoursTour[];
}

export interface TirageInfo {
  tour_id: number;
  tour_numero: number;
  nb_rencontres: number;
  exempt_equipe_id: number[];
  doublons_forces: [number, number][];
  conflits_club_forces: [number, number][];
}

export const FORMAT_LABEL: Record<FormatEquipe, string> = {
  tete_a_tete: 'Tête-à-tête',
  doublette: 'Doublette',
  triplette: 'Triplette',
};
