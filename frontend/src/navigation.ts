import { getMuscle, type MuscleId } from './muscles';

export type AppView = 'muscles' | 'favorites' | 'new' | 'history' | 'job';
export function readAppRoute(search: string): { view: AppView; jobId: string | null; muscle: MuscleId | null } {
  const params = new URLSearchParams(search);
  const jobId = params.get('job')?.trim();
  if (jobId) return { view: 'job', jobId, muscle: null };
  const view = params.get('view') === 'compare' ? 'new' : params.get('view') === 'history' ? 'history' : params.get('view') === 'favorites' ? 'favorites' : 'muscles';
  return { view, jobId: null, muscle: view === 'muscles' ? getMuscle(params.get('muscle'))?.id || null : null };
}

export function writeAppUrl(view: AppView, muscle: MuscleId | null = null, jobId: string | null = null) {
  const url = new URL(location.href);
  for (const key of ['view', 'job', 'muscle']) url.searchParams.delete(key);
  if (view === 'job' && jobId) url.searchParams.set('job', jobId);
  else { url.searchParams.set('view', view === 'new' ? 'compare' : view); if (view === 'muscles' && muscle) url.searchParams.set('muscle', muscle); }
  history.pushState({}, '', url);
}
