import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/invoke';
import type { Equipe, Joueur, ParcoursEquipe } from '../lib/types';

interface EquipeAvecJoueurs extends Equipe {
  joueurs: Joueur[];
}

export default function Recherche() {
  const [equipes, setEquipes] = useState<EquipeAvecJoueurs[]>([]);
  const [filtre, setFiltre] = useState('');
  const [parcours, setParcours] = useState<ParcoursEquipe | null>(null);
  const [parcoursEquipe, setParcoursEquipe] = useState<EquipeAvecJoueurs | null>(null);
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listEquipes().then(async eqs => {
      const avec = await Promise.all(
        eqs.map(async (e, i) => ({
          ...e,
          nom: `Équipe ${i + 1}`,
          joueurs: await api.listJoueurs(e.id),
        }))
      );
      setEquipes(avec);
    }).catch(() => {});
  }, []);

  const filtrees = filtre.length > 0
    ? equipes.filter(e =>
        e.joueurs.some(j => j.prenom.toLowerCase().includes(filtre.toLowerCase()))
      )
    : [];

  const chargerParcours = useCallback(async (eq: EquipeAvecJoueurs) => {
    setLoading(true);
    setErreur('');
    try {
      setParcours(await api.getParcoursEquipe(eq.id));
      setParcoursEquipe(eq);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  function victoireIcon(v: boolean | null, exempte: boolean) {
    if (exempte) return '🎁';
    if (v === null) return '⏳';
    return v ? '✅' : '❌';
  }

  const totalV = parcours?.tours.filter(t => t.victoire === true || t.exempte).length ?? 0;
  const totalPour = parcours?.tours.reduce((s, t) => s + (t.score_equipe ?? 0), 0) ?? 0;
  const totalContre = parcours?.tours.reduce((s, t) => s + (t.score_adversaire ?? 0), 0) ?? 0;
  const ga = totalPour - totalContre;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Recherche d'équipe</h1>
        <p>Consultez le parcours complet d'une équipe</p>
      </div>

      <div className="card">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Rechercher par prénom(s)</label>
          <input
            value={filtre}
            onChange={e => setFiltre(e.target.value)}
            placeholder="Ex : Martin…"
            autoFocus
          />
        </div>

        {filtre.length > 0 && filtrees.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtrees.map(e => (
              <button
                key={e.id}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => { chargerParcours(e); setFiltre(''); }}
              >
                <strong>{e.nom}</strong>
                <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                  {e.joueurs.map(j => j.prenom).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )}
        {filtre.length > 0 && filtrees.length === 0 && (
          <p className="text-muted text-sm mt-8">Aucune équipe trouvée.</p>
        )}
      </div>

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {loading && <p className="text-muted">Chargement…</p>}

      {parcours && parcoursEquipe && !loading && (
        <div className="card">
          <div className="flex-between mb-8">
            <div className="card-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
              {parcoursEquipe.nom}
              <span className="text-muted text-sm" style={{ marginLeft: 8, fontWeight: 400 }}>
                {parcoursEquipe.joueurs.map(j => j.prenom).join(' · ')}
              </span>
            </div>
            <div className="flex-row">
              <span className="badge badge-ok">{totalV} victoire{totalV > 1 ? 's' : ''}</span>
              <span className={`badge ${ga >= 0 ? 'badge-ok' : 'badge-err'}`}>
                GA {ga > 0 ? '+' : ''}{ga}
              </span>
              <span className="badge badge-muted">{totalPour} pts marqués</span>
            </div>
          </div>

          <div className="parcours-grid">
            {parcours.tours.map(t => {
              const aGagne = t.victoire === true || t.exempte;
              return (
                <div key={t.tour_numero} className="parcours-tour">
                  <div className="parcours-tour-num">Tour {t.tour_numero}</div>
                  <div className="parcours-victoire">{victoireIcon(t.victoire, t.exempte)}</div>
                  {t.exempte ? (
                    <>
                      <div className="parcours-score" style={{ color: 'var(--c-ok)' }}>13 — 0</div>
                      <div className="parcours-adversaire">Exempte</div>
                    </>
                  ) : t.score_equipe != null ? (
                    <>
                      <div className="parcours-score" style={{ color: aGagne ? 'var(--c-ok)' : 'var(--c-err)' }}>
                        {t.score_equipe} — {t.score_adversaire}
                      </div>
                      <div className="parcours-adversaire">vs {t.adversaire_nom ?? '—'}</div>
                    </>
                  ) : (
                    <>
                      <div className="parcours-score text-muted">—</div>
                      <div className="parcours-adversaire">
                        {t.adversaire_nom ? `vs ${t.adversaire_nom}` : 'Non joué'}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
