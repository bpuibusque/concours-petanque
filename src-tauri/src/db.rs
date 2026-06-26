use rusqlite::{Connection, Result, params};
use std::path::Path;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/// Ouvre (ou crée) la base SQLite au chemin indiqué et applique toutes les
/// migrations dans l'ordre.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // WAL pour des écritures concurrentes sans blocage de lecture (autosave)
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version  INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if version < 1 {
        migration_v1(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (1)",
            [],
        )?;
    }

    Ok(())
}

fn migration_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        -- ----------------------------------------------------------------
        -- concours
        -- ----------------------------------------------------------------
        CREATE TABLE IF NOT EXISTS concours (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            nom             TEXT    NOT NULL,
            date            TEXT    NOT NULL,          -- ISO-8601 YYYY-MM-DD
            format_equipe   TEXT    NOT NULL            -- tete_a_tete | doublette | triplette
                            CHECK (format_equipe IN ('tete_a_tete','doublette','triplette')),
            nb_tours        INTEGER NOT NULL DEFAULT 4,
            anti_club_tour1 INTEGER NOT NULL DEFAULT 0, -- boolean 0/1
            regle_exempte   TEXT    NOT NULL DEFAULT 'score_fictif'
                            CHECK (regle_exempte IN ('score_nul','score_fictif'))
        );

        -- ----------------------------------------------------------------
        -- equipes
        -- ----------------------------------------------------------------
        CREATE TABLE IF NOT EXISTS equipes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            concours_id     INTEGER NOT NULL REFERENCES concours(id) ON DELETE CASCADE,
            nom             TEXT    NOT NULL,
            club            TEXT,
            numero_tirage   INTEGER             -- attribué lors du tirage, NULL jusqu'alors
        );

        CREATE INDEX IF NOT EXISTS idx_equipes_concours ON equipes(concours_id);

        -- ----------------------------------------------------------------
        -- joueurs
        -- ----------------------------------------------------------------
        CREATE TABLE IF NOT EXISTS joueurs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            equipe_id       INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
            nom             TEXT    NOT NULL,
            prenom          TEXT    NOT NULL,
            role            TEXT                -- tireur | pointeur | milieu | NULL
                            CHECK (role IS NULL OR role IN ('tireur','pointeur','milieu'))
        );

        CREATE INDEX IF NOT EXISTS idx_joueurs_equipe ON joueurs(equipe_id);

        -- ----------------------------------------------------------------
        -- tours
        -- ----------------------------------------------------------------
        CREATE TABLE IF NOT EXISTS tours (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            concours_id     INTEGER NOT NULL REFERENCES concours(id) ON DELETE CASCADE,
            numero          INTEGER NOT NULL,
            statut          TEXT    NOT NULL DEFAULT 'en_attente'
                            CHECK (statut IN ('en_attente','ouvert','clos')),
            UNIQUE (concours_id, numero)
        );

        CREATE INDEX IF NOT EXISTS idx_tours_concours ON tours(concours_id);

        -- ----------------------------------------------------------------
        -- rencontres
        -- ----------------------------------------------------------------
        CREATE TABLE IF NOT EXISTS rencontres (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            tour_id         INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
            equipe_a_id     INTEGER NOT NULL REFERENCES equipes(id),
            equipe_b_id     INTEGER          REFERENCES equipes(id), -- NULL si exempte
            score_a         INTEGER,          -- NULL tant que non saisie
            score_b         INTEGER,          -- NULL tant que non saisie ; 0 si exempte (score fictif)
            terrain         INTEGER,
            statut          TEXT    NOT NULL DEFAULT 'a_jouer'
                            CHECK (statut IN ('a_jouer','jouee','annulee')),
            exempte         INTEGER NOT NULL DEFAULT 0  -- boolean 0/1
        );

        CREATE INDEX IF NOT EXISTS idx_rencontres_tour    ON rencontres(tour_id);
        CREATE INDEX IF NOT EXISTS idx_rencontres_eq_a    ON rencontres(equipe_a_id);
        CREATE INDEX IF NOT EXISTS idx_rencontres_eq_b    ON rencontres(equipe_b_id);
    ")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers CRUD basiques — la logique métier vit dans tirage.rs / classement.rs
// ---------------------------------------------------------------------------

use crate::models::{
    Concours, Equipe, FormatEquipe, Joueur, Rencontre, RoleJoueur, StatutRencontre, StatutTour,
    Tour,
};

// --- Concours ---------------------------------------------------------------

pub fn insert_concours(conn: &Connection, c: &Concours) -> Result<i64> {
    conn.execute(
        "INSERT INTO concours (nom, date, format_equipe, nb_tours, anti_club_tour1, regle_exempte)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            c.nom,
            c.date,
            c.format_equipe.as_str(),
            c.nb_tours,
            c.anti_club_tour1 as i32,
            c.regle_exempte,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_concours(conn: &Connection, id: i64) -> Result<Option<Concours>> {
    let mut stmt = conn.prepare(
        "SELECT id, nom, date, format_equipe, nb_tours, anti_club_tour1, regle_exempte
         FROM concours WHERE id = ?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_concours(row)?))
    } else {
        Ok(None)
    }
}

fn row_to_concours(row: &rusqlite::Row<'_>) -> Result<Concours> {
    Ok(Concours {
        id: row.get(0)?,
        nom: row.get(1)?,
        date: row.get(2)?,
        format_equipe: FormatEquipe::from_str(&row.get::<_, String>(3)?)
            .unwrap_or(FormatEquipe::Doublette),
        nb_tours: row.get::<_, u8>(4)?,
        anti_club_tour1: row.get::<_, i32>(5)? != 0,
        regle_exempte: row.get(6)?,
    })
}

// --- Equipes ----------------------------------------------------------------

pub fn insert_equipe(conn: &Connection, e: &Equipe) -> Result<i64> {
    conn.execute(
        "INSERT INTO equipes (concours_id, nom, club, numero_tirage) VALUES (?1, ?2, ?3, ?4)",
        params![e.concours_id, e.nom, e.club, e.numero_tirage],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_equipes(conn: &Connection, concours_id: i64) -> Result<Vec<Equipe>> {
    let mut stmt = conn.prepare(
        "SELECT id, concours_id, nom, club, numero_tirage
         FROM equipes WHERE concours_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([concours_id], |row| {
        Ok(Equipe {
            id: row.get(0)?,
            concours_id: row.get(1)?,
            nom: row.get(2)?,
            club: row.get(3)?,
            numero_tirage: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn count_equipes(conn: &Connection, concours_id: i64) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM equipes WHERE concours_id = ?1",
        [concours_id],
        |r| r.get(0),
    )
}

// --- Joueurs ----------------------------------------------------------------

pub fn insert_joueur(conn: &Connection, j: &Joueur) -> Result<i64> {
    conn.execute(
        "INSERT INTO joueurs (equipe_id, nom, prenom, role) VALUES (?1, ?2, ?3, ?4)",
        params![
            j.equipe_id,
            j.nom,
            j.prenom,
            j.role.as_ref().map(|r| r.as_str()),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_joueurs(conn: &Connection, equipe_id: i64) -> Result<Vec<Joueur>> {
    let mut stmt = conn.prepare(
        "SELECT id, equipe_id, nom, prenom, role FROM joueurs WHERE equipe_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([equipe_id], |row| {
        Ok(Joueur {
            id: row.get(0)?,
            equipe_id: row.get(1)?,
            nom: row.get(2)?,
            prenom: row.get(3)?,
            role: row
                .get::<_, Option<String>>(4)?
                .as_deref()
                .and_then(RoleJoueur::from_str),
        })
    })?;
    rows.collect()
}

// --- Tours ------------------------------------------------------------------

pub fn insert_tour(conn: &Connection, t: &Tour) -> Result<i64> {
    conn.execute(
        "INSERT INTO tours (concours_id, numero, statut) VALUES (?1, ?2, ?3)",
        params![t.concours_id, t.numero, t.statut.as_str()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_tour(conn: &Connection, id: i64) -> Result<Option<Tour>> {
    let mut stmt = conn.prepare(
        "SELECT id, concours_id, numero, statut FROM tours WHERE id = ?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_tour(row)?))
    } else {
        Ok(None)
    }
}

pub fn list_tours(conn: &Connection, concours_id: i64) -> Result<Vec<Tour>> {
    let mut stmt = conn.prepare(
        "SELECT id, concours_id, numero, statut FROM tours
         WHERE concours_id = ?1 ORDER BY numero",
    )?;
    let rows = stmt.query_map([concours_id], |row| row_to_tour(row))?;
    rows.collect()
}

pub fn update_statut_tour(conn: &Connection, tour_id: i64, statut: &StatutTour) -> Result<()> {
    conn.execute(
        "UPDATE tours SET statut = ?1 WHERE id = ?2",
        params![statut.as_str(), tour_id],
    )?;
    Ok(())
}

fn row_to_tour(row: &rusqlite::Row<'_>) -> Result<Tour> {
    Ok(Tour {
        id: row.get(0)?,
        concours_id: row.get(1)?,
        numero: row.get::<_, u8>(2)?,
        statut: StatutTour::from_str(&row.get::<_, String>(3)?)
            .unwrap_or(StatutTour::EnAttente),
    })
}

// --- Rencontres -------------------------------------------------------------

pub fn insert_rencontre(conn: &Connection, r: &Rencontre) -> Result<i64> {
    conn.execute(
        "INSERT INTO rencontres
            (tour_id, equipe_a_id, equipe_b_id, score_a, score_b, terrain, statut, exempte)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            r.tour_id,
            r.equipe_a_id,
            r.equipe_b_id,
            r.score_a,
            r.score_b,
            r.terrain,
            r.statut.as_str(),
            r.exempte as i32,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_rencontres_tour(conn: &Connection, tour_id: i64) -> Result<Vec<Rencontre>> {
    let mut stmt = conn.prepare(
        "SELECT id, tour_id, equipe_a_id, equipe_b_id, score_a, score_b, terrain, statut, exempte
         FROM rencontres WHERE tour_id = ?1 ORDER BY terrain, id",
    )?;
    let rows = stmt.query_map([tour_id], |row| row_to_rencontre(row))?;
    rows.collect()
}

pub fn update_score_rencontre(
    conn: &Connection,
    rencontre_id: i64,
    score_a: i64,
    score_b: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE rencontres SET score_a = ?1, score_b = ?2, statut = 'jouee' WHERE id = ?3",
        params![score_a, score_b, rencontre_id],
    )?;
    Ok(())
}

pub fn annuler_score_rencontre(conn: &Connection, rencontre_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE rencontres SET score_a = NULL, score_b = NULL, statut = 'a_jouer' WHERE id = ?1",
        [rencontre_id],
    )?;
    Ok(())
}

pub fn tous_resultats_saisis(conn: &Connection, tour_id: i64) -> Result<bool> {
    let nb_restants: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rencontres
         WHERE tour_id = ?1 AND statut = 'a_jouer'",
        [tour_id],
        |r| r.get(0),
    )?;
    Ok(nb_restants == 0)
}

fn row_to_rencontre(row: &rusqlite::Row<'_>) -> Result<Rencontre> {
    Ok(Rencontre {
        id: row.get(0)?,
        tour_id: row.get(1)?,
        equipe_a_id: row.get(2)?,
        equipe_b_id: row.get(3)?,
        score_a: row.get(4)?,
        score_b: row.get(5)?,
        terrain: row.get(6)?,
        statut: StatutRencontre::from_str(&row.get::<_, String>(7)?)
            .unwrap_or(StatutRencontre::AJouer),
        exempte: row.get::<_, i32>(8)? != 0,
    })
}
