import { getMuscle, type MuscleId } from './muscles';
import { getEquipmentGuide } from './equipment';

export type AppView = 'muscles' | 'equipment' | 'favorites' | 'training' | 'new' | 'history' | 'job';
export function readAppRoute(search: string): { view: AppView; jobId: string | null; muscle: MuscleId | null; equipment?: string | null } {
  const params = new URLSearchParams(search);
  const jobId = params.get('job')?.trim();
  if (jobId) return { view: 'job', jobId, muscle: null };
  if (params.get('view') === 'training') return {view:'training',jobId:null,muscle:null};
  if (params.get('view') === 'equipment') return { view: 'equipment', jobId: null, muscle: null, equipment: getEquipmentGuide(params.get('equipment'))?.id || null };
  const view = params.get('view') === 'compare' ? 'new' : params.get('view') === 'history' ? 'history' : params.get('view') === 'favorites' ? 'favorites' : 'muscles';
  return { view, jobId: null, muscle: view === 'muscles' ? getMuscle(params.get('muscle'))?.id || null : null };
}

export function writeAppUrl(view: AppView, muscle: MuscleId | null = null, jobId: string | null = null, equipment: string | null = null) {
  const url = new URL(location.href);
  for (const key of ['view', 'job', 'muscle', 'equipment']) url.searchParams.delete(key);
  if (view === 'job' && jobId) url.searchParams.set('job', jobId);
  else { url.searchParams.set('view', view === 'new' ? 'compare' : view); if (view === 'muscles' && muscle) url.searchParams.set('muscle', muscle); if (view === 'equipment' && getEquipmentGuide(equipment)) url.searchParams.set('equipment', equipment!); }
  history.pushState({}, '', url);
}
