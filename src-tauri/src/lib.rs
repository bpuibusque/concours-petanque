pub mod classement;
pub mod db;
pub mod models;
pub mod tirage;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use models::{
    Concours, Equipe, FormatEquipe, Joueur, LigneClassement, ParcoursEquipe, RencontreDetail,
    RoleJoueur, Tour,
};

// ---------------------------------------------------------------------------
// État applicatif partagé
// ---------------------------------------------------------------------------

pub struct AppState {
    db: Mutex<Option<rusqlite::Connection>>,
    concours_id: Mutex<Option<i64>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db: Mutex::new(None),
            concours_id: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

fn concours_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let dir = docs.join("ConcoursPetanque");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn current_concours_id(state: &AppState) -> Result<i64, String> {
    state
        .concours_id
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Aucun concours ouvert".into())
}

fn with_db<F, T>(state: &AppState, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
{
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Aucun concours ouvert")?;
    f(conn)
}

fn stocker_connexion(state: &AppState, conn: rusqlite::Connection, concours_id: i64) -> Result<(), String> {
    *state.db.lock().map_err(|e| e.to_string())? = Some(conn);
    *state.concours_id.lock().map_err(|e| e.to_string())? = Some(concours_id);
    Ok(())
}

fn enrichir_rencontre(
    r: &models::Rencontre,
    numero_map: &std::collections::HashMap<i64, usize>,
    joueurs_map: &std::collections::HashMap<i64, Vec<String>>,
) -> RencontreDetail {
    let nom = |id: i64| format!("Équipe {}", numero_map.get(&id).copied().unwrap_or(0));
    RencontreDetail {
        id: r.id,
        tour_id: r.tour_id,
        equipe_a_id: r.equipe_a_id,
        equipe_a_nom: nom(r.equipe_a_id),
        equipe_a_joueurs: joueurs_map.get(&r.equipe_a_id).cloned().unwrap_or_default(),
        equipe_b_id: r.equipe_b_id,
        equipe_b_nom: r.equipe_b_id.map(nom),
        equipe_b_joueurs: r.equipe_b_id
            .and_then(|id| joueurs_map.get(&id))
            .cloned()
            .unwrap_or_default(),
        score_a: r.score_a,
        score_b: r.score_b,
        terrain: r.terrain,
        statut: r.statut.clone(),
        exempte: r.exempte,
    }
}

// ---------------------------------------------------------------------------
// Commands — gestion du fichier concours
// ---------------------------------------------------------------------------

#[tauri::command]
fn creer_concours(
    state: State<AppState>,
    app: AppHandle,
    nom: String,
    date: String,
    format_equipe: String,
    nb_tours: u8,
    anti_club_tour1: bool,
    regle_exempte: String,
) -> Result<Concours, String> {
    let format = FormatEquipe::from_str(&format_equipe)
        .ok_or_else(|| format!("Format équipe invalide : {format_equipe}"))?;

    let dir = concours_dir(&app)?;
    let safe = nom
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let path = dir.join(format!("{safe}_{date}.sqlite"));

    let conn = db::open(&path).map_err(|e| e.to_string())?;
    let c = Concours { id: 0, nom, date, format_equipe: format, nb_tours, anti_club_tour1, regle_exempte };
    let id = db::insert_concours(&conn, &c).map_err(|e| e.to_string())?;
    let concours = db::get_concours(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("Concours introuvable après création")?;

    stocker_connexion(&state, conn, id)?;
    Ok(concours)
}

#[tauri::command]
fn ouvrir_concours(state: State<AppState>, path: String) -> Result<Concours, String> {
    let conn = db::open(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row("SELECT id FROM concours LIMIT 1", [], |r| r.get(0))
        .map_err(|_| "Fichier invalide ou concours introuvable")?;
    let concours = db::get_concours(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("Concours introuvable")?;
    stocker_connexion(&state, conn, id)?;
    Ok(concours)
}

#[tauri::command]
fn lister_fichiers_concours(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = concours_dir(&app)?;
    let mut fichiers = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("sqlite") {
            fichiers.push(p.to_string_lossy().into_owned());
        }
    }
    fichiers.sort();
    Ok(fichiers)
}

#[tauri::command]
fn get_concours_courant(state: State<AppState>) -> Result<Concours, String> {
    let id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        db::get_concours(conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Concours introuvable".into())
    })
}

/// Supprime définitivement un fichier .sqlite de concours.
#[tauri::command]
fn supprimer_fichier_concours(
    state: State<AppState>,
    path: String,
) -> Result<(), String> {
    // Lire le chemin du fichier courant SANS garder le lock ouvert
    let est_ouvert: bool = {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            None => false,
            Some(conn) => {
                let src: String = conn
                    .query_row("PRAGMA database_list", [], |r| r.get(2))
                    .unwrap_or_default();
                src == path
            }
        }
    }; // guard libéré ici

    if est_ouvert {
        *state.db.lock().map_err(|e| e.to_string())? = None;
        *state.concours_id.lock().map_err(|e| e.to_string())? = None;
    }

    for suffix in &["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{path}{suffix}"));
    }
    Ok(())
}

#[tauri::command]
fn exporter_concours(state: State<AppState>, destination: String) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(FULL);").map_err(|e| e.to_string())?;
        let src: String = conn
            .query_row("PRAGMA database_list", [], |r| r.get(2))
            .map_err(|e| e.to_string())?;
        std::fs::copy(&src, &destination).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Commands — équipes
// ---------------------------------------------------------------------------

/// Inscrit une nouvelle équipe avec un numéro automatique (Équipe 1, 2, 3…).
#[tauri::command]
fn inscrire_equipe(state: State<AppState>) -> Result<Equipe, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        let tours = db::list_tours(conn, concours_id).map_err(|e| e.to_string())?;
        if tours.iter().any(|t| t.numero == 1 && t.statut != models::StatutTour::EnAttente) {
            return Err("Les inscriptions sont closes (tour 1 déjà tiré)".into());
        }
        let count = db::count_equipes(conn, concours_id).map_err(|e| e.to_string())?;
        let nom = format!("Équipe {}", count + 1);
        let e = Equipe { id: 0, concours_id, nom, club: None, numero_tirage: None };
        let id = db::insert_equipe(conn, &e).map_err(|e| e.to_string())?;
        Ok(Equipe { id, ..e })
    })
}

#[tauri::command]
fn list_equipes(state: State<AppState>) -> Result<Vec<Equipe>, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        db::list_equipes(conn, concours_id).map_err(|e| e.to_string())
    })
}

/// Supprime une équipe (uniquement avant le tirage du tour 1).
#[tauri::command]
fn supprimer_equipe(state: State<AppState>, equipe_id: i64) -> Result<(), String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        let tours = db::list_tours(conn, concours_id).map_err(|e| e.to_string())?;
        if tours.iter().any(|t| t.numero == 1 && t.statut != models::StatutTour::EnAttente) {
            return Err("Suppression impossible après le tirage du tour 1".into());
        }
        conn.execute("DELETE FROM equipes WHERE id = ?1", [equipe_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn inscrire_joueur(
    state: State<AppState>,
    equipe_id: i64,
    nom: String,
    prenom: String,
    role: Option<String>,
) -> Result<Joueur, String> {
    with_db(&state, |conn| {
        let j = Joueur {
            id: 0,
            equipe_id,
            nom,
            prenom,
            role: role.as_deref().and_then(RoleJoueur::from_str),
        };
        let id = db::insert_joueur(conn, &j).map_err(|e| e.to_string())?;
        Ok(Joueur { id, ..j })
    })
}

#[tauri::command]
fn modifier_joueur(
    state: State<AppState>,
    joueur_id: i64,
    nom: String,
    prenom: String,
    role: Option<String>,
) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute(
            "UPDATE joueurs SET nom = ?1, prenom = ?2, role = ?3 WHERE id = ?4",
            rusqlite::params![nom, prenom, role, joueur_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn supprimer_joueur(state: State<AppState>, joueur_id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("DELETE FROM joueurs WHERE id = ?1", [joueur_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn list_joueurs(state: State<AppState>, equipe_id: i64) -> Result<Vec<Joueur>, String> {
    with_db(&state, |conn| {
        db::list_joueurs(conn, equipe_id).map_err(|e| e.to_string())
    })
}

// ---------------------------------------------------------------------------
// Commands — tirage
// ---------------------------------------------------------------------------

#[tauri::command]
fn tirer_prochain_tour(state: State<AppState>) -> Result<tirage::TirageInfo, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        tirage::tirer_prochain_tour(conn, concours_id).map_err(|e| e.to_string())
    })
}

// ---------------------------------------------------------------------------
// Commands — tours & rencontres
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_tours(state: State<AppState>) -> Result<Vec<Tour>, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        db::list_tours(conn, concours_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn list_rencontres_tour(state: State<AppState>, tour_id: i64) -> Result<Vec<RencontreDetail>, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        let rencontres = db::list_rencontres_tour(conn, tour_id).map_err(|e| e.to_string())?;
        let equipes = db::list_equipes(conn, concours_id).map_err(|e| e.to_string())?;

        // numero_map: equipe_id → position 1-based dans la liste triée par id
        let numero_map: std::collections::HashMap<i64, usize> = equipes
            .iter()
            .enumerate()
            .map(|(i, e)| (e.id, i + 1))
            .collect();

        // joueurs_map: equipe_id → vec de prénoms
        let mut joueurs_map: std::collections::HashMap<i64, Vec<String>> =
            std::collections::HashMap::new();
        for e in &equipes {
            let joueurs = db::list_joueurs(conn, e.id).map_err(|e| e.to_string())?;
            joueurs_map.insert(e.id, joueurs.into_iter().map(|j| j.prenom).collect());
        }

        Ok(rencontres
            .iter()
            .map(|r| enrichir_rencontre(r, &numero_map, &joueurs_map))
            .collect())
    })
}

#[tauri::command]
fn saisir_score(
    state: State<AppState>,
    rencontre_id: i64,
    score_a: i64,
    score_b: i64,
) -> Result<(), String> {
    with_db(&state, |conn| {
        db::update_score_rencontre(conn, rencontre_id, score_a, score_b)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn annuler_score(state: State<AppState>, rencontre_id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        db::annuler_score_rencontre(conn, rencontre_id).map_err(|e| e.to_string())
    })
}

// ---------------------------------------------------------------------------
// Commands — classement & parcours
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_classement(state: State<AppState>) -> Result<Vec<LigneClassement>, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        classement::calculer_classement(conn, concours_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_parcours_equipe(state: State<AppState>, equipe_id: i64) -> Result<ParcoursEquipe, String> {
    let concours_id = current_concours_id(&state)?;
    with_db(&state, |conn| {
        classement::parcours_equipe(conn, concours_id, equipe_id).map_err(|e| e.to_string())
    })
}

// ---------------------------------------------------------------------------
// Point d'entrée Tauri
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // concours
            creer_concours,
            ouvrir_concours,
            lister_fichiers_concours,
            get_concours_courant,
            supprimer_fichier_concours,
            exporter_concours,
            // équipes
            inscrire_equipe,
            list_equipes,
            supprimer_equipe,
            inscrire_joueur,
            modifier_joueur,
            supprimer_joueur,
            list_joueurs,
            // tirage
            tirer_prochain_tour,
            // tours & rencontres
            list_tours,
            list_rencontres_tour,
            saisir_score,
            annuler_score,
            // classement
            get_classement,
            get_parcours_equipe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
