use std::collections::{HashMap, HashSet};

use rand::seq::SliceRandom;
use rand::thread_rng;
use rusqlite::Connection;

use crate::db;
use crate::models::{Concours, Equipe, Rencontre, StatutRencontre, StatutTour, Tour};

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum TirageError {
    #[error("Concours introuvable")]
    ConcoursIntrouvable,
    #[error("Résultats du tour {0} incomplets — saisissez tous les scores avant de tirer")]
    ResultatsIncomplets(u8),
    #[error("Nombre d'équipes insuffisant : {0} inscrites, minimum 9 requis")]
    NbEquipesInsuffisant(usize),
    #[error("Tous les tours ont déjà été tirés ({0}/{0})")]
    TourMaxAtteint(u8),
    #[error("Erreur base de données : {0}")]
    Db(String),
}

impl From<rusqlite::Error> for TirageError {
    fn from(e: rusqlite::Error) -> Self {
        TirageError::Db(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Résultat exposé au frontend
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct TirageInfo {
    pub tour_id: i64,
    pub tour_numero: u8,
    /// Rencontres créées (hors exempte)
    pub nb_rencontres: usize,
    /// Équipes tirées exemptes ce tour (une par paquet impair)
    pub exempt_equipe_id: Vec<i64>,
    /// Paires (id_a, id_b) contraintes à se rencontrer malgré un doublon
    pub doublons_forces: Vec<(i64, i64)>,
    /// Paires (id_a, id_b) du même club contraintes (tour 1 anti-club impossible)
    pub conflits_club_forces: Vec<(i64, i64)>,
}

// ---------------------------------------------------------------------------
// Point d'entrée public
// ---------------------------------------------------------------------------

/// Tire le prochain tour du concours.
///
/// - Tour 1 : tirage aléatoire (+ contrainte anti-club optionnelle)
/// - Tours 2-4 : système GG/PP avec anti-doublon
pub fn tirer_prochain_tour(
    conn: &Connection,
    concours_id: i64,
) -> Result<TirageInfo, TirageError> {
    let concours = db::get_concours(conn, concours_id)?
        .ok_or(TirageError::ConcoursIntrouvable)?;

    let tours = db::list_tours(conn, concours_id)?;

    // Vérifier que le tour précédent est terminé, puis le clore
    if let Some(dernier) = tours.last() {
        if !db::tous_resultats_saisis(conn, dernier.id)? {
            return Err(TirageError::ResultatsIncomplets(dernier.numero));
        }
        db::update_statut_tour(conn, dernier.id, &StatutTour::Clos)?;
    }

    let tour_numero = tours.len() as u8 + 1;
    if tour_numero > concours.nb_tours {
        return Err(TirageError::TourMaxAtteint(concours.nb_tours));
    }

    let equipes = db::list_equipes(conn, concours_id)?;
    if equipes.len() < 9 {
        return Err(TirageError::NbEquipesInsuffisant(equipes.len()));
    }

    if tour_numero == 1 {
        tirer_tour_1(conn, &concours, &equipes, tour_numero)
    } else {
        tirer_tour_ggpp(conn, &concours, &equipes, tour_numero)
    }
}

// ---------------------------------------------------------------------------
// Tour 1 — tirage aléatoire
// ---------------------------------------------------------------------------

fn tirer_tour_1(
    conn: &Connection,
    concours: &Concours,
    equipes: &[Equipe],
    tour_numero: u8,
) -> Result<TirageInfo, TirageError> {
    let mut rng = thread_rng();

    let mut ids: Vec<i64> = equipes.iter().map(|e| e.id).collect();
    ids.shuffle(&mut rng);

    // Tirage de l'exempte si impair (tour 1 : personne n'a encore été exempté)
    let (exempt_id, ids_pairs) =
        extraire_exempt_prefere(&ids, &mut rng, &HashSet::new());

    // Contrainte anti-club : construire l'ensemble des paires interdites
    let interdites_club: HashSet<(i64, i64)> = if concours.anti_club_tour1 {
        let club_par_id: HashMap<i64, Option<String>> = equipes
            .iter()
            .map(|e| (e.id, e.club.clone()))
            .collect();
        paires_meme_club(&ids_pairs, &club_par_id)
    } else {
        HashSet::new()
    };

    let mut ids_paires_shuffled = ids_pairs.clone();
    ids_paires_shuffled.shuffle(&mut rng);
    let (paires, conflits_forces) = tirer_paires(&ids_paires_shuffled, &interdites_club);

    let exempts: Vec<i64> = exempt_id.into_iter().collect();

    // Persistance
    let tour = creer_tour(conn, concours.id, tour_numero)?;
    inserer_rencontres(conn, tour.id, &paires, &exempts, concours)?;

    // Numéroter les équipes (ordre de tirage)
    numeroter_equipes(conn, &ids_pairs, &paires, &exempts)?;

    Ok(TirageInfo {
        tour_id: tour.id,
        tour_numero,
        nb_rencontres: paires.len(),
        exempt_equipe_id: exempts,
        doublons_forces: vec![],
        conflits_club_forces: conflits_forces,
    })
}

// ---------------------------------------------------------------------------
// Tours 2-4 — système GG/PP
// ---------------------------------------------------------------------------

fn tirer_tour_ggpp(
    conn: &Connection,
    concours: &Concours,
    equipes: &[Equipe],
    tour_numero: u8,
) -> Result<TirageInfo, TirageError> {
    let mut rng = thread_rng();

    let deja_joues = deja_joues_par_concours(conn, concours.id)?;
    let victoires = victoires_par_equipe(conn, concours.id)?;
    let goal_averages = goal_average_par_equipe(conn, concours.id)?;
    let deja_exemptes = equipes_deja_exemptes(conn, concours.id)?;

    // Grouper par nombre de victoires
    let mut paquets: HashMap<i32, Vec<i64>> = HashMap::new();
    for equipe in equipes {
        let v = *victoires.get(&equipe.id).unwrap_or(&0);
        paquets.entry(v).or_default().push(equipe.id);
    }

    // Niveaux triés du plus élevé au plus faible
    let mut niveaux: Vec<i32> = paquets.keys().copied().collect();
    niveaux.sort_unstable_by(|a, b| b.cmp(a));

    // Trier chaque paquet par GA décroissant
    for ids in paquets.values_mut() {
        ids.sort_by(|&a, &b| {
            goal_averages.get(&b).copied().unwrap_or(0)
                .cmp(&goal_averages.get(&a).copied().unwrap_or(0))
        });
    }

    // Rattachement : si un paquet est impair, descendre le dernier élément (plus faible GA)
    // vers le paquet suivant (niveau inférieur) pour le rendre pair.
    // Si le total est pair, tous les paquets deviendront pairs sans exempté.
    // Si le total est impair, seul le dernier paquet restera impair → 1 exempté.
    for i in 0..niveaux.len().saturating_sub(1) {
        if paquets[&niveaux[i]].len() % 2 != 0 {
            let moved = paquets.get_mut(&niveaux[i]).unwrap().pop().unwrap();
            let next_ids = paquets.get_mut(&niveaux[i + 1]).unwrap();
            next_ids.push(moved);
            // Re-trier le paquet cible après ajout
            next_ids.sort_by(|&a, &b| {
                goal_averages.get(&b).copied().unwrap_or(0)
                    .cmp(&goal_averages.get(&a).copied().unwrap_or(0))
            });
        }
    }

    // Tirer les paires de chaque paquet (tous pairs sauf éventuellement le dernier)
    let mut toutes_paires: Vec<(i64, i64)> = Vec::new();
    let mut tous_doublons: Vec<(i64, i64)> = Vec::new();
    let mut exempts_global: Vec<i64> = Vec::new();

    for niveau in &niveaux {
        let ids = paquets.get(niveau).unwrap();
        if ids.is_empty() {
            continue;
        }
        if ids.len() % 2 != 0 {
            // Ne peut arriver qu'au dernier paquet quand le total d'équipes est impair
            let (exempt_id, ids_pairs) =
                extraire_exempt_prefere(ids, &mut rng, &deja_exemptes);
            if let Some(e) = exempt_id {
                exempts_global.push(e);
            }
            let (paires, doublons) = tirer_paires(&ids_pairs, &deja_joues);
            toutes_paires.extend(paires);
            tous_doublons.extend(doublons);
        } else {
            let (paires, doublons) = tirer_paires(ids, &deja_joues);
            toutes_paires.extend(paires);
            tous_doublons.extend(doublons);
        }
    }

    // Persistance
    let tour = creer_tour(conn, concours.id, tour_numero)?;
    inserer_rencontres(conn, tour.id, &toutes_paires, &exempts_global, concours)?;

    Ok(TirageInfo {
        tour_id: tour.id,
        tour_numero,
        nb_rencontres: toutes_paires.len(),
        exempt_equipe_id: exempts_global,
        doublons_forces: tous_doublons,
        conflits_club_forces: vec![],
    })
}

// ---------------------------------------------------------------------------
// Algorithme de tirage par paires avec contraintes
// ---------------------------------------------------------------------------

/// Retourne (paires valides, paires forcées malgré contrainte).
///
/// Le caller est responsable de l'ordre de `ids` (aléatoire ou trié par GA).
/// Deux passes :
/// 1. Backtracking sans aucune paire interdite → si solution, aucun forcé
/// 2. Backtracking autorisant les paires interdites en dernier recours
fn tirer_paires(
    ids: &[i64],
    interdites: &HashSet<(i64, i64)>,
) -> (Vec<(i64, i64)>, Vec<(i64, i64)>) {
    assert_eq!(ids.len() % 2, 0, "tirer_paires: liste doit être paire");

    // Passe 1 : sans doublons
    let mut paires = Vec::new();
    if backtrack_strict(ids, interdites, &mut paires) {
        return (paires, vec![]);
    }

    // Passe 2 : avec doublons autorisés
    paires.clear();
    let mut forces = Vec::new();
    backtrack_souple(ids, interdites, &mut paires, &mut forces);
    (paires, forces)
}

/// Backtracking n'utilisant que des paires non-interdites.
/// Retourne false si aucune solution sans contrainte n'existe.
fn backtrack_strict(
    remaining: &[i64],
    interdites: &HashSet<(i64, i64)>,
    paires: &mut Vec<(i64, i64)>,
) -> bool {
    if remaining.is_empty() {
        return true;
    }
    let first = remaining[0];
    for i in 1..remaining.len() {
        let partner = remaining[i];
        if est_interdite(first, partner, interdites) {
            continue;
        }
        let new_remaining = sans_indices(remaining, 0, i);
        paires.push((first, partner));
        if backtrack_strict(&new_remaining, interdites, paires) {
            return true;
        }
        paires.pop();
    }
    false
}

/// Backtracking autorisant les paires interdites en dernier recours
/// (les paires non-interdites sont toujours essayées en premier).
fn backtrack_souple(
    remaining: &[i64],
    interdites: &HashSet<(i64, i64)>,
    paires: &mut Vec<(i64, i64)>,
    forces: &mut Vec<(i64, i64)>,
) -> bool {
    if remaining.is_empty() {
        return true;
    }
    let first = remaining[0];

    // Candidats triés : non-interdits d'abord
    let mut candidats: Vec<usize> = (1..remaining.len()).collect();
    candidats.sort_by_key(|&i| est_interdite(first, remaining[i], interdites) as u8);

    for i in candidats {
        let partner = remaining[i];
        let contraint = est_interdite(first, partner, interdites);
        let new_remaining = sans_indices(remaining, 0, i);
        paires.push((first, partner));
        if contraint {
            forces.push((first, partner));
        }
        if backtrack_souple(&new_remaining, interdites, paires, forces) {
            return true;
        }
        paires.pop();
        if contraint {
            forces.pop();
        }
    }
    false // ne devrait jamais arriver pour une liste paire non-vide
}

// ---------------------------------------------------------------------------
// Helpers — manipulation de listes
// ---------------------------------------------------------------------------

fn est_interdite(a: i64, b: i64, interdites: &HashSet<(i64, i64)>) -> bool {
    interdites.contains(&(a, b)) || interdites.contains(&(b, a))
}

/// Construit un nouveau Vec sans les éléments aux indices i et j.
fn sans_indices(v: &[i64], i: usize, j: usize) -> Vec<i64> {
    v.iter()
        .enumerate()
        .filter(|&(idx, _)| idx != i && idx != j)
        .map(|(_, &val)| val)
        .collect()
}

/// Retire un exempte si la liste est impaire, en préférant les équipes pas encore exemptées.
fn extraire_exempt_prefere(
    ids: &[i64],
    rng: &mut impl rand::Rng,
    deja_exemptes: &HashSet<i64>,
) -> (Option<i64>, Vec<i64>) {
    if ids.len() % 2 == 0 {
        return (None, ids.to_vec());
    }
    let candidats: Vec<usize> = ids
        .iter()
        .enumerate()
        .filter(|(_, &id)| !deja_exemptes.contains(&id))
        .map(|(i, _)| i)
        .collect();
    let idx = if !candidats.is_empty() {
        candidats[rng.gen_range(0..candidats.len())]
    } else {
        rng.gen_range(0..ids.len())
    };
    let exempt = ids[idx];
    let restants = ids
        .iter()
        .enumerate()
        .filter(|&(i, _)| i != idx)
        .map(|(_, &id)| id)
        .collect();
    (Some(exempt), restants)
}

/// Retourne les ids des équipes déjà exemptées dans ce concours.
fn equipes_deja_exemptes(
    conn: &Connection,
    concours_id: i64,
) -> Result<HashSet<i64>, TirageError> {
    let mut stmt = conn.prepare(
        "SELECT r.equipe_a_id FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1 AND r.exempte = 1",
    )?;
    let ids = stmt
        .query_map([concours_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

// ---------------------------------------------------------------------------
// Helpers — contraintes métier
// ---------------------------------------------------------------------------

/// Construit l'ensemble des paires de même club (pour l'anti-club tour 1).
fn paires_meme_club(
    ids: &[i64],
    club_par_id: &HashMap<i64, Option<String>>,
) -> HashSet<(i64, i64)> {
    let mut interdites = HashSet::new();
    for i in 0..ids.len() {
        for j in (i + 1)..ids.len() {
            let a = ids[i];
            let b = ids[j];
            match (club_par_id.get(&a), club_par_id.get(&b)) {
                (Some(Some(ca)), Some(Some(cb))) if ca == cb => {
                    interdites.insert((a, b));
                }
                _ => {}
            }
        }
    }
    interdites
}

/// Renvoie l'ensemble des paires déjà disputées dans le concours (pour anti-doublon).
fn deja_joues_par_concours(
    conn: &Connection,
    concours_id: i64,
) -> Result<HashSet<(i64, i64)>, TirageError> {
    // On récupère toutes les rencontres non-exemptes du concours
    let mut stmt = conn.prepare(
        "SELECT r.equipe_a_id, r.equipe_b_id
         FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1 AND r.exempte = 0 AND r.equipe_b_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([concours_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut set = HashSet::new();
    for r in rows {
        let (a, b) = r?;
        set.insert((a, b));
        set.insert((b, a)); // symétrie pour est_interdite
    }
    Ok(set)
}

/// Victoires cumulées de chaque équipe jusqu'au dernier tour clos.
fn victoires_par_equipe(
    conn: &Connection,
    concours_id: i64,
) -> Result<HashMap<i64, i32>, TirageError> {
    // Une rencontre compte comme victoire si :
    // - exempte=1 (equipe_a gagne automatiquement)
    // - exempte=0 et score_a > score_b  → equipe_a gagne
    // - exempte=0 et score_b > score_a  → equipe_b gagne
    let mut stmt = conn.prepare(
        "SELECT r.equipe_a_id, r.equipe_b_id, r.score_a, r.score_b, r.exempte
         FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1 AND r.statut = 'jouee'",
    )?;
    let mut victoires: HashMap<i64, i32> = HashMap::new();
    let rows = stmt.query_map([concours_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, i32>(4)?,
        ))
    })?;
    for r in rows {
        let (a_id, b_id_opt, score_a, score_b, exempte) = r?;
        if exempte != 0 {
            // Exempte : victoire automatique pour equipe_a
            *victoires.entry(a_id).or_insert(0) += 1;
        } else if let (Some(sa), Some(sb)) = (score_a, score_b) {
            match sa.cmp(&sb) {
                std::cmp::Ordering::Greater => {
                    *victoires.entry(a_id).or_insert(0) += 1;
                }
                std::cmp::Ordering::Less => {
                    if let Some(b_id) = b_id_opt {
                        *victoires.entry(b_id).or_insert(0) += 1;
                    }
                }
                std::cmp::Ordering::Equal => {} // match nul : aucune victoire (rare)
            }
        }
    }
    Ok(victoires)
}

/// Goal average cumulé de chaque équipe (points marqués − encaissés).
fn goal_average_par_equipe(
    conn: &Connection,
    concours_id: i64,
) -> Result<HashMap<i64, i32>, TirageError> {
    let mut stmt = conn.prepare(
        "SELECT r.equipe_a_id, r.equipe_b_id, r.score_a, r.score_b, r.exempte
         FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1 AND r.statut = 'jouee'",
    )?;
    let mut ga: HashMap<i64, i32> = HashMap::new();
    let rows = stmt.query_map([concours_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, i32>(4)?,
        ))
    })?;
    for r in rows {
        let (a_id, b_id_opt, score_a, score_b, exempte) = r?;
        if exempte != 0 {
            // Victoire fictive 13-0
            *ga.entry(a_id).or_insert(0) += 13;
        } else if let (Some(sa), Some(sb)) = (score_a, score_b) {
            *ga.entry(a_id).or_insert(0) += (sa - sb) as i32;
            if let Some(b_id) = b_id_opt {
                *ga.entry(b_id).or_insert(0) += (sb - sa) as i32;
            }
        }
    }
    Ok(ga)
}

// ---------------------------------------------------------------------------
// Persistance
// ---------------------------------------------------------------------------

fn creer_tour(
    conn: &Connection,
    concours_id: i64,
    numero: u8,
) -> Result<Tour, TirageError> {
    let tour = Tour {
        id: 0, // sera écrasé par last_insert_rowid
        concours_id,
        numero,
        statut: StatutTour::Ouvert,
    };
    let id = db::insert_tour(conn, &tour)?;
    Ok(Tour { id, ..tour })
}

fn inserer_rencontres(
    conn: &Connection,
    tour_id: i64,
    paires: &[(i64, i64)],
    exempt_ids: &[i64],
    concours: &Concours,
) -> Result<(), TirageError> {
    // Rencontres normales
    for (terrain, &(a, b)) in paires.iter().enumerate() {
        let r = Rencontre {
            id: 0,
            tour_id,
            equipe_a_id: a,
            equipe_b_id: Some(b),
            score_a: None,
            score_b: None,
            terrain: Some(terrain as i64 + 1),
            statut: StatutRencontre::AJouer,
            exempte: false,
        };
        db::insert_rencontre(conn, &r)?;
    }

    // Rencontres exemptes (une par paquet impair)
    for &exempt in exempt_ids {
        let (score_a, score_b) = match concours.regle_exempte.as_str() {
            "score_fictif" => (Some(13), Some(0)),
            _ => (Some(0), Some(0)), // score_nul
        };
        let r = Rencontre {
            id: 0,
            tour_id,
            equipe_a_id: exempt,
            equipe_b_id: None,
            score_a,
            score_b,
            terrain: None,
            statut: StatutRencontre::Jouee, // validée automatiquement
            exempte: true,
        };
        db::insert_rencontre(conn, &r)?;
    }

    Ok(())
}

/// Attribue des numéros de tirage aux équipes (1-based, ordre des paires).
fn numeroter_equipes(
    conn: &Connection,
    _ids_pairs: &[i64],
    paires: &[(i64, i64)],
    exempt_ids: &[i64],
) -> Result<(), TirageError> {
    let mut numero = 1i64;
    for &(a, b) in paires {
        conn.execute(
            "UPDATE equipes SET numero_tirage = ?1 WHERE id = ?2",
            rusqlite::params![numero, a],
        )?;
        numero += 1;
        conn.execute(
            "UPDATE equipes SET numero_tirage = ?1 WHERE id = ?2",
            rusqlite::params![numero, b],
        )?;
        numero += 1;
    }
    for &e in exempt_ids {
        conn.execute(
            "UPDATE equipes SET numero_tirage = ?1 WHERE id = ?2",
            rusqlite::params![numero, e],
        )?;
        numero += 1;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn set(pairs: &[(i64, i64)]) -> HashSet<(i64, i64)> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn paires_sans_contrainte() {
        let ids = vec![1, 2, 3, 4, 5, 6];
        let (paires, forces) = tirer_paires(&ids, &HashSet::new());
        assert_eq!(paires.len(), 3);
        assert!(forces.is_empty());
        // Chaque id apparaît exactement une fois
        let mut seen: HashSet<i64> = HashSet::new();
        for (a, b) in &paires {
            assert!(seen.insert(*a), "doublon id {a}");
            assert!(seen.insert(*b), "doublon id {b}");
        }
    }

    #[test]
    fn paires_evite_interdites() {
        // 4 équipes : 1 ne doit pas jouer contre 2, ni 3 contre 4
        // Solution forcée : (1,3) + (2,4) ou (1,4) + (2,3)
        let interdites = set(&[(1, 2), (3, 4)]);
        let (paires, forces) = tirer_paires(&[1, 2, 3, 4], &interdites);
        assert_eq!(paires.len(), 2);
        assert!(forces.is_empty(), "Ne doit pas forcer : {forces:?}");
        for &(a, b) in &paires {
            assert!(!est_interdite(a, b, &interdites));
        }
    }

    #[test]
    fn paires_force_si_impossible() {
        // 2 équipes qui se sont déjà rencontrées — impossible d'éviter
        let interdites = set(&[(1, 2)]);
        let (paires, forces) = tirer_paires(&[1, 2], &interdites);
        assert_eq!(paires.len(), 1);
        assert_eq!(forces.len(), 1);
    }

    #[test]
    fn extraire_exempt_impair() {
        let mut rng = rand::thread_rng();
        let ids = vec![1i64, 2, 3, 4, 5];
        let (exempt, restants) = extraire_exempt_prefere(&ids, &mut rng, &HashSet::new());
        assert!(exempt.is_some());
        assert_eq!(restants.len(), 4);
        let ex = exempt.unwrap();
        assert!(!restants.contains(&ex));
    }

    #[test]
    fn extraire_exempt_pair() {
        let mut rng = rand::thread_rng();
        let ids = vec![1i64, 2, 3, 4];
        let (exempt, restants) = extraire_exempt_prefere(&ids, &mut rng, &HashSet::new());
        assert!(exempt.is_none());
        assert_eq!(restants.len(), 4);
    }

    #[test]
    fn paires_meme_club_detecte() {
        let ids = vec![1, 2, 3];
        let mut clubs: HashMap<i64, Option<String>> = HashMap::new();
        clubs.insert(1, Some("Marseille".into()));
        clubs.insert(2, Some("Marseille".into()));
        clubs.insert(3, Some("Lyon".into()));
        let interdites = paires_meme_club(&ids, &clubs);
        assert!(interdites.contains(&(1, 2)));
        assert!(!interdites.contains(&(1, 3)));
    }
}
