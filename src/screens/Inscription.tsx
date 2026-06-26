import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours, Equipe, Joueur, Tour } from '../lib/types';

interface Props {
  concours: Concours;
  onTourTire: () => void;
}

interface EquipeEtendue extends Equipe {
  joueurs: Joueur[];
  expanded: boolean;
}

function nbJoueursParFormat(format: Concours['format_equipe']) {
  if (format === 'tete_a_tete') return 1;
  if (format === 'doublette') return 2;
  return 3;
}

export default function Inscription({ concours, onTourTire }: Props) {
  const nbJ = nbJoueursParFormat(concours.format_equipe);

  const [equipes, setEquipes] = useState<EquipeEtendue[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [erreur, setErreur] = useState('');
  const [tirage, setTirage] = useState(false);

  const [showCreation, setShowCreation] = useState(false);
  const [prenoms, setPrenoms] = useState<string[]>(() => Array(nbJ).fill(''));
  const [loadingCreation, setLoadingCreation] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  const [editJoueur, setEditJoueur] = useState<{ id: number; prenom: string } | null>(null);
  const [confirmSupprEq, setConfirmSupprEq] = useState<number | null>(null);
  const [confirmSupprJ, setConfirmSupprJ] = useState<number | null>(null);

  const tour1 = tours.find(t => t.numero === 1);
  const inscriptionsClos = tour1 != null && tour1.statut !== 'en_attente';

  const charger = useCallback(async () => {
    try {
      const [eqs, ts] = await Promise.all([api.listEquipes(), api.listTours()]);
      const eqsEtendues = await Promise.all(
        eqs.map(async e => ({
          ...e,
          joueurs: await api.listJoueurs(e.id),
          expanded: false,
        }))
      );
      setEquipes(eqsEtendues);
      setTours(ts);
    } catch (e) {
      setErreur(String(e));
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  function ouvrirCreation() {
    setPrenoms(Array(nbJ).fill(''));
    setShowCreation(true);
    setTimeout(() => firstInput.current?.focus(), 50);
  }

  async function creerEquipe(ev: React.FormEvent) {
    ev.preventDefault();
    if (prenoms.some(p => !p.trim())) { setErreur('Renseignez tous les prénoms.'); return; }
    setLoadingCreation(true);
    setErreur('');
    try {
      const equipe = await api.inscrireEquipe();
      for (const p of prenoms) {
        await api.inscrireJoueur(equipe.id, '', p.trim(), null);
      }
      setPrenoms(Array(nbJ).fill(''));
      setShowCreation(false);
      await charger();
    } catch (e) {
      setErreur(String(e));
    } finally {
      setLoadingCreation(false);
    }
  }

  async function supprimerEquipe(id: number) {
    setErreur('');
    try {
      await api.supprimerEquipe(id);
      setConfirmSupprEq(null);
      await charger();
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function sauvegarderJoueur(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editJoueur) return;
    try {
      await api.modifierJoueur(editJoueur.id, '', editJoueur.prenom.trim(), null);
      setEditJoueur(null);
      await charger();
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function supprimerJoueur(id: number) {
    try {
      await api.supprimerJoueur(id);
      setConfirmSupprJ(null);
      await charger();
    } catch (e) {
      setErreur(String(e));
    }
  }

  function toggle(id: number) {
    setEquipes(prev => prev.map(e => e.id === id ? { ...e, expanded: !e.expanded } : e));
  }

  async function lancerTirage() {
    if (equipes.length < 9) { setErreur('Il faut au moins 9 équipes.'); return; }
    setTirage(true);
    setErreur('');
    try {
      await api.tirerProchainTour();
      onTourTire();
    } catch (e) {
      setErreur(String(e));
    } finally {
      setTirage(false);
    }
  }

  const manquantes = Math.max(0, 9 - equipes.length);

  return (
    <div className="page">
      <div className="flex-between page-header">
        <div>
          <h1>Équipes inscrites</h1>
          <p>{equipes.length} équipe{equipes.length !== 1 ? 's' : ''} · {nbJ} joueur{nbJ > 1 ? 's' : ''} par équipe</p>
        </div>
        <div className="flex-row">
          {!inscriptionsClos && !showCreation && (
            <button className="btn btn-secondary" onClick={ouvrirCreation}>
              + Nouvelle équipe
            </button>
          )}
          {!inscriptionsClos && (
            <button
              className="btn btn-primary btn-lg"
              disabled={equipes.length < 9 || tirage}
              onClick={lancerTirage}
              title={manquantes > 0 ? `Encore ${manquantes} équipe(s) manquante(s)` : ''}
            >
              {tirage ? 'Tirage…' : 'Tirer le tour 1 →'}
            </button>
          )}
        </div>
      </div>

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {inscriptionsClos && <div className="alert alert-ok">Inscriptions closes — tour 1 tiré.</div>}
      {!inscriptionsClos && manquantes > 0 && (
        <div className="alert alert-warn">
          Encore {manquantes} équipe{manquantes > 1 ? 's' : ''} à inscrire avant de pouvoir tirer.
        </div>
      )}

      {/* Formulaire création */}
      {showCreation && (
        <div className="card mb-12">
          <div className="card-title">Équipe {equipes.length + 1}</div>
          <form onSubmit={creerEquipe}>
            <div className="form-row" style={{ flexWrap: 'wrap' }}>
              {Array.from({ length: nbJ }).map((_, i) => (
                <div key={i} className="form-group" style={{ minWidth: 130 }}>
                  <label>Joueur {nbJ > 1 ? i + 1 : ''}</label>
                  <input
                    ref={i === 0 ? firstInput : undefined}
                    value={prenoms[i]}
                    onChange={e => setPrenoms(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                    placeholder="Prénom"
                    onKeyDown={ev => ev.key === 'Escape' && (setShowCreation(false), setErreur(''))}
                  />
                </div>
              ))}
            </div>
            <div className="flex-row">
              <button type="submit" className="btn btn-ok" disabled={loadingCreation}>
                {loadingCreation ? 'Création…' : 'Valider'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowCreation(false); setErreur(''); }}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table des équipes */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Joueurs</th>
                <th style={{ width: 60 }} className="td-center">Dossard</th>
                {!inscriptionsClos && <th style={{ width: 70 }} />}
              </tr>
            </thead>
            <tbody>
              {equipes.map((eq, i) => (
                <>
                  <tr
                    key={eq.id}
                    className={`team-row ${eq.expanded ? 'team-row-open' : ''}`}
                    onClick={() => toggle(eq.id)}
                  >
                    <td className="td-num" style={{ fontWeight: 700, color: 'var(--c-primary)' }}>{i + 1}</td>
                    <td className="td-team">
                      {eq.joueurs.length > 0
                        ? eq.joueurs.map(j => j.prenom).join(' · ')
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="td-center">
                      <span className={`badge ${eq.joueurs.length >= nbJ ? 'badge-ok' : 'badge-warn'}`}>
                        {eq.joueurs.length}/{nbJ}
                      </span>
                    </td>
                    {!inscriptionsClos && (
                      <td className="td-actions" onClick={e => e.stopPropagation()}>
                        {confirmSupprEq === eq.id ? (
                          <div className="flex-row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-danger btn-sm" onClick={() => supprimerEquipe(eq.id)}>Oui</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmSupprEq(null)}>Non</button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--c-err)', borderColor: 'transparent' }}
                            onClick={() => setConfirmSupprEq(eq.id)}
                            title="Supprimer l'équipe"
                          >✕</button>
                        )}
                      </td>
                    )}
                  </tr>

                  {eq.expanded && (
                    <tr key={`${eq.id}-detail`} className="team-detail-row">
                      <td />
                      <td colSpan={inscriptionsClos ? 2 : 3} className="team-detail-cell">
                        {eq.joueurs.map(j => (
                          <div key={j.id} className="joueur-inline">
                            {editJoueur?.id === j.id ? (
                              <form onSubmit={sauvegarderJoueur} className="flex-row" style={{ flex: 1 }}>
                                <input
                                  style={{ flex: 1, padding: '3px 8px', border: '1px solid var(--c-border)', borderRadius: 4, fontSize: 12 }}
                                  value={editJoueur.prenom}
                                  onChange={e => setEditJoueur(prev => prev && { ...prev, prenom: e.target.value })}
                                  autoFocus
                                />
                                <button type="submit" className="btn btn-ok btn-sm">✓</button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditJoueur(null)}>✕</button>
                              </form>
                            ) : (
                              <>
                                <span style={{ flex: 1 }}>{j.prenom}</span>
                                {!inscriptionsClos && (
                                  <>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setEditJoueur({ id: j.id, prenom: j.prenom })}>✏</button>
                                    {confirmSupprJ === j.id ? (
                                      <div className="flex-row gap-6">
                                        <button className="btn btn-danger btn-sm" onClick={() => supprimerJoueur(j.id)}>Oui</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmSupprJ(null)}>Non</button>
                                      </div>
                                    ) : (
                                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--c-err)' }} onClick={() => setConfirmSupprJ(j.id)}>✕</button>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                        {eq.joueurs.length === 0 && <span className="text-muted">Aucun joueur.</span>}
                      </td>
                    </tr>
                  )}
                </>
              ))}

              {equipes.length === 0 && (
                <tr>
                  <td colSpan={4} className="td-center text-muted" style={{ padding: '28px 0' }}>
                    Aucune équipe inscrite. Cliquez sur « + Nouvelle équipe » pour commencer.
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
