use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatEquipe {
    TeteATete,  // 1 joueur
    Doublette,  // 2 joueurs
    Triplette,  // 3 joueurs
}

impl FormatEquipe {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "tete_a_tete" => Some(Self::TeteATete),
            "doublette" => Some(Self::Doublette),
            "triplette" => Some(Self::Triplette),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TeteATete => "tete_a_tete",
            Self::Doublette => "doublette",
            Self::Triplette => "triplette",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatutTour {
    /// Tirage non encore effectué
    EnAttente,
    /// Tirage effectué, résultats en cours de saisie
    Ouvert,
    /// Tous les résultats validés
    Clos,
}

impl StatutTour {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "en_attente" => Some(Self::EnAttente),
            "ouvert" => Some(Self::Ouvert),
            "clos" => Some(Self::Clos),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EnAttente => "en_attente",
            Self::Ouvert => "ouvert",
            Self::Clos => "clos",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatutRencontre {
    AJouer,
    Jouee,
    Annulee,
}

impl StatutRencontre {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "a_jouer" => Some(Self::AJouer),
            "jouee" => Some(Self::Jouee),
            "annulee" => Some(Self::Annulee),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AJouer => "a_jouer",
            Self::Jouee => "jouee",
            Self::Annulee => "annulee",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoleJoueur {
    Tireur,
    Pointeur,
    // Milieu n'existe qu'en triplette mais on le prévoit
    Milieu,
}

impl RoleJoueur {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "tireur" => Some(Self::Tireur),
            "pointeur" => Some(Self::Pointeur),
            "milieu" => Some(Self::Milieu),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Tireur => "tireur",
            Self::Pointeur => "pointeur",
            Self::Milieu => "milieu",
        }
    }
}

// ---------------------------------------------------------------------------
// Modèles principaux
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Concours {
    pub id: i64,
    pub nom: String,
    /// Format ISO-8601 : "YYYY-MM-DD"
    pub date: String,
    pub format_equipe: FormatEquipe,
    /// Nombre de tours (4 en MVP, stocké pour permettre 3/5/6 en V2)
    pub nb_tours: u8,
    /// Interdit deux équipes du même club au tour 1
    pub anti_club_tour1: bool,
    /// Convention exempte : "score_nul" (0-0) ou "score_fictif" (13-0)
    /// Valeur retenue : "score_fictif"
    pub regle_exempte: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Equipe {
    pub id: i64,
    pub concours_id: i64,
    pub nom: String,
    pub club: Option<String>,
    /// Numéro attribué lors du tirage (ordre de passage, 1-based)
    pub numero_tirage: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Joueur {
    pub id: i64,
    pub equipe_id: i64,
    pub nom: String,
    pub prenom: String,
    pub role: Option<RoleJoueur>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tour {
    pub id: i64,
    pub concours_id: i64,
    /// 1 à nb_tours
    pub numero: u8,
    pub statut: StatutTour,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rencontre {
    pub id: i64,
    pub tour_id: i64,
    /// None si rencontre exempte (equipe_b_id absent)
    pub equipe_a_id: i64,
    pub equipe_b_id: Option<i64>,
    pub score_a: Option<i64>,
    pub score_b: Option<i64>,
    /// Numéro de terrain (affiché sur les feuilles)
    pub terrain: Option<i64>,
    pub statut: StatutRencontre,
    /// true si l'une des équipes est exemptée (bye)
    pub exempte: bool,
}

// ---------------------------------------------------------------------------
// Vues enrichies pour le frontend (join SQL → struct)
// ---------------------------------------------------------------------------

/// Rencontre avec noms des équipes — évite des allers-retours côté JS
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RencontreDetail {
    pub id: i64,
    pub tour_id: i64,
    pub equipe_a_id: i64,
    pub equipe_a_nom: String,
    pub equipe_a_joueurs: Vec<String>,
    pub equipe_b_id: Option<i64>,
    pub equipe_b_nom: Option<String>,
    pub equipe_b_joueurs: Vec<String>,
    pub score_a: Option<i64>,
    pub score_b: Option<i64>,
    pub terrain: Option<i64>,
    pub statut: StatutRencontre,
    pub exempte: bool,
}

// ---------------------------------------------------------------------------
// Vues calculées (non persistées, construites par classement.rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LigneClassement {
    pub rang: u32,
    pub equipe_id: i64,
    pub equipe_nom: String,
    pub joueurs: Vec<String>,
    pub club: Option<String>,
    pub parties_gagnees: i32,
    /// total points marqués − total points encaissés
    pub goal_average: i32,
    /// total points marqués bruts (3ème critère de départage)
    pub points_marques: i32,
    pub points_encaisses: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParcoursTour {
    pub tour_numero: u8,
    pub adversaire_id: Option<i64>,
    pub adversaire_nom: Option<String>,
    pub score_equipe: Option<i64>,
    pub score_adversaire: Option<i64>,
    pub victoire: Option<bool>,
    pub exempte: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParcoursEquipe {
    pub equipe: Equipe,
    pub tours: Vec<ParcoursTour>,
}
