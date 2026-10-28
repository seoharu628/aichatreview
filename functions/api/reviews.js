const KEY='reviews_v2';

// 중요: 기존 KV 데이터를 자동 초기화하거나 덮어쓰지 않습니다.
async function load(env){
  const x=await env.REVIEWS.get(KEY);
  return x?JSON.parse(x):[];
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

const strip=(r,token='')=>{
  const {sec,browserToken,rp,likeTokens,...p}=r;
  const tokens=Array.isArray(likeTokens)?likeTokens:[];
  return {...p,likeCount:tokens.length,likedByMe:!!token&&tokens.includes(token)};
};

const adminStrip=r=>{
  const {sec,browserToken,likeTokens,...p}=r;
  return {...p,likeCount:Array.isArray(likeTokens)?likeTokens.length:0};
};

const allowed=new Set([
  'CSS 사용 가능','HTML 사용 가능','CSS 사용 불가','HTML 사용 불가',
  'Ui 좋음','Ui 보통','Ui 나쁨',
  '홈페이지만 있음','어플 있음','홈페이지와 어플 둘 다 있음',
  '출력량 좋음','출력량 보통','출력량 나쁨',
  '프롬포르 글자수 김','프롬포트 글자수 짧음','프롬포트 글자수 보통',
  '단축어 있음','단축어 없음',
  '기억력 좋음','기억력 나쁨','기억력 보통',
  '모델 좋음','모델 보통','모델 나쁨'
]);

export async function onRequestGet({request,env}){
  try{
    const token=String(new URL(request.url).searchParams.get('token')||'');
    return json({reviews:(await load(env)).map(r=>strip(r,token))});
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

  // 다른 사람이 작성한 리뷰에 좋아요: 브라우저 토큰당 리뷰별 1회
  if(b.action==='like'){
    const r=list.find(x=>x.id===String(b.id||''));
    if(!r) return json({error:'리뷰가 없어요.'},404);
    const token=String(b.browserToken||'');
    if(!token) return json({error:'브라우저 확인 정보가 없어요.'},400);
    if(r.browserToken && r.browserToken===token){
      return json({error:'내 리뷰에는 좋아요를 누를 수 없어요.'},403);
    }
    r.likeTokens=Array.isArray(r.likeTokens)?r.likeTokens:[];
    if(r.likeTokens.includes(token)){
      return json({error:'이 리뷰에는 이미 좋아요를 눌렀어요.'},409);
    }
    r.likeTokens.push(token);
    await save(env,list);
    return json({ok:true,likeCount:r.likeTokens.length});
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
