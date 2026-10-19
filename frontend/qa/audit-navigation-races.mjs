// Isolated HTTP mocks only. Pass a fixture file with two jobs and a preview URL.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [base,fixtureFile]=process.argv.slice(2);
assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(new URL(base).port,'8790');
assert.ok(fixtureFile,'Pass an explicit test fixture file');
const [jobA,jobB]=JSON.parse(await readFile(fixtureFile,'utf8')).jobs;
const baseline=process.argv.includes('--baseline');
const results=[];const output=new URL('../../.runtime/navigation-race-qa/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'msedge',headless:true});
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};};
async function scenario(kind){
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  const seen=deferred(),gate=deferred();let armed=kind!=='refresh';const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const queued={...jobA,status:'queued',error:null,result:null,stage:'隔离模拟：已排队'};
  const heldPath=kind==='history'||kind==='refresh'?`/api/jobs/${jobA.id}`:kind==='create'?'/api/jobs':kind==='upload'?`/api/jobs/${jobA.id}/sources/${jobA.sources[0].id}/subtitle`:`/api/jobs/${jobA.id}/retry`;
  const heldMethod=kind==='history'||kind==='refresh'?'GET':'POST';
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
    const reply=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(armed&&path===heldPath&&method===heldMethod){seen.release();await gate.promise;if(kind==='refresh')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'隔离旧任务刷新失败'})});return reply(kind==='history'?jobA:kind==='upload'?{...jobA,stage:'隔离模拟：已上传'}:queued);}
    if(path==='/api/health')return reply({status:'ok',provider:'test-mock',provider_ready:true,model:'mock',ffmpeg_ready:true});
    if(path==='/api/jobs'&&method==='GET')return reply({items:[jobA,jobB].map(job=>({...job,result:null}))});
    if(path===`/api/jobs/${jobA.id}`&&method==='GET')return reply(jobA);
    if(path===`/api/jobs/${jobB.id}`&&method==='GET')return reply(jobB);
    if(path==='/api/videos/resolve'&&method==='POST'){
      const text=request.postDataJSON().text;const source=jobA.sources.find(x=>text===x.url);assert.ok(source);
      return reply({bvid:source.bvid,url:source.url,title:source.title,author:source.author,pages:[{page:source.page,cid:source.cid,title:source.title,duration:source.duration,url:source.url}]});
    }
    if(method==='GET'&&['/api/exercises','/api/exercise-favorites','/api/training'].includes(path))return route.continue();
    return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'QA blocks unexpected API calls'})});
  });
  const button=name=>page.getByRole('button',{name,exact:true});
  if(kind==='history'){
    await page.goto(base+'/?view=history');await page.locator('.history-open').filter({hasText:jobA.question}).click();
  }else if(kind==='create'){
    await page.goto(base+'/?view=compare');
    for(let i=0;i<2;i++){await page.getByLabel(`视频 ${i+1}`,{exact:true}).fill(jobA.sources[i].url);await page.locator('.draft-card').nth(i).getByRole('button',{name:'识别视频',exact:true}).click();await page.locator('.draft-card').nth(i).getByRole('button',{name:'已识别',exact:true}).waitFor();}
    await page.getByLabel('你想弄清楚什么？',{exact:true}).fill('隔离验收：创建期间切换页面');await button('开始对照').click();
  }else{
    await page.goto(base+'/?job='+jobA.id);await page.getByRole('heading',{name:jobA.question,exact:true}).waitFor();
    if(kind==='refresh'){armed=true;await button('刷新').click();}
    else if(kind==='upload')await page.locator('input[type=file]').first().setInputFiles({name:'qa.srt',mimeType:'application/x-subrip',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n隔离测试字幕\n')});
    else await button('重新对照').click();
  }
  await seen.promise;
  if(kind==='history'||kind==='create'){
    await button('训练').click();await page.getByRole('heading',{name:'训练',exact:true}).waitFor();
  }else{
    await button('视频对照').click();await button('对照历史').click();await page.locator('.history-open').filter({hasText:jobB.question}).click();await page.locator('.question-preview').filter({hasText:jobB.question}).waitFor();
  }
  const refreshEnabledBeforeResponse=kind==='refresh'?await button('更新中').count()===0:undefined;
  if(kind==='refresh')assert.equal(refreshEnabledBeforeResponse,!baseline,'New job must not inherit a pending refresh from the old job');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===heldPath&&r.request().method()===heldMethod);
  gate.release();await response;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  const state=await page.evaluate(()=>({search:location.search,question:document.querySelector('.job-question')?.textContent||document.querySelector('.question-preview')?.textContent,training:[...document.querySelectorAll('h1')].some(node=>node.getClientRects().length&&node.textContent==='训练'),oldRefreshError:document.body.textContent.includes('隔离旧任务刷新失败')}));
  const broken=kind==='history'||kind==='create'?new URLSearchParams(state.search).has('job'):kind==='refresh'?state.oldRefreshError:state.question===jobA.question;
  assert.equal(broken,baseline,`${kind}: delayed response must respect current navigation`);
  assert.deepEqual(errors,[]);results.push({case:kind,status:baseline?'reproduced':'passed',refreshEnabledBeforeResponse,...state});
  await context.close();
}
try{for(const kind of ['history','create','retry','upload','refresh'])await scenario(kind);const report={status:baseline?'baseline-reproduced':'passed',cases:results,realModelRequests:0,allVideoMutationsMocked:true};await writeFile(new URL(baseline?'baseline.json':'report.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();}
