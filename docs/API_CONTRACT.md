# 练有引力 — 接口约定

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

肌群流程拆成两个独立页面：无muscle参数时只选肌群，点击后先确认；确认后相同路由的有效`muscle`参数显示独立动作选择页，仅保留标题、器材筛选、动作教学/收藏和“返回肌群选择”，不渲染人体模型或已选肌群信息卡。返回按钮清除muscle参数，刷新/浏览器前后退仍按地址恢复。动作页避免重复列表标题；模型来源与许可在选择页继续保留。

## 动作库、收藏与视频对照导航

主菜单为练哪里、动作收藏、视频对照；视频对照内提供新建对照和对照历史。`?view=favorites`打开动作收藏；原`?view=history`及`?job=ID`保留，均归属于视频对照菜单。

- GET `/api/exercises` → `{version,reviewed_at,note,items:Exercise[]}`，来自本地核对的静态动作目录，无模型推理。
- GET `/api/exercise-favorites` → `{items:[{exercise_id,created_at}]}`，同一私人服务的PC和手机共用，按收藏时间倒序。
- PUT `/api/exercise-favorites/{exercise_id}` → `{exercise_id,saved:true}`，幂等，已有收藏保留原时间；未知ID返回404。
- DELETE `/api/exercise-favorites/{exercise_id}` → `{exercise_id,saved:false}`，幂等；未知ID返回404。收藏写入沿用同源及Host校验，与模型暂停状态独立。

Exercise包含稳定id、中文/英文名、category、equipment（bodyweight/dumbbell/machine）、requires、primary/secondary肌群ID、focus、summary、setup、steps、mistakes、source（publisher/title/url/language）及teaching（B站url/title/author/page/part_title/duration/scope）。当前16个代表动作覆盖全部13个可选肌群，文字资料来自Mayo Clinic、ACE及Life Fitness；数量与可筛选肌群由目录计算。中文要点与独立视频作者分别署名，不表示逐句相同或已完成全片动作审查；变式差异在scope说明。提踵P8、侧平举P12、弯举P14、卷腹P43、内收P55均使用明确分P，不能落到合集P1。只按primary匹配所选目标，辅助参与不冒充主练目标；空器材组合明确显示暂无收录。

收藏保存在SQLite独立`exercise_favorites`表，不写视频任务历史；数据库备份包含该表。客户端收到写入成功后才更新状态，失败显示错误与刷新入口；页面切回及进入动作浏览时重新读取收藏。训练计划未实现。

## 器材指南

练哪里内用“按肌群选 / 按器材选”切换，训练加入后的主菜单共4个。`?view=equipment`为器材列表，`&equipment=dumbbells|lat-pulldown|chest-press|seated-row|seated-leg-curl|hip-adduction`恢复相应详情；非法ID显示列表。刷新及popstate恢复当前器材，已有job参数仍优先打开对照。切换其他模块清除器材路由参数。

器材目录与自绘SVG结构示意在前端维护；提供名称/别名搜索、识别要点、使用前调整、当前收录动作的主练肌群与原始资料链接。器材用稳定exerciseIds关联既有动作，不把全部固定器械当作同一设备；哑铃可在关联动作内按肌群筛选。动作教学及收藏复用原接口和组件，不增加模型调用、数据库表或训练处方。拍照识别留待后续。

## 训练记录与组间计时

主菜单现为练哪里、视频对照、训练、动作收藏；手机4列底栏、PC侧栏。默认首页及品牌按钮仍回练哪里，品牌名后不加装饰句号。`?view=training`打开训练，job参数仍优先。手动训练记录与自动生成训练计划区分，后者未实现。

- GET `/api/training` → `{active:TrainingSession|null,history:TrainingSummary[],last_exercises:{[exercise_id]:{session_id,ended_at,name,sets}}}`。历史最近100次；上次记录从最近1000次已完成训练中按动作选取，只有真实勾选完成的组，取消的训练不作为上次成绩。
- POST `/api/training` `{id:UUID,exercise_ids:string[]}` → TrainingSession（201），1–30个已收录且不重复动作；相同id重试返回已创建记录。一个进行中训练，由事务及唯一索引保证，已有其他训练时409。每个动作初始3组空值，不预填为今日成绩。
- GET `/api/training/{UUID}` → TrainingSession；不存在404。
- PUT `/api/training/{UUID}` `{version:int,status:'active'|'completed'|'cancelled',exercises:[{exercise_id,sets:[{id,weight_kg:number|null,reps:int|null,completed:bool}]}]}` → 新版本TrainingSession。版本冲突或已结束时409；动作/组唯一、每动作1–20组、重量有限数0–2000kg、次数整数1–1000；完成组必须有重量和次数。结束训练至少有1组完成；取消保留记录。所有写入沿用同源/Host检查，与额度暂停独立。

TrainingSession含id、created_at/updated_at/ended_at、status、version、exercises（动作名称与器材快照，sets）；summary含动作数与完成组数。SQLite独立training_sessions表；备份校验包括该表，旧任务/收藏/额度状态保留。重量按统一记录口径：哑铃单只、器械标注、徒手0kg，不作为负荷建议。

填写后手动保存，勾选完成自动保存成功才启动休息；错误保留本地输入，冲突可确认后重新读取。训练模块跨菜单保留未保存草稿，刷新/关闭有未保存提示；已保存记录从服务恢复。历史首版只读。休息默认90秒，可调15–600秒、暂停/继续/清零，依据真实截止时间计算；计时及秒数偏好只保存在当前浏览器，跨页/刷新后恢复，不承诺后台或锁屏提醒。结束/取消训练清空本浏览器计时，不发起模型推理。

训练中点击动作名称可打开同一动作的既有教学弹窗，含步骤、视频与原始来源；关闭后回到当前记录，草稿和计时保留。已存历史也可查看教学。移除动作或删除组仅修改当前草稿，需保存后持久化；存在填写值或完成标记时先确认，空白可直接移除，每次至少保留一个动作/每动作一组，最后一个动作可用取消训练处理。仍沿用版本冲突保护，历史记录只读。

进行中添加动作后立即关闭选择弹窗，新增动作去重并保留在草稿；自动保存失败或现有输入校验不通过时，可直接回记录页修改/点击保存，不重复追加动作。网络保存错误提示“保存未确认，当前输入仍保留”；若请求已保存但回复丢失，后续仍由版本号拒绝旧版本覆盖，用户可保留输入或确认重新读取。

结束成功直接展示本次小结；重新打开历史时可再查看。已练动作数、完成组数仅统计勾选完成的组；动作详情仍列出所有已保存动作并标注未完成者。记录时长按实际created_at到ended_at的间隔计算、包含休息，缺失或无效时间标为未记录，不推断实际运动时长、热量或训练质量。不新增模型请求或数据库字段。
