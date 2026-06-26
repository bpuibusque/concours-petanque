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

  // Formulaire création équipe (prénoms inline)
  const [showCreation, setShowCreation] = useState(false);
  const [prenoms, setPrenoms] = useState<string[]>(() => Array(nbJ).fill(''));
  const [loadingCreation, setLoadingCreation] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  // Formulaire édition joueur inline
  const [editJoueur, setEditJoueur] = useState<{ id: number; prenom: string } | null>(null);

  // Confirmations suppression
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

  // Ouvre le formulaire de création et focus le 1er champ
  function ouvrirCreation() {
    setPrenoms(Array(nbJ).fill(''));
    setShowCreation(true);
    setTimeout(() => firstInput.current?.focus(), 50);
  }

  async function creerEquipe(ev: React.FormEvent) {
    ev.preventDefault();
    if (prenoms.some(p => !p.trim())) {
      setErreur('Renseignez tous les prénoms.');
      return;
    }
    setLoadingCreation(true);
    setErreur('');
    try {
      const equipe = await api.inscrireEquipe();
      // Créer les joueurs en séquence (prénom uniquement, nom vide)
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

  function annulerCreation() {
    setShowCreation(false);
    setPrenoms(Array(nbJ).fill(''));
    setErreur('');
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

  const labelJoueur = (i: number) => {
    if (nbJ === 1) return 'Joueur';
    return `Joueur ${i + 1}`;
  };

  return (
    <div className="page">
      {/* En-tête */}
      <div className="flex-between page-header">
        <div>
          <h1>Équipes inscrites</h1>
          <p>{equipes.length} équipe{equipes.length > 1 ? 's' : ''} · {nbJ} joueur{nbJ > 1 ? 's' : ''} par équipe</p>
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
              title={equipes.length < 9 ? `Encore ${9 - equipes.length} équipe(s) manquante(s)` : ''}
            >
              {tirage ? 'Tirage…' : `Tirer le tour 1 →`}
            </button>
          )}
        </div>
      </div>

      {erreur && <div className="alert alert-err">{erreur}</div>}
      {inscriptionsClos && <div className="alert alert-warn">Inscriptions closes — tour 1 tiré.</div>}
      {!inscriptionsClos && equipes.length < 9 && (
        <div className="alert alert-warn">
          Encore {9 - equipes.length} équipe{9 - equipes.length > 1 ? 's' : ''} à inscrire.
        </div>
      )}

      {/* Formulaire création équipe */}
      {showCreation && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Équipe {equipes.length + 1}</div>
          <form onSubmit={creerEquipe}>
            <div className="form-row" style={{ flexWrap: 'wrap' }}>
              {Array.from({ length: nbJ }).map((_, i) => (
                <div key={i} className="form-group" style={{ minWidth: 140 }}>
                  <label>{labelJoueur(i)}</label>
                  <input
                    ref={i === 0 ? firstInput : undefined}
                    value={prenoms[i]}
                    onChange={e => setPrenoms(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                    placeholder="Prénom"
                    onKeyDown={ev => ev.key === 'Escape' && annulerCreation()}
                  />
                </div>
              ))}
            </div>
            <div className="flex-row">
              <button type="submit" className="btn btn-ok" disabled={loadingCreation}>
                {loadingCreation ? 'Création…' : 'Créer l\'équipe'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={annulerCreation}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste des équipes */}
      <div className="equipe-list">
        {equipes.map((eq, i) => (
          <div key={eq.id} className="equipe-card">
            {/* En-tête carte équipe */}
            <div className="equipe-card-header" onClick={() => toggle(eq.id)}>
              <div className="equipe-num">{i + 1}</div>
              <div className="equipe-info">
                <div className="equipe-nom">
                  {eq.joueurs.map(j => j.prenom).join(' · ') || 'Aucun joueur'}
                </div>
              </div>
              <span className="badge badge-muted">{eq.joueurs.length}/{nbJ}</span>

              {!inscriptionsClos && (
                confirmSupprEq === eq.id ? (
                  <div className="flex-row gap-8" onClick={e => e.stopPropagation()}>
                    <span className="text-sm text-muted">Supprimer ?</span>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimerEquipe(eq.id)}>Oui</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmSupprEq(null)}>Non</button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--c-err)', borderColor: 'var(--c-err)' }}
                    onClick={e => { e.stopPropagation(); setConfirmSupprEq(eq.id); }}
                  >
                    🗑
                  </button>
                )
              )}

              <span className="text-muted text-sm">{eq.expanded ? '▲' : '▼'}</span>
            </div>

            {/* Corps carte équipe — édition joueurs */}
            {eq.expanded && (
              <div className="equipe-body">
                {eq.joueurs.map(j => (
                  <div key={j.id} className="joueur-row">
                    {editJoueur?.id === j.id ? (
                      <form onSubmit={sauvegarderJoueur} className="flex-row" style={{ flex: 1 }}>
                        <input
                          style={{ flex: 1, padding: '3px 8px', border: '1px solid var(--c-border)', borderRadius: 4, fontSize: 13 }}
                          value={editJoueur.prenom}
                          onChange={e => setEditJoueur(prev => prev && { ...prev, prenom: e.target.value })}
                          placeholder="Prénom"
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
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditJoueur({ id: j.id, prenom: j.prenom })}
                            >✏</button>
                            {confirmSupprJ === j.id ? (
                              <div className="flex-row gap-8">
                                <button className="btn btn-danger btn-sm" onClick={() => supprimerJoueur(j.id)}>Oui</button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmSupprJ(null)}>Non</button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ color: 'var(--c-err)' }}
                                onClick={() => setConfirmSupprJ(j.id)}
                              >🗑</button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
