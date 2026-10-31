const KEY='reviews_v2';
const USAGE_KEY='platform_usage_v1';

async function load(env){
  // 기존 리뷰 데이터는 초기화하지 않고 그대로 읽습니다.
  const x=await env.REVIEWS.get(KEY);
  return x?JSON.parse(x):[];
}

async function loadUsage(env){
  const x=await env.REVIEWS.get(USAGE_KEY);
  return x?JSON.parse(x):{};
}
async function saveUsage(env,x){
  await env.REVIEWS.put(USAGE_KEY,JSON.stringify(x));
}
function normalizeUsageEntry(entry){
  if(Array.isArray(entry?.items)){
    // 이전 버전의 단일 선택 목록은 첫 항목을 주 플랫폼, 나머지를 서브로 이전
    return {main:entry.items.slice(0,1),sub:entry.items.slice(1)};
  }
  return {main:Array.isArray(entry?.main)?entry.main:[],sub:Array.isArray(entry?.sub)?entry.sub:[]};
}
function usageSummary(data,key){
  const counts=new Map();
  for(const raw of Object.values(data||{})){
    const voter=normalizeUsageEntry(raw);
    for(const item of voter[key]||[]){
      const id=String(item.id||'');
      if(id) counts.set(id,(counts.get(id)||0)+1);
    }
  }
  return [...counts.entries()].map(([id,count])=>({id,count})).sort((a,b)=>b.count-a.count);
}

async function save(env,x){
  await env.REVIEWS.put(KEY,JSON.stringify(x));
}

function json(x,s=200){
  return new Response(JSON.stringify(x),{
    status:s,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

const strip=r=>{
  const {sec,browserToken,rp,likes,...p}=r;
  return {...p,likeCount:Array.isArray(likes)?likes.length:0};
};

const adminStrip=r=>{
  const {sec,browserToken,likes,...p}=r;
  return p;
};

const allowed=new Set([
  'CSS 사용 가능','HTML 사용 가능','CSS 사용 불가','HTML 사용 불가',
  'Ui 좋음','Ui 보통','Ui 나쁨',
  '홈페이지만 있음','어플 있음','홈페이지와 어플 둘 다 있음',
  '출력량 좋음','출력량 보통','출력량 나쁨',
  '프롬프트 글자수 긴','프롬프트 글자수 짧음','프롬프트 글자수 보통',
  '명령어 있음','명령어 없음',
  '기억력 좋음','기억력 나쁨','기억력 보통',
  '모델 좋음','모델 보통','모델 나쁨'
]);

export async function onRequestGet({env,request}){
  try{
    const url=new URL(request.url);
    const token=url.searchParams.get('token')||'';
    const usage=await loadUsage(env);
    const mine=token&&usage[token]?normalizeUsageEntry(usage[token]):{main:[],sub:[]};
    return json({
      reviews:(await load(env)).map(r=>({...strip(r),likedByMe:!!(token&&Array.isArray(r.likes)&&r.likes.includes(token))})),
      usageMain:usageSummary(usage,'main'),
      usageSub:usageSummary(usage,'sub'),
      myUsage:mine
    });
  }catch(e){
    return json({error:'KV를 읽지 못했어요. REVIEWS 바인딩을 확인해 주세요.'},500);
  }
}

export async function onRequestPost({request,env}){
  let b={};
  try{
    b=await request.json();
  }catch(e){
    return json({error:'잘못된 요청입니다.'},400);
  }

  let list=[];
  try{
    list=await load(env);
  }catch(e){
    return json({error:'KV를 읽지 못했어요.'},500);
  }

  // 리뷰 좋아요: 브라우저별로 한 번만 반영하고 같은 브라우저에서 취소 가능
  if(b.action==='setLike'){
    const id=String(b.id||'');
    const token=String(b.browserToken||'');
    if(!/^[a-f0-9-]{20,80}$/i.test(token)) return json({error:'브라우저 확인 정보가 올바르지 않아요. 새로고침해 주세요.'},400);
    const r=list.find(x=>x.id===id);
    if(!r) return json({error:'리뷰를 찾을 수 없어요.'},404);
    if(r.browserToken===token) return json({error:'내 리뷰에는 좋아요를 누를 수 없어요.'},403);
    r.likes=Array.isArray(r.likes)?r.likes:[];
    const want=!!b.liked;
    const had=r.likes.includes(token);
    if(want&&!had) r.likes.push(token);
    if(!want&&had) r.likes=r.likes.filter(x=>x!==token);
    await save(env,list);
    return json({ok:true,liked:r.likes.includes(token),likeCount:r.likes.length});
  }

  if(b.action==='saveUsage'){
    const token=String(b.token||'');
    if(!/^[a-f0-9-]{20,80}$/i.test(token)) return json({error:'사용자 확인 정보가 올바르지 않아요. 새로고침해 주세요.'},400);
    if(!Array.isArray(b.main)||b.main.length>2||!Array.isArray(b.sub)||b.sub.length>80) return json({error:'주 플랫폼은 최대 2개, 서브 플랫폼은 여러 개 선택할 수 있어요.'},400);
    const clean=(arr)=>{const out=[],seen=new Set();for(const raw of arr){const id=String(raw?.id||'').trim().slice(0,100);const name=String(raw?.name||'').trim().replace(/\s+/g,' ').slice(0,30);if(!id||!name||seen.has(id))continue;seen.add(id);out.push({id,name});}return out;};
    const main=clean(b.main),sub=clean(b.sub),mainIds=new Set(main.map(x=>x.id));
    const filteredSub=sub.filter(x=>!mainIds.has(x.id));
    if(!main.length&&!filteredSub.length)return json({error:'주 플랫폼 또는 서브 플랫폼을 하나 이상 선택해 주세요.'},400);
    const usage=await loadUsage(env);
    usage[token]={main,sub:filteredSub,updatedAt:Date.now()};
    await saveUsage(env,usage);
    return json({ok:true,myUsage:{main,sub:filteredSub},usageMain:usageSummary(usage,'main'),usageSub:usageSummary(usage,'sub')});
  }

  const tags=Array.isArray(b.tags)
    ? [...new Set(b.tags.map(x=>String(x)).filter(x=>allowed.has(x)))]
    : [];

  const body=String(b.body||'').trim();

  if(b.action==='add'){
    const pid=String(b.pid||'');
    const bt=String(b.browserToken||'');

    if(!pid) return json({error:'플랫폼 정보가 없어요.'},400);
    if(!bt) return json({error:'브라우저 확인 정보가 없어요.'},400);

    // 핵심: 같은 브라우저라도 플랫폼이 다르면 각각 1개씩 작성 가능
    if(list.some(r=>r.browserToken===bt && r.pid===pid)){
      return json({
        error:'이 플랫폼에는 이미 리뷰를 작성했어요. 기존 리뷰를 수정해 주세요.'
      },409);
    }

    const rating=Math.round(Number(b.rating));

    if(!Number.isInteger(rating)||rating<1||rating>5){
      return json({error:'별점을 선택해 주세요.'},400);
    }

    if(body.length>30){
      return json({error:'후기는 30자까지 쓸 수 있어요.'},400);
    }

    if(!tags.length){
      return json({error:'특징을 하나 이상 선택해 주세요.'},400);
    }

    const rev={
      id:crypto.randomUUID(),
      pid,
      rating,
      body,
      tags,
      ts:Date.now(),
      edited:false,
      rp:[],
      browserToken:bt,
      sec:crypto.randomUUID()
    };

    list.push(rev);
    await save(env,list);

    return json({
      review:strip(rev),
      sec:rev.sec
    });
  }

  if(b.action==='edit'){
    const r=list.find(x=>x.id===b.id);

    if(!r) return json({error:'리뷰가 없어요.'},404);
    if(r.sec!==String(b.sec||'')){
      return json({error:'수정할 권한이 없어요.'},403);
    }

    const rating=Math.round(Number(b.rating));

    if(!Number.isInteger(rating)||rating<1||rating>5){
      return json({error:'별점을 선택해 주세요.'},400);
    }

    if(body.length>30){
      return json({error:'후기는 30자까지 쓸 수 있어요.'},400);
    }

    if(!tags.length){
      return json({error:'특징을 하나 이상 선택해 주세요.'},400);
    }

    r.rating=rating;
    r.body=body;
    r.tags=tags;
    r.edited=true;
    r.updatedTs=Date.now();

    await save(env,list);
    return json({review:strip(r)});
  }

  // 리뷰 작성자 본인 삭제
  if(b.action==='ownerDelete'){
    const r=list.find(x=>x.id===b.id);

    if(!r) return json({error:'리뷰가 없어요.'},404);
    if(r.sec!==String(b.sec||'')){
      return json({error:'이 리뷰를 삭제할 권한이 없어요.'},403);
    }

    list=list.filter(x=>x.id!==b.id);
    await save(env,list);
    return json({ok:true});
  }

  // 리뷰 신고
  if(b.action==='report'){
    const r=list.find(x=>x.id===b.id);

    if(!r) return json({error:'리뷰가 없어요.'},404);

    r.rp=Array.isArray(r.rp)?r.rp:[];
    r.rp.push({
      reason:String(b.reason||'기타').slice(0,200),
      ts:Date.now()
    });

    await save(env,list);
    return json({ok:true});
  }

  // 관리자 로그인
  if(b.action==='login'){
    return json({
      ok:!!env.ADMIN_PW && String(b.pw||'')===String(env.ADMIN_PW)
    });
  }

  // 관리자 신고 목록
  if(b.action==='adminList'){
    if(!env.ADMIN_PW||String(b.pw||'')!==String(env.ADMIN_PW)){
      return json({error:'관리자 비밀번호가 올바르지 않아요.'},403);
    }

    return json({
      reviews:list.map(adminStrip)
    });
  }

  // 관리자 삭제 / 신고 초기화 / 전체 삭제
  if(
    b.action==='delete' ||
    b.action==='clearReports' ||
    b.action==='clearAll'
  ){
    if(!env.ADMIN_PW||String(b.pw||'')!==String(env.ADMIN_PW)){
      return json({error:'관리자 비밀번호가 올바르지 않아요.'},403);
    }

    if(b.action==='delete'){
      list=list.filter(x=>x.id!==b.id);
    }else if(b.action==='clearReports'){
      const r=list.find(x=>x.id===b.id);
      if(r) r.rp=[];
    }else if(b.action==='clearAll'){
      list=[];
    }

    await save(env,list);
    return json({ok:true});
  }

  return json({error:'알 수 없는 요청입니다.'},400);
}
