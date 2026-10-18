# 收藏夹打架了 — 首版接口约定

Same-origin `/api`; UTF-8 JSON. Error: `{detail: string}`. Frontend lives in `frontend/`, backend package `app/`. No hardcoded demo results in normal UI.

- GET `/api/health`: `{status, provider, model, provider_ready, ffmpeg_ready}`.
- POST `/api/videos/resolve` `{text:string}` -> `{bvid,title,author,url,pages:[{page,cid,title,duration,url}]}`. Duration in seconds. Resolve share text and b23 links, select explicit part when multipart.
- POST `/api/jobs` `{question:string,sources:[{url:string,page:number}]}` -> full Job. 2–3 distinct sources, each <=1200 sec. Metadata validation happens before job creation.
- GET `/api/jobs` -> `{items: Job[]}` (no transcript segments for list).
- GET `/api/jobs/{id}` -> full Job.
- POST `/api/jobs/{id}/retry` -> Job; uses already saved transcripts.
- DELETE `/api/jobs/{id}` -> `{ok:true}`; unfinished jobs are cancelled and deleted.
- POST `/api/jobs/{id}/sources/{source_id}/subtitle` multipart `file` (SRT/VTT/JSON max 2 MB) -> Job. Upload is allowed for failed/interrupted jobs; then retry.
- POST `/api/jobs/{id}/feedback` `{kind:'comparison'|'citation',note:string}` -> `{ok:true}`.

Job: `{id,question,status,stage,progress,created_at,updated_at,error,sources:Source[],result:Result|null,feedback:[],model,prompt_version}`.
status: `queued | running | completed | failed | interrupted`. Stage is human-readable Chinese. progress 0–100. error string or null.
Source: `{id,url,bvid,page,cid,title,author,duration,status,error,transcript_kind,segments:Segment[]}`; status `pending|fetching|ready|failed`; transcript_kind `subtitle|asr|uploaded|null`.
Segment: `{id:string,start:number,end:number,text:string}`.
Result: `{overview:string,comparisons:Comparison[],open_questions:string[]}`.
Comparison: `{id:string,topic:string,classification:'agreement'|'different_conditions'|'conflict'|'insufficient'|'different_topic',explanation:string,perspectives:Perspective[]}`.
Perspective: `{source_id:string,statement:string,audience:string,goal:string,conditions:string,limitations:string,evidence:Evidence[]}`.
Evidence: `{source_id,segment_id,text,start,end,url,context:Segment[]}`. Evidence is assembled by server from saved source segments, never model-provided quote/time/URL. Original missing fields use `未说明`.

Frontend: Chinese, mobile-first single-column cards. Navigation 新建对照 / 历史记录. Paste/resolve each link, explicit part select, question, start. Progress polls while queued/running; resume via URL `?job=id`. Result classification badges; expand exact quotes/context, source links and clear AI inference vs source distinction; report comparison/citation issue; failed-source subtitle upload + retry. No user API keys in browser.

Video module owned separately: `app/video.py` exports `VideoError(code, message)`, async `resolve_video(text)->dict`, async `load_transcript(source:dict, cache_dir:Path, progress:Callable[[str],None]|None=None)->dict` with `{kind:'subtitle'|'asr',segments:list[dict]}` and `parse_subtitle(content:bytes,filename:str)->list[dict]`. Segment IDs assigned stably by module (`seg-0001`). Network allowlist/SSRF defenses inside module. Local ASR only if available audio; explicit errors, no fabricated text.

## 人体肌群与统一导航

未增加模型推理或历史写入接口。首页默认肌群选择；`?view=muscles&muscle=chest`等有效肌群参数恢复确认后的详情，`?view=compare`打开原新建对照，`?view=history`打开历史。既有`?job=ID`优先恢复原任务。无效肌群回到选择页。选择确认前不更新页面地址；PC侧栏偏好仅存当前浏览器localStorage。

模型通过同源静态资源`/models/ecorche/ecorche.meshopt.glb`提供，原始肌肉结构映射到13个中文肌群；许可与完整署名同目录保留。手机底栏及PC可收侧栏连接上述功能。

## 动作库、收藏与视频对照导航

主菜单为练哪里、动作收藏、视频对照；视频对照内提供新建对照和对照历史。`?view=favorites`打开动作收藏；原`?view=history`及`?job=ID`保留，均归属于视频对照菜单。

- GET `/api/exercises` → `{version,reviewed_at,note,items:Exercise[]}`，来自本地核对的静态动作目录，无模型推理。
- GET `/api/exercise-favorites` → `{items:[{exercise_id,created_at}]}`，同一私人服务的PC和手机共用，按收藏时间倒序。
- PUT `/api/exercise-favorites/{exercise_id}` → `{exercise_id,saved:true}`，幂等，已有收藏保留原时间；未知ID返回404。
- DELETE `/api/exercise-favorites/{exercise_id}` → `{exercise_id,saved:false}`，幂等；未知ID返回404。收藏写入沿用同源及Host校验，与模型暂停状态独立。

Exercise包含稳定id、中文/英文名、category、equipment（bodyweight/dumbbell/machine）、requires、primary/secondary肌群ID、focus、summary、setup、steps、mistakes、source（publisher/title/url/language）及teaching（B站url/title/author/page/part_title/duration/scope）。当前16个代表动作覆盖全部13个可选肌群，文字资料来自Mayo Clinic、ACE及Life Fitness；数量与可筛选肌群由目录计算。中文要点与独立视频作者分别署名，不表示逐句相同或已完成全片动作审查；变式差异在scope说明。提踵P8、侧平举P12、弯举P14、卷腹P43、内收P55均使用明确分P，不能落到合集P1。只按primary匹配所选目标，辅助参与不冒充主练目标；空器材组合明确显示暂无收录。

收藏保存在SQLite独立`exercise_favorites`表，不写视频任务历史；数据库备份包含该表。客户端收到写入成功后才更新状态，失败显示错误与刷新入口；页面切回及进入动作浏览时重新读取收藏。训练计划未实现。

## 器材指南

练哪里内用“按肌群选 / 按器材选”切换，主菜单数量保持3个。`?view=equipment`为器材列表，`&equipment=dumbbells|lat-pulldown|chest-press|seated-row|seated-leg-curl|hip-adduction`恢复相应详情；非法ID显示列表。刷新及popstate恢复当前器材，已有job参数仍优先打开对照。切换其他模块清除器材路由参数。

器材目录与自绘SVG结构示意在前端维护；提供名称/别名搜索、识别要点、使用前调整、当前收录动作的主练肌群与原始资料链接。器材用稳定exerciseIds关联既有动作，不把全部固定器械当作同一设备；哑铃可在关联动作内按肌群筛选。动作教学及收藏复用原接口和组件，不增加模型调用、数据库表或训练处方。拍照识别留待后续。
