import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/invoke';
import type { LigneClassement } from '../lib/types';

export default function Classement() {
  const [lignes, setLignes] = useState<LigneClassement[]>([]);
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(true);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      setLignes(await api.getClassement());
      setErreur('');
    } catch (e) {
      setErreur(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  function gaClass(ga: number) {
    if (ga > 0) return 'ga-positive';
    if (ga < 0) return 'ga-negative';
    return '';
  }

  function rangLabel(rang: number) {
    if (rang === 1) return '🥇';
    if (rang === 2) return '🥈';
    if (rang === 3) return '🥉';
    return rang;
  }

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Classement général</h1>
          <p>Mis à jour en temps réel à chaque score validé</p>
        </div>
        <button className="btn btn-ghost" onClick={charger} disabled={loading}>
          {loading ? 'Chargement…' : '↺ Actualiser'}
        </button>
      </div>

      {erreur && <div className="alert alert-err">{erreur}</div>}

      {!loading && lignes.length === 0 && (
        <div className="alert alert-warn">Aucun résultat encore saisi.</div>
      )}

      {lignes.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Équipe</th>
                  <th className="td-num">V</th>
                  <th className="td-num">G.A.</th>
                  <th className="td-num">Pour</th>
                  <th className="td-num">Contre</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(l => (
                  <tr key={l.equipe_id} className={l.rang === 1 ? 'rang-1' : ''}>
                    <td className="td-center" style={{ fontWeight: 700 }}>{rangLabel(l.rang)}</td>
                    <td style={{ fontWeight: l.rang <= 3 ? 700 : 400 }}>
                      {l.equipe_nom}
                      {l.joueurs.length > 0 && (
                        <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                          · {l.joueurs.join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="td-num" style={{ fontWeight: 700 }}>{l.parties_gagnees}</td>
                    <td className={`td-num ${gaClass(l.goal_average)}`}>
                      {l.goal_average > 0 ? '+' : ''}{l.goal_average}
                    </td>
                    <td className="td-num">{l.points_marques}</td>
                    <td className="td-num">{l.points_encaisses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-muted text-sm mt-8">
        Critères : victoires · goal average (marqués − encaissés) · points marqués bruts
      </div>
    </div>
  );
}
