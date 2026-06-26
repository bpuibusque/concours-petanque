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
    api.listEquipes().then(async (eqs) => {
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
    ? equipes.filter(e => e.joueurs.some(j => j.prenom.toLowerCase().includes(filtre.toLowerCase())))
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
        <div className="form-group" style={{ marginBottom: filtre && filtrees.length > 0 ? 8 : 0 }}>
          <label>Rechercher par prénom</label>
          <input
            value={filtre}
            onChange={e => setFiltre(e.target.value)}
            placeholder="Ex : Martin…"
            autoFocus
          />
        </div>

        {filtre.length > 0 && filtrees.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
        <div className="card" style={{ padding: 0 }}>
          {/* En-tête équipe */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex-between">
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-primary)' }}>
                  {parcoursEquipe.nom}
                </span>
                <span className="td-joueurs" style={{ marginLeft: 8 }}>
                  {parcoursEquipe.joueurs.map(j => j.prenom).join(' · ')}
                </span>
              </div>
              <div className="flex-row">
                <span className="badge badge-ok">{totalV} victoire{totalV !== 1 ? 's' : ''}</span>
                <span className={`badge ${ga >= 0 ? 'badge-ok' : 'badge-err'}`}>
                  G.A. {ga > 0 ? '+' : ''}{ga}
                </span>
                <span className="badge badge-muted">{totalPour} pts marqués</span>
              </div>
            </div>
          </div>

          {/* Table parcours */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Tour</th>
                  <th>Adversaire</th>
                  <th style={{ width: 100 }} className="td-center">Score</th>
                  <th style={{ width: 90 }} className="td-center">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {parcours.tours.map(t => {
                  const aGagne = t.victoire === true || t.exempte;
                  return (
                    <tr key={t.tour_numero}>
                      <td style={{ fontWeight: 600, color: 'var(--c-primary)' }}>Tour {t.tour_numero}</td>
                      <td>
                        {t.exempte
                          ? <span className="text-muted" style={{ fontStyle: 'italic' }}>Exempte (bye)</span>
                          : t.adversaire_nom
                            ? t.adversaire_nom
                            : <span className="text-muted">—</span>
                        }
                      </td>
                      <td className="td-center">
                        {t.exempte ? (
                          <span className="score-display">
                            <span className="s-win">13</span>
                            <span className="s-sep">—</span>
                            <span className="s-lose">0</span>
                          </span>
                        ) : t.score_equipe != null ? (
                          <span className="score-display">
                            <span className={aGagne ? 's-win' : 's-lose'}>{t.score_equipe}</span>
                            <span className="s-sep">—</span>
                            <span className={!aGagne ? 's-win' : 's-lose'}>{t.score_adversaire}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="td-center">
                        {t.exempte
                          ? <span className="badge badge-blue">Bye</span>
                          : t.victoire === null
                            ? <span className="badge badge-muted">À jouer</span>
                            : t.victoire
                              ? <span className="badge badge-ok">Victoire</span>
                              : <span className="badge badge-err">Défaite</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
