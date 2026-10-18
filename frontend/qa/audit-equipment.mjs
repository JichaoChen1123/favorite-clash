import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(compile(source)).toString('base64');
const equipmentUrl = moduleUrl(await read('src/equipment.ts'));
const musclesUrl = moduleUrl(await read('src/muscles.ts'));
const { EQUIPMENT_GUIDES, getEquipmentGuide } = await import(equipmentUrl);
const navigation = compile(await read('src/navigation.ts')).replace("'./muscles'", JSON.stringify(musclesUrl)).replace("'./equipment'", JSON.stringify(equipmentUrl));
const { readAppRoute, writeAppUrl } = await import('data:text/javascript;base64,' + Buffer.from(navigation).toString('base64'));
const catalog = JSON.parse(await readFile(new URL('../app/exercises.json', root), 'utf8')).items;
assert.equal(EQUIPMENT_GUIDES.length, 6);
assert.equal(new Set(EQUIPMENT_GUIDES.map(x => x.id)).size, 6);
for (const guide of EQUIPMENT_GUIDES) {
  assert.match(guide.id, /^[a-z-]+$/);
  assert.equal(getEquipmentGuide(guide.id), guide);
  assert.equal(guide.before.length, 3);
  assert.ok(guide.exerciseIds.includes(guide.example));
  assert.equal(new Set(guide.exerciseIds).size, guide.exerciseIds.length);
  for (const id of guide.exerciseIds) {
    const item = catalog.find(x => x.id === id);
    assert.ok(item, `Broken related exercise: ${guide.id}/${id}`);
    assert.equal(item.equipment, guide.id === 'dumbbells' ? 'dumbbell' : 'machine');
  }
  assert.deepEqual(readAppRoute(`?view=equipment&equipment=${guide.id}`), {view:'equipment',jobId:null,muscle:null,equipment:guide.id});
}
assert.deepEqual(new Set(EQUIPMENT_GUIDES.flatMap(x => x.exerciseIds)), new Set(catalog.filter(x => x.equipment !== 'bodyweight').map(x => x.id)));
assert.deepEqual(readAppRoute('?view=equipment&equipment=not-a-device'), {view:'equipment',jobId:null,muscle:null,equipment:null});
assert.deepEqual(readAppRoute('?job=existing&view=equipment&equipment=dumbbells'), {view:'job',jobId:'existing',muscle:null});
assert.deepEqual(readAppRoute('?view=muscles&muscle=chest'), {view:'muscles',jobId:null,muscle:'chest'});
assert.equal(readAppRoute('?view=history').view, 'history');
assert.equal(readAppRoute('?view=favorites').view, 'favorites');
globalThis.location = { href:'http://127.0.0.1:8787/?job=old&muscle=chest&view=job&keep=yes' };
globalThis.history = { pushState(_state, _unused, url) { location.href = String(url); } };
writeAppUrl('equipment', null, null, 'hip-adduction');
assert.equal(new URL(location.href).search, '?keep=yes&view=equipment&equipment=hip-adduction');
writeAppUrl('new');
assert.equal(new URL(location.href).search, '?keep=yes&view=compare');
console.log(JSON.stringify({status:'passed',guides:6,relatedExercises:13,routes:'deep-link,invalid,legacy,job-precedence,cleanup passed'}));
