import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours, RencontreDetail, TirageInfo, Tour } from '../lib/types';

interface Props {
  concours: Concours;
  onSaisir: (tourId: number) => void;
}

export default function Tirage({ concours, onSaisir }: Props) {
  const [tours, setTours] = useState<Tour[]>([]);
  const [tourSelId, setTourSelId] = useState<number | null>(null);
  const [rencontres, setRencontres] = useState<RencontreDetail[]>([]);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [tirageLoading, setTirageLoading] = useState(false);

  const chargerTours = useCallback(async () => {
    try {
      const ts = await api.listTours();
      setTours(ts);
      if (ts.length > 0 && tourSelId === null) {
        setTourSelId(ts[ts.length - 1].id);
      }
    } catch (e) {
      setErreur(String(e));
    }
  }, [tourSelId]);

  const chargerRencontres = useCallback(async (tourId: number) => {
    setLoading(true);
    try {
      setRencontres(await api.listRencontresTour(tourId));
    } catch (e) {
      setErreur(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { chargerTours(); }, [chargerTours]);
  useEffect(() => { if (tourSelId) chargerRencontres(tourSelId); }, [tourSelId, chargerRencontres]);

  const tourCourant = tours.find(t => t.id === tourSelId);
  const dernierTour = tours[tours.length - 1];
  const peutTirer = dernierTour?.statut === 'clos' && tours.length < concours.nb_tours;

  async function lancerTirage() {
    setTirageLoading(true);
    setErreur('');
    setInfo('');
    try {
      const ti: TirageInfo = await api.tirerProchainTour();
      const msgs: string[] = [`Tour ${ti.tour_numero} tiré — ${ti.nb_rencontres} rencontre(s).`];
      if (ti.exempt_equipe_id.length > 0) msgs.push(`${ti.exempt_equipe_id.length} équipe(s) exemptée(s).`);
      if (ti.doublons_forces.length) msgs.push(`⚠ ${ti.doublons_forces.length} doublon(s) inévitable(s).`);
      setInfo(msgs.join(' '));
      await chargerTours();
      setTourSelId(ti.tour_id);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setTirageLoading(false);
    }
  }

  const normales  = rencontres.filter(r => !r.exempte);
  const exemptees = rencontres.filter(r => r.exempte);
  const jouees = normales.filter(r => r.statut === 'jouee').length;

  function statutTourLabel(s: Tour['statut']) {
    if (s === 'clos')    return <span className="badge badge-ok">Terminé</span>;
    if (s === 'ouvert')  return <span className="badge badge-warn">En cours</span>;
    return <span className="badge badge-muted">À tirer</span>;
  }

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Tableau des rencontres</h1>
          <p>{tours.length} tour{tours.length !== 1 ? 's' : ''} sur {concours.nb_tours}</p>
        </div>
        <div className="flex-row">
          {peutTirer && (
            <button className="btn btn-primary" disabled={tirageLoading} onClick={lancerTirage}>
              {tirageLoading ? 'Tirage en cours…' : `Tirer le tour ${(dernierTour?.numero ?? 0) + 1}`}
            </button>
          )}
          {tourCourant?.statut === 'ouvert' && (
            <button className="btn btn-secondary" onClick={() => onSaisir(tourCourant.id)}>
              Saisir les scores →
            </button>
          )}
        </div>
      </div>

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {info  && <div className="alert alert-ok">{info}</div>}
      {tours.length === 0 && (
        <div className="alert alert-warn">
          Aucun tour tiré. Rendez-vous dans l'onglet Équipes pour lancer le tour 1.
        </div>
      )}

      {/* Onglets tours */}
      {tours.length > 0 && (
        <div className="tour-tabs">
          {tours.map(t => (
            <button
              key={t.id}
              className={`tour-tab ${t.id === tourSelId ? 'active' : ''}`}
              onClick={() => setTourSelId(t.id)}
            >
              Tour {t.numero} {statutTourLabel(t.statut)}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-muted">Chargement…</p>}

      {!loading && tourCourant && (
        <>
          {/* Progression */}
          {tourCourant.statut === 'ouvert' && (
            <div className="flex-between mb-8" style={{ fontSize: 12, color: 'var(--c-muted)' }}>
              <span>{jouees} / {normales.length} scores saisis</span>
              <div className="progress-bar" style={{ width: 160 }}>
                <div className="progress-fill" style={{ width: `${normales.length ? jouees / normales.length * 100 : 0}%` }} />
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Terrain</th>
                    <th>Équipe A</th>
                    <th style={{ width: 28 }} />
                    <th>Équipe B</th>
                    <th style={{ width: 90 }} className="td-center">Score</th>
                    <th style={{ width: 80 }} className="td-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {normales.map(r => {
                    const aGagne = r.score_a != null && r.score_b != null && r.score_a > r.score_b;
                    const bGagne = r.score_a != null && r.score_b != null && r.score_b > r.score_a;
                    return (
                      <tr key={r.id} className={r.statut === 'jouee' ? 'tr-jouee' : ''}>
                        <td className="td-center">
                          <span className="terrain-badge">T{r.terrain ?? '?'}</span>
                        </td>
                        <td>
                          <span className={`td-team ${aGagne ? 'text-ok' : ''}`}>{r.equipe_a_nom}</span>
                          {r.equipe_a_joueurs.length > 0 && (
                            <span className="td-joueurs"> · {r.equipe_a_joueurs.join(' · ')}</span>
                          )}
                        </td>
                        <td className="td-center text-muted" style={{ fontSize: 11 }}>vs</td>
                        <td>
                          <span className={`td-team ${bGagne ? 'text-ok' : ''}`}>{r.equipe_b_nom}</span>
                          {r.equipe_b_joueurs.length > 0 && (
                            <span className="td-joueurs"> · {r.equipe_b_joueurs.join(' · ')}</span>
                          )}
                        </td>
                        <td className="td-center">
                          {r.statut === 'jouee' && r.score_a != null && r.score_b != null ? (
                            <span className="score-display">
                              <span className={aGagne ? 's-win' : 's-lose'}>{r.score_a}</span>
                              <span className="s-sep">—</span>
                              <span className={bGagne ? 's-win' : 's-lose'}>{r.score_b}</span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="td-center">
                          {r.statut === 'jouee'
                            ? <span className="badge badge-ok">Joué</span>
                            : <span className="badge badge-muted">À jouer</span>}
                        </td>
                      </tr>
                    );
                  })}

                  {exemptees.map(r => (
                    <tr key={r.id} className="tr-exempte">
                      <td className="td-center">
                        <span className="terrain-badge exempte">BYE</span>
                      </td>
                      <td>
                        <span className="td-team">{r.equipe_a_nom}</span>
                        {r.equipe_a_joueurs.length > 0 && (
                          <span className="td-joueurs"> · {r.equipe_a_joueurs.join(' · ')}</span>
                        )}
                      </td>
                      <td />
                      <td className="text-muted" style={{ fontStyle: 'italic' }}>Exempte</td>
                      <td className="td-center">
                        <span className="score-display">
                          <span className="s-win">{r.score_a ?? 13}</span>
                          <span className="s-sep">—</span>
                          <span className="s-lose">{r.score_b ?? 0}</span>
                        </span>
                      </td>
                      <td className="td-center">
                        <span className="badge badge-blue">Bye</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
