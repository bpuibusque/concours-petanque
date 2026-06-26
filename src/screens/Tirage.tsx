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
      // Sélectionne le dernier tour par défaut
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
      const r = await api.listRencontresTour(tourId);
      setRencontres(r);
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
      if (ti.exempt_equipe_id.length > 0) msgs.push(`${ti.exempt_equipe_id.length} équipe(s) exemptée(s) (victoire actée).`);
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

  const exemptees = rencontres.filter(r => r.exempte);
  const normales = rencontres.filter(r => !r.exempte);
  const jouees = normales.filter(r => r.statut === 'jouee').length;

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Rencontres</h1>
          <p>{tours.length} tour{tours.length > 1 ? 's' : ''} sur {concours.nb_tours}</p>
        </div>
        <div className="flex-row">
          {peutTirer && (
            <button className="btn btn-primary" disabled={tirageLoading} onClick={lancerTirage}>
              {tirageLoading ? 'Tirage…' : `Tirer le tour ${(dernierTour?.numero ?? 0) + 1}`}
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
      {tours.length === 0 && <div className="alert alert-warn">Aucun tour tiré. Rendez-vous dans l'onglet Équipes pour lancer le tour 1.</div>}

      {/* Onglets tours */}
      {tours.length > 0 && (
        <div className="flex-row mb-8" style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 0 }}>
          {tours.map(t => (
            <button
              key={t.id}
              onClick={() => setTourSelId(t.id)}
              style={{
                background: 'none', border: 'none', padding: '8px 16px',
                borderBottom: t.id === tourSelId ? '2px solid var(--c-primary)' : '2px solid transparent',
                fontWeight: t.id === tourSelId ? 700 : 400,
                color: t.id === tourSelId ? 'var(--c-primary)' : 'var(--c-muted)',
                cursor: 'pointer', fontSize: 14,
              }}
            >
              Tour {t.numero}
              {' '}
              <span className={`badge ${t.statut === 'clos' ? 'badge-ok' : t.statut === 'ouvert' ? 'badge-warn' : 'badge-muted'}`}>
                {t.statut === 'clos' ? 'Clos' : t.statut === 'ouvert' ? 'En cours' : 'À tirer'}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-muted">Chargement…</p>}

      {!loading && tourCourant && (
        <>
          <div className="flex-between mb-8">
            <div className="section-title">Tour {tourCourant.numero} — {normales.length} rencontre{normales.length > 1 ? 's' : ''}</div>
            {tourCourant.statut === 'ouvert' && (
              <div className="text-sm text-muted">
                {jouees}/{normales.length} scores saisis
                <div className="progress-bar" style={{ width: 120, display: 'inline-block', marginLeft: 8, verticalAlign: 'middle' }}>
                  <div className="progress-fill" style={{ width: `${normales.length ? jouees / normales.length * 100 : 0}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="match-list">
            {normales.map(r => {
              const aGagne = r.score_a != null && r.score_b != null && r.score_a > r.score_b;
              const bGagne = r.score_a != null && r.score_b != null && r.score_b > r.score_a;
              return (
                <div key={r.id} className="match-card">
                  <div className="match-terrain">T{r.terrain ?? '?'}</div>
                  <div className="match-teams">
                    <div className={`match-team ${aGagne ? 'winner' : ''}`}>
                      {r.equipe_a_nom}
                      {r.equipe_a_joueurs.length > 0 && (
                        <span className="text-muted" style={{ fontWeight: 400 }}> · {r.equipe_a_joueurs.join(' · ')}</span>
                      )}
                    </div>
                    <div className="match-vs">vs</div>
                    <div className={`match-team team-b ${bGagne ? 'winner' : ''}`}>
                      {r.equipe_b_nom}
                      {r.equipe_b_joueurs.length > 0 && (
                        <span className="text-muted" style={{ fontWeight: 400 }}> · {r.equipe_b_joueurs.join(' · ')}</span>
                      )}
                    </div>
                  </div>
                  {r.statut === 'jouee' ? (
                    <div className="match-score">
                      <span className={`score-val ${aGagne ? 'winner' : ''}`}>{r.score_a}</span>
                      <span className="score-sep">—</span>
                      <span className={`score-val ${bGagne ? 'winner' : ''}`}>{r.score_b}</span>
                    </div>
                  ) : (
                    <span className="badge badge-muted">À jouer</span>
                  )}
                </div>
              );
            })}

            {exemptees.map(r => (
              <div key={r.id} className="match-card match-exempte">
                <div className="match-terrain" style={{ background: 'var(--c-muted)' }}>EXEMPTE</div>
                <div className="match-teams">
                  <div className="match-team">
                    {r.equipe_a_nom}
                    {r.equipe_a_joueurs.length > 0 && (
                      <span className="text-muted" style={{ fontWeight: 400 }}> · {r.equipe_a_joueurs.join(' · ')}</span>
                    )}
                  </div>
                  <div className="match-vs">—</div>
                  <div className="match-team team-b text-muted">Bye</div>
                </div>
                <div className="match-score">
                  <span className="score-val winner">13</span>
                  <span className="score-sep">—</span>
                  <span className="score-val">0</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
