import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours, RencontreDetail, TirageInfo, Tour } from '../lib/types';

interface Props {
  tourId: number | null;
  concours: Concours;
  onTourSuivantTire: () => void;
}

interface ScoreLocal { a: string; b: string; }

export default function Saisie({ tourId: initTourId, concours, onTourSuivantTire }: Props) {
  const [tours, setTours] = useState<Tour[]>([]);
  const [tourSelId, setTourSelId] = useState<number | null>(initTourId);
  const [rencontres, setRencontres] = useState<RencontreDetail[]>([]);
  const [scores, setScores] = useState<Record<number, ScoreLocal>>({});
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [tirageSuivant, setTirageSuivant] = useState(false);

  // Ref map pour le focus automatique entre inputs
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const chargerTours = useCallback(async () => {
    const ts = await api.listTours();
    const visibles = ts.filter(t => t.statut !== 'en_attente');
    setTours(visibles);
    if (!tourSelId && visibles.length) {
      const ouvert = visibles.find(t => t.statut === 'ouvert') ?? visibles[visibles.length - 1];
      setTourSelId(ouvert.id);
    }
  }, [tourSelId]);

  const chargerRencontres = useCallback(async (id: number) => {
    try {
      const rs = await api.listRencontresTour(id);
      const normales = rs.filter(r => !r.exempte);
      setRencontres(normales);
      const init: Record<number, ScoreLocal> = {};
      normales.forEach(r => {
        init[r.id] = {
          a: r.score_a != null ? String(r.score_a) : '',
          b: r.score_b != null ? String(r.score_b) : '',
        };
      });
      setScores(init);
    } catch (e) {
      setErreur(String(e));
    }
  }, []);

  useEffect(() => { chargerTours(); }, [chargerTours]);
  useEffect(() => { if (tourSelId) chargerRencontres(tourSelId); }, [tourSelId, chargerRencontres]);

  function setScore(id: number, side: 'a' | 'b', val: string) {
    if (val !== '' && !/^\d{0,2}$/.test(val)) return;
    setScores(prev => {
      const current = prev[id] ?? { a: '', b: '' };
      const n = parseInt(val, 10);
      const autre: 'a' | 'b' = side === 'a' ? 'b' : 'a';
      const newScore: ScoreLocal = { ...current, [side]: val };
      // Auto-fill côté adverse à 13 si score saisi < 13
      if (!isNaN(n) && n < 13 && val !== '' && current[autre] === '') {
        newScore[autre] = '13';
      }
      return { ...prev, [id]: newScore };
    });
  }

  async function valider(r: RencontreDetail) {
    const s = scores[r.id];
    if (!s || s.a === '' || s.b === '') { setErreur('Saisissez les deux scores.'); return; }
    const sa = parseInt(s.a, 10);
    const sb = parseInt(s.b, 10);
    if (sa === sb) { setErreur('Égalité impossible en pétanque.'); return; }
    setSaving(r.id);
    setErreur('');
    try {
      await api.saisirScore(r.id, sa, sb);
      await chargerRencontres(tourSelId!);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function annuler(r: RencontreDetail) {
    setSaving(r.id);
    try {
      await api.annulerScore(r.id);
      await chargerRencontres(tourSelId!);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function passerTourSuivant() {
    setTirageSuivant(true);
    setErreur('');
    try {
      const info: TirageInfo = await api.tirerProchainTour();
      setTourSelId(info.tour_id);
      await chargerTours();
      onTourSuivantTire();
    } catch (e) {
      setErreur(String(e));
    } finally {
      setTirageSuivant(false);
    }
  }

  const jouees = rencontres.filter(r => r.statut === 'jouee').length;
  const total = rencontres.length;
  const tousJoues = total > 0 && jouees === total;
  const tourCourant = tours.find(t => t.id === tourSelId);
  const tourNumero = tourCourant?.numero ?? 0;
  const estDernierTour = tours.length > 0 && tours[tours.length - 1].numero === concours.nb_tours;
  const peutPasserSuivant = tousJoues && !estDernierTour && tourCourant?.statut === 'ouvert';
  const concoursFini = tousJoues && estDernierTour;

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Saisie des scores</h1>
          <p>
            Tour {tourNumero} · {jouees}/{total} rencontre{jouees !== 1 ? 's' : ''} validée{jouees !== 1 ? 's' : ''}
          </p>
          <div className="progress-bar" style={{ width: 200, marginTop: 5 }}>
            <div className="progress-fill" style={{ width: `${total ? jouees / total * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex-row">
          {peutPasserSuivant && (
            <button className="btn btn-primary btn-lg" disabled={tirageSuivant} onClick={passerTourSuivant}>
              {tirageSuivant ? 'Tirage…' : `Passer au tour ${tourNumero + 1} →`}
            </button>
          )}
          {concoursFini && (
            <span className="badge badge-ok" style={{ fontSize: 12, padding: '8px 14px' }}>
              Concours terminé — consultez le classement
            </span>
          )}
        </div>
      </div>

      {/* Onglets tours */}
      {tours.length > 1 && (
        <div className="tour-tabs">
          {tours.map(t => (
            <button
              key={t.id}
              className={`tour-tab ${t.id === tourSelId ? 'active' : ''}`}
              onClick={() => setTourSelId(t.id)}
            >
              Tour {t.numero}
            </button>
          ))}
        </div>
      )}

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {tousJoues && !estDernierTour && tourCourant?.statut === 'ouvert' && (
        <div className="alert alert-ok">
          Tous les scores du tour {tourNumero} sont saisis. Vous pouvez passer au tour suivant.
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Terrain</th>
                <th>Équipe A</th>
                <th style={{ width: 110 }} className="td-center">Score</th>
                <th>Équipe B</th>
                <th style={{ width: 90 }} className="td-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rencontres.map((r, idx) => {
                const s = scores[r.id] ?? { a: '', b: '' };
                const estJouee = r.statut === 'jouee';
                const isSaving = saving === r.id;
                const aGagne = estJouee && r.score_a != null && r.score_b != null && r.score_a > r.score_b;
                const bGagne = estJouee && r.score_a != null && r.score_b != null && r.score_b > r.score_a;
                const keyA = `${r.id}-a`;
                const keyB = `${r.id}-b`;

                return (
                  <tr key={r.id} className={estJouee ? 'tr-jouee' : ''}>
                    <td className="td-center">
                      <span className="terrain-badge">T{r.terrain ?? '?'}</span>
                    </td>

                    <td>
                      <span className={`td-team ${aGagne ? 'text-ok' : ''}`}>{r.equipe_a_nom}</span>
                      {r.equipe_a_joueurs.length > 0 && (
                        <span className="td-joueurs"> · {r.equipe_a_joueurs.join(' · ')}</span>
                      )}
                    </td>

                    <td className="td-center">
                      {estJouee ? (
                        <span className="score-display">
                          <span className={aGagne ? 's-win' : 's-lose'}>{r.score_a}</span>
                          <span className="s-sep">—</span>
                          <span className={bGagne ? 's-win' : 's-lose'}>{r.score_b}</span>
                        </span>
                      ) : (
                        <div className="score-inputs" style={{ justifyContent: 'center' }}>
                          <input
                            ref={el => { inputRefs.current[keyA] = el; }}
                            className="input-score"
                            value={s.a}
                            onChange={e => setScore(r.id, 'a', e.target.value)}
                            placeholder="—"
                            disabled={isSaving}
                            onKeyDown={e => {
                              if (e.key === 'Enter') valider(r);
                              if (e.key === 'Tab' && !e.shiftKey) {
                                // focus B de la même ligne
                                e.preventDefault();
                                inputRefs.current[keyB]?.focus();
                              }
                            }}
                          />
                          <span className="score-dash">—</span>
                          <input
                            ref={el => { inputRefs.current[keyB] = el; }}
                            className="input-score"
                            value={s.b}
                            onChange={e => setScore(r.id, 'b', e.target.value)}
                            placeholder="—"
                            disabled={isSaving}
                            onKeyDown={e => {
                              if (e.key === 'Enter') valider(r);
                              if (e.key === 'Tab' && !e.shiftKey) {
                                // focus A de la ligne suivante
                                const nextR = rencontres.find((rr, i) => i === idx + 1 && rr.statut !== 'jouee');
                                if (nextR) {
                                  e.preventDefault();
                                  inputRefs.current[`${nextR.id}-a`]?.focus();
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </td>

                    <td>
                      <span className={`td-team ${bGagne ? 'text-ok' : ''}`}>{r.equipe_b_nom}</span>
                      {r.equipe_b_joueurs.length > 0 && (
                        <span className="td-joueurs"> · {r.equipe_b_joueurs.join(' · ')}</span>
                      )}
                    </td>

                    <td className="td-center">
                      {estJouee ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={isSaving || tourCourant?.statut === 'clos'}
                          onClick={() => annuler(r)}
                        >
                          Corriger
                        </button>
                      ) : (
                        <button
                          className="btn btn-ok btn-sm"
                          disabled={isSaving || s.a === '' || s.b === ''}
                          onClick={() => valider(r)}
                        >
                          {isSaving ? '…' : 'Valider'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {rencontres.length === 0 && (
                <tr>
                  <td colSpan={5} className="td-center text-muted" style={{ padding: '28px 0' }}>
                    Aucune rencontre pour ce tour.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
