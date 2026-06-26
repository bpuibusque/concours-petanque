import { useEffect, useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours } from '../lib/types';

interface Props {
  onConcours: (c: Concours) => void;
  onCreer: () => void;
}

export default function Accueil({ onConcours, onCreer }: Props) {
  const [fichiers, setFichiers] = useState<string[]>([]);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState<string | null>(null);
  const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);

  async function charger() {
    api.listerFichiersConcours().then(setFichiers).catch(() => {});
  }

  useEffect(() => { charger(); }, []);

  async function ouvrir(path: string) {
    setChargement(path);
    setErreur('');
    try {
      const c = await api.ouvrirConcours(path);
      onConcours(c);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setChargement(null);
    }
  }

  async function supprimer(path: string) {
    try {
      await api.supprimerFichierConcours(path);
      setConfirmSuppr(null);
      await charger();
    } catch (e) {
      setErreur(String(e));
    }
  }

  function nomFichier(path: string) {
    return path.split(/[\\/]/).pop()?.replace('.sqlite', '') ?? path;
  }

  return (
    <div className="page">
      <div className="accueil-hero">
        <h1>Concours de Pétanque</h1>
        <p>Système Gagnants / Perdants — 4 parties</p>
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 24 }}
          onClick={onCreer}
        >
          + Nouveau concours
        </button>

        {erreur && <div className="alert alert-err">{erreur}</div>}

        {fichiers.length > 0 && (
          <>
            <div className="section-title">Concours existants</div>
            <div className="file-list">
              {fichiers.map(f => (
                <div key={f} className="file-item">
                  <div onClick={() => ouvrir(f)} style={{ flex: 1, cursor: 'pointer' }}>
                    <div className="file-name">{nomFichier(f)}</div>
                    <div className="file-path">{f}</div>
                  </div>

                  {confirmSuppr === f ? (
                    <div className="flex-row gap-8">
                      <span className="text-sm text-muted">Supprimer ?</span>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimer(f)}>Oui</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmSuppr(null)}>Non</button>
                    </div>
                  ) : (
                    <div className="flex-row gap-8">
                      {chargement === f
                        ? <span className="text-muted text-sm">Ouverture…</span>
                        : <span className="text-muted text-sm" onClick={() => ouvrir(f)} style={{ cursor: 'pointer' }}>Ouvrir →</span>}
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--c-err)', borderColor: 'var(--c-err)' }}
                        onClick={e => { e.stopPropagation(); setConfirmSuppr(f); }}
                        title="Supprimer ce concours"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {fichiers.length === 0 && (
          <p className="text-muted text-sm" style={{ textAlign: 'center' }}>
            Aucun concours enregistré. Créez-en un nouveau.
          </p>
        )}
      </div>
    </div>
  );
}
