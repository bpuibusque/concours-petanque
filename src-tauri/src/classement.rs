use rusqlite::Connection;

use crate::db;
use crate::models::{LigneClassement, ParcoursEquipe, ParcoursTour};

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum ClassementError {
    #[error("Concours introuvable")]
    ConcoursIntrouvable,
    #[error("Équipe introuvable")]
    EquipeIntrouvable,
    #[error("Erreur base de données : {0}")]
    Db(String),
}

impl From<rusqlite::Error> for ClassementError {
    fn from(e: rusqlite::Error) -> Self {
        ClassementError::Db(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Classement général
// ---------------------------------------------------------------------------

/// Calcule le classement de toutes les équipes du concours.
///
/// Critères de tri :
/// 1. Parties gagnées (décroissant)
/// 2. Goal average = points marqués − points encaissés (décroissant)
/// 3. Points marqués bruts (décroissant)
/// 4. Égalité → rang partagé
pub fn calculer_classement(
    conn: &Connection,
    concours_id: i64,
) -> Result<Vec<LigneClassement>, ClassementError> {
    let equipes = db::list_equipes(conn, concours_id)?;

    let mut lignes: Vec<LigneClassement> = equipes
        .iter()
        .enumerate()
        .map(|(pos, e)| {
            let stats = stats_equipe(conn, concours_id, e.id)?;
            let joueurs = db::list_joueurs(conn, e.id)
                .map_err(|err| ClassementError::Db(err.to_string()))?;
            Ok(LigneClassement {
                rang: 0,
                equipe_id: e.id,
                equipe_nom: format!("Équipe {}", pos + 1),
                joueurs: joueurs.into_iter().map(|j| j.prenom).collect(),
                club: e.club.clone(),
                parties_gagnees: stats.victoires,
                goal_average: stats.points_marques - stats.points_encaisses,
                points_marques: stats.points_marques,
                points_encaisses: stats.points_encaisses,
            })
        })
        .collect::<Result<_, ClassementError>>()?;

    // Tri stable : victoires desc, GA desc, points bruts desc
    lignes.sort_by(|a, b| {
        b.parties_gagnees
            .cmp(&a.parties_gagnees)
            .then_with(|| b.goal_average.cmp(&a.goal_average))
            .then_with(|| b.points_marques.cmp(&a.points_marques))
    });

    // Attribution des rangs — à égalité parfaite : rang partagé
    attribuer_rangs(&mut lignes);

    Ok(lignes)
}

fn attribuer_rangs(lignes: &mut [LigneClassement]) {
    let mut rang = 1u32;
    for i in 0..lignes.len() {
        if i == 0 {
            lignes[0].rang = 1;
        } else {
            let meme_rang = lignes[i].parties_gagnees == lignes[i - 1].parties_gagnees
                && lignes[i].goal_average == lignes[i - 1].goal_average
                && lignes[i].points_marques == lignes[i - 1].points_marques;
            if !meme_rang {
                rang = i as u32 + 1;
            }
            lignes[i].rang = rang;
        }
    }
}

// ---------------------------------------------------------------------------
// Parcours d'une équipe
// ---------------------------------------------------------------------------

/// Retourne le parcours détaillé d'une équipe (ses rencontres tour par tour).
pub fn parcours_equipe(
    conn: &Connection,
    concours_id: i64,
    equipe_id: i64,
) -> Result<ParcoursEquipe, ClassementError> {
    let equipes = db::list_equipes(conn, concours_id)?;

    // Positional map: equipe_id → "Équipe N"
    let nom_par_id: std::collections::HashMap<i64, String> = equipes
        .iter()
        .enumerate()
        .map(|(i, e)| (e.id, format!("Équipe {}", i + 1)))
        .collect();

    let equipe = equipes
        .iter()
        .find(|e| e.id == equipe_id)
        .ok_or(ClassementError::EquipeIntrouvable)?
        .clone();

    let tours = db::list_tours(conn, concours_id)?;
    let mut parcours_tours: Vec<ParcoursTour> = Vec::new();

    for tour in &tours {
        let rencontres = db::list_rencontres_tour(conn, tour.id)?;

        // Trouver la rencontre de cette équipe dans ce tour
        let rencontre = rencontres.iter().find(|r| {
            r.equipe_a_id == equipe_id
                || r.equipe_b_id.map_or(false, |b| b == equipe_id)
        });

        let pt = match rencontre {
            None => ParcoursTour {
                tour_numero: tour.numero,
                adversaire_id: None,
                adversaire_nom: None,
                score_equipe: None,
                score_adversaire: None,
                victoire: None,
                exempte: false,
            },
            Some(r) if r.exempte => ParcoursTour {
                tour_numero: tour.numero,
                adversaire_id: None,
                adversaire_nom: None,
                score_equipe: r.score_a,
                score_adversaire: r.score_b,
                victoire: Some(true),
                exempte: true,
            },
            Some(r) => {
                let equipe_est_a = r.equipe_a_id == equipe_id;
                let (score_eq, score_adv, adv_id) = if equipe_est_a {
                    (r.score_a, r.score_b, r.equipe_b_id)
                } else {
                    (r.score_b, r.score_a, Some(r.equipe_a_id))
                };

                let adv_nom = adv_id.and_then(|id| nom_par_id.get(&id).cloned());

                let victoire = match (score_eq, score_adv) {
                    (Some(se), Some(sa)) => Some(se > sa),
                    _ => None,
                };

                ParcoursTour {
                    tour_numero: tour.numero,
                    adversaire_id: adv_id,
                    adversaire_nom: adv_nom,
                    score_equipe: score_eq,
                    score_adversaire: score_adv,
                    victoire,
                    exempte: false,
                }
            }
        };

        parcours_tours.push(pt);
    }

    Ok(ParcoursEquipe {
        equipe,
        tours: parcours_tours,
    })
}

// ---------------------------------------------------------------------------
// Stats internes
// ---------------------------------------------------------------------------

struct StatsEquipe {
    victoires: i32,
    points_marques: i32,
    points_encaisses: i32,
}

/// Calcule les stats brutes d'une équipe à partir des rencontres jouées.
fn stats_equipe(
    conn: &Connection,
    concours_id: i64,
    equipe_id: i64,
) -> Result<StatsEquipe, ClassementError> {
    // Rencontres où l'équipe est en position A (y compris exemptes)
    let mut stmt_a = conn.prepare(
        "SELECT r.score_a, r.score_b, r.exempte
         FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1
           AND r.equipe_a_id = ?2
           AND r.statut = 'jouee'",
    )?;

    // Rencontres où l'équipe est en position B (jamais exempte par convention)
    let mut stmt_b = conn.prepare(
        "SELECT r.score_a, r.score_b
         FROM rencontres r
         JOIN tours t ON t.id = r.tour_id
         WHERE t.concours_id = ?1
           AND r.equipe_b_id = ?2
           AND r.statut = 'jouee'",
    )?;

    let mut victoires = 0i32;
    let mut points_marques = 0i32;
    let mut points_encaisses = 0i32;

    // Position A
    let rows_a = stmt_a.query_map([concours_id, equipe_id], |row| {
        Ok((
            row.get::<_, Option<i64>>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, i32>(2)?,
        ))
    })?;

    for r in rows_a {
        let (score_a, score_b, exempte) = r?;
        if exempte != 0 {
            // Exempte : victoire automatique, scores fictifs comptabilisés tels quels
            victoires += 1;
            points_marques += score_a.unwrap_or(0) as i32;
            points_encaisses += score_b.unwrap_or(0) as i32;
        } else if let (Some(sa), Some(sb)) = (score_a, score_b) {
            points_marques += sa as i32;
            points_encaisses += sb as i32;
            if sa > sb {
                victoires += 1;
            }
        }
    }

    // Position B
    let rows_b = stmt_b.query_map([concours_id, equipe_id], |row| {
        Ok((
            row.get::<_, Option<i64>>(0)?,
            row.get::<_, Option<i64>>(1)?,
        ))
    })?;

    for r in rows_b {
        let (score_a, score_b) = r?;
        if let (Some(sa), Some(sb)) = (score_a, score_b) {
            // L'équipe est B : ses points = score_b, encaissés = score_a
            points_marques += sb as i32;
            points_encaisses += sa as i32;
            if sb > sa {
                victoires += 1;
            }
        }
    }

    Ok(StatsEquipe {
        victoires,
        points_marques,
        points_encaisses,
    })
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ligne(victoires: i32, ga: i32, marques: i32) -> LigneClassement {
        LigneClassement {
            rang: 0,
            equipe_id: 0,
            equipe_nom: String::new(),
            joueurs: vec![],
            club: None,
            parties_gagnees: victoires,
            goal_average: ga,
            points_marques: marques,
            points_encaisses: marques - ga,
        }
    }

    #[test]
    fn tri_par_victoires() {
        let mut lignes = vec![
            make_ligne(1, 5, 20),
            make_ligne(3, 2, 30),
            make_ligne(2, 8, 25),
        ];
        lignes.sort_by(|a, b| {
            b.parties_gagnees
                .cmp(&a.parties_gagnees)
                .then_with(|| b.goal_average.cmp(&a.goal_average))
                .then_with(|| b.points_marques.cmp(&a.points_marques))
        });
        assert_eq!(lignes[0].parties_gagnees, 3);
        assert_eq!(lignes[1].parties_gagnees, 2);
        assert_eq!(lignes[2].parties_gagnees, 1);
    }

    #[test]
    fn tri_ga_departage() {
        let mut lignes = vec![
            make_ligne(2, 3, 20),
            make_ligne(2, 10, 25),
            make_ligne(2, -1, 15),
        ];
        lignes.sort_by(|a, b| {
            b.parties_gagnees
                .cmp(&a.parties_gagnees)
                .then_with(|| b.goal_average.cmp(&a.goal_average))
                .then_with(|| b.points_marques.cmp(&a.points_marques))
        });
        assert_eq!(lignes[0].goal_average, 10);
        assert_eq!(lignes[1].goal_average, 3);
        assert_eq!(lignes[2].goal_average, -1);
    }

    #[test]
    fn tri_points_bruts_departage() {
        // Même victoires, même GA → départage par points bruts
        let mut lignes = vec![
            make_ligne(2, 5, 18),
            make_ligne(2, 5, 25),
            make_ligne(2, 5, 20),
        ];
        lignes.sort_by(|a, b| {
            b.parties_gagnees
                .cmp(&a.parties_gagnees)
                .then_with(|| b.goal_average.cmp(&a.goal_average))
                .then_with(|| b.points_marques.cmp(&a.points_marques))
        });
        assert_eq!(lignes[0].points_marques, 25);
        assert_eq!(lignes[1].points_marques, 20);
        assert_eq!(lignes[2].points_marques, 18);
    }

    #[test]
    fn rang_partage_a_egalite_totale() {
        let mut lignes = vec![
            make_ligne(2, 5, 20),
            make_ligne(2, 5, 20), // même rang
            make_ligne(1, 8, 22),
        ];
        lignes.sort_by(|a, b| {
            b.parties_gagnees
                .cmp(&a.parties_gagnees)
                .then_with(|| b.goal_average.cmp(&a.goal_average))
                .then_with(|| b.points_marques.cmp(&a.points_marques))
        });
        attribuer_rangs(&mut lignes);
        assert_eq!(lignes[0].rang, 1);
        assert_eq!(lignes[1].rang, 1); // partagé
        assert_eq!(lignes[2].rang, 3); // saute le rang 2
    }

    #[test]
    fn rang_consecutif_sans_egalite() {
        let mut lignes = vec![
            make_ligne(3, 10, 30),
            make_ligne(2, 5, 20),
            make_ligne(1, 2, 15),
        ];
        lignes.sort_by(|a, b| {
            b.parties_gagnees
                .cmp(&a.parties_gagnees)
                .then_with(|| b.goal_average.cmp(&a.goal_average))
                .then_with(|| b.points_marques.cmp(&a.points_marques))
        });
        attribuer_rangs(&mut lignes);
        assert_eq!(lignes[0].rang, 1);
        assert_eq!(lignes[1].rang, 2);
        assert_eq!(lignes[2].rang, 3);
    }

    #[test]
    fn goal_average_peut_etre_negatif() {
        let l = make_ligne(1, -7, 10);
        assert_eq!(l.goal_average, -7);
        assert_eq!(l.points_encaisses, 17);
    }
}
