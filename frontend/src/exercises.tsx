import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText } from './api';
import type { MuscleId } from './muscles';

export type Equipment = 'bodyweight' | 'dumbbell' | 'machine';
export const EQUIPMENT: Record<Equipment, string> = { bodyweight: '徒手', dumbbell: '哑铃', machine: '固定器械' };
export type Exercise = { id: string; name: string; english: string; category: string; equipment: Equipment; requires: string; primary: MuscleId[]; secondary: MuscleId[]; focus: string; summary: string; setup: string; steps: string[]; mistakes: string[]; source: { publisher: string; title: string; url: string; language: string }; teaching: { author: string; title: string; part_title: string; page: number; duration: number; url: string; scope: string } };
type Catalog = { version: string; reviewed_at: string; note: string; items: Exercise[] };
type Favorites = { items: { exercise_id: string; created_at: string }[] };
type Library = { catalog: Catalog | null; loading: boolean; error: string; reload: () => void; saved: Set<string>; favoritesReady: boolean; favoritesError: string; refreshFavorites: () => Promise<void>; pending: Set<string>; toggle: (item: Exercise) => Promise<void>; notice: string };
const Context = createContext<Library | null>(null);
export function ExerciseProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesError, setFavoritesError] = useState('');
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const reads = useRef(0);
  const inFlight = useRef(new Set<string>());
  const savedRef = useRef(saved); savedRef.current = saved;
  const loadCatalog = useCallback(async () => {
    setLoading(true); setError('');
    try { setCatalog(await api<Catalog>('/exercises')); } catch (err) { setError(errorText(err)); } finally { setLoading(false); }
  }, []);
  const refreshFavorites = useCallback(async () => {
    const current = ++reads.current; const version = revision.current;
    try {
      const data = await api<Favorites>('/exercise-favorites');
      if (current !== reads.current || version !== revision.current || inFlight.current.size) return;
      setSaved(new Set(data.items.map(item => item.exercise_id))); setFavoritesReady(true); setFavoritesError('');
    } catch (err) { if (current === reads.current) setFavoritesError(errorText(err)); }
  }, []);
  useEffect(() => { void loadCatalog(); void refreshFavorites(); const focus = () => { if (document.visibilityState === 'visible') void refreshFavorites(); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }; }, [loadCatalog, refreshFavorites]);
  async function toggle(item: Exercise) {
    if (!favoritesReady || inFlight.current.has(item.id)) return;
    const removing = savedRef.current.has(item.id);
    inFlight.current.add(item.id); revision.current++; setPending(new Set(inFlight.current)); setNotice(''); setFavoritesError('');
    try {
      await api(`/exercise-favorites/${encodeURIComponent(item.id)}`, { method: removing ? 'DELETE' : 'PUT' });
      setSaved(current => { const next = new Set(current); removing ? next.delete(item.id) : next.add(item.id); return next; });
      setNotice(removing ? `已取消收藏「${item.name}」` : `已收藏「${item.name}」，可在动作收藏中查看`);
    } catch (err) { setFavoritesError(`收藏变更未确认：${errorText(err)}。刷新收藏后可确认是否已保存。`); }
    finally { revision.current++; inFlight.current.delete(item.id); setPending(new Set(inFlight.current)); }
  }
  return <Context.Provider value={{ catalog, loading, error, reload: () => void loadCatalog(), saved, favoritesReady, favoritesError, refreshFavorites, pending, toggle, notice }}>{children}</Context.Provider>;
}
export function useExercises() { const value = useContext(Context); if (!value) throw new Error('ExerciseProvider is required'); return value; }
