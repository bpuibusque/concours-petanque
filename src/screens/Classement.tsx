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
    return String(rang);
  }

  function rangClass(rang: number) {
    if (rang <= 3) return `rang-top rang-${rang}`;
    return '';
  }

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Classement général</h1>
          <p>Tri : parties gagnées · goal average · points marqués bruts</p>
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
                  <th style={{ width: 50 }} className="td-center">Rang</th>
                  <th>Équipe / Joueurs</th>
                  <th style={{ width: 50 }} className="td-center" title="Parties gagnées">V</th>
                  <th style={{ width: 70 }} className="td-center" title="Goal average (marqués − encaissés)">G.A.</th>
                  <th style={{ width: 60 }} className="td-center" title="Points marqués">Pour</th>
                  <th style={{ width: 60 }} className="td-center" title="Points encaissés">Contre</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(l => (
                  <tr key={l.equipe_id} className={rangClass(l.rang)}>
                    <td className="td-center rang-cell" style={{ fontWeight: 700, fontSize: l.rang <= 3 ? 16 : 13 }}>
                      {rangLabel(l.rang)}
                    </td>
                    <td>
                      <span style={{ fontWeight: l.rang <= 3 ? 700 : 600 }}>{l.equipe_nom}</span>
                      {l.joueurs.length > 0 && (
                        <span className="td-joueurs"> · {l.joueurs.join(' · ')}</span>
                      )}
                    </td>
                    <td className="td-center" style={{ fontWeight: 700, fontSize: 15 }}>
                      {l.parties_gagnees}
                    </td>
                    <td className={`td-center ${gaClass(l.goal_average)}`}>
                      {l.goal_average > 0 ? '+' : ''}{l.goal_average}
                    </td>
                    <td className="td-center text-muted">{l.points_marques}</td>
                    <td className="td-center text-muted">{l.points_encaisses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
