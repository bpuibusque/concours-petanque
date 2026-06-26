import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours, RencontreDetail, TirageInfo, Tour } from '../lib/types';

interface Props {
  tourId: number | null;
  concours: Concours;
  onTourSuivantTire: () => void;
}

interface ScoreLocal {
  a: string;
  b: string;
}

export default function Saisie({ tourId: initTourId, concours, onTourSuivantTire }: Props) {
  const [tours, setTours] = useState<Tour[]>([]);
  const [tourSelId, setTourSelId] = useState<number | null>(initTourId);
  const [rencontres, setRencontres] = useState<RencontreDetail[]>([]);
  const [scores, setScores] = useState<Record<number, ScoreLocal>>({});
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [tirageSuivant, setTirageSuivant] = useState(false);

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

  // Score auto-fill : si on tape X ≠ 13 pour un côté, l'autre prend 13
  function setScore(id: number, side: 'a' | 'b', val: string) {
    if (val !== '' && !/^\d{0,2}$/.test(val)) return; // max 2 chiffres
    setScores(prev => {
      const current = prev[id] ?? { a: '', b: '' };
      const n = parseInt(val, 10);
      const autre: 'a' | 'b' = side === 'a' ? 'b' : 'a';
      // Auto-fill 13 côté adverse si score saisi < 13
      const newScore: ScoreLocal = { ...current, [side]: val };
      if (!isNaN(n) && n < 13 && val !== '') {
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
    if (sa === sb) { setErreur('Match nul impossible en pétanque.'); return; }
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
  const dernierTour = tours.length > 0 && tours[tours.length - 1].numero === concours.nb_tours;
  const peutPasserSuivant = tousJoues && !dernierTour;

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Saisie des scores</h1>
          <p>
            Tour {tourNumero} · {jouees}/{total} validé{jouees > 1 ? 's' : ''}
          </p>
          <div className="progress-bar" style={{ width: 200, marginTop: 6 }}>
            <div className="progress-fill" style={{ width: `${total ? jouees / total * 100 : 0}%` }} />
          </div>
        </div>
        {peutPasserSuivant && (
          <button
            className="btn btn-primary btn-lg"
            disabled={tirageSuivant}
            onClick={passerTourSuivant}
          >
            {tirageSuivant ? 'Tirage…' : `Passer au tour ${tourNumero + 1} →`}
          </button>
        )}
        {tousJoues && dernierTour && (
          <span className="badge badge-ok" style={{ fontSize: 13, padding: '8px 14px' }}>
            Concours terminé — voir le classement
          </span>
        )}
      </div>

      {/* Onglets tours */}
      {tours.length > 1 && (
        <div className="flex-row mb-8">
          {tours.map(t => (
            <button
              key={t.id}
              className={`btn btn-sm ${t.id === tourSelId ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTourSelId(t.id)}
            >
              Tour {t.numero}
            </button>
          ))}
        </div>
      )}

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {tousJoues && !dernierTour && (
        <div className="alert alert-ok">
          Tous les scores du tour {tourNumero} sont saisis. Vous pouvez passer au tour suivant.
        </div>
      )}

      <div className="match-list">
        {rencontres.map(r => {
          const s = scores[r.id] ?? { a: '', b: '' };
          const estJouee = r.statut === 'jouee';
          const isSaving = saving === r.id;
          const aGagne = estJouee && r.score_a != null && r.score_b != null && r.score_a > r.score_b;
          const bGagne = estJouee && r.score_a != null && r.score_b != null && r.score_b > r.score_a;

          return (
            <div key={r.id} className="match-card" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="match-terrain">T{r.terrain ?? '?'}</div>

              <div className="match-teams" style={{ minWidth: 220 }}>
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                {estJouee ? (
                  <>
                    <div className="match-score">
                      <span className={`score-val ${aGagne ? 'winner' : ''}`}>{r.score_a}</span>
                      <span className="score-sep">—</span>
                      <span className={`score-val ${bGagne ? 'winner' : ''}`}>{r.score_b}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" disabled={isSaving} onClick={() => annuler(r)}>
                      Modifier
                    </button>
                  </>
                ) : (
                  <>
                    <div className="score-input">
                      <input
                        value={s.a}
                        onChange={e => setScore(r.id, 'a', e.target.value)}
                        placeholder="—"
                        disabled={isSaving}
                        onKeyDown={e => e.key === 'Enter' && valider(r)}
                      />
                      <span className="score-sep">—</span>
                      <input
                        value={s.b}
                        onChange={e => setScore(r.id, 'b', e.target.value)}
                        placeholder="—"
                        disabled={isSaving}
                        onKeyDown={e => e.key === 'Enter' && valider(r)}
                      />
                    </div>
                    <button
                      className="btn btn-ok btn-sm"
                      disabled={isSaving || s.a === '' || s.b === ''}
                      onClick={() => valider(r)}
                    >
                      {isSaving ? '…' : 'Valider'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
