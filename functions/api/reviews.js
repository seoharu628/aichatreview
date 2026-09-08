const KEY='reviews_v2';

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

const strip=r=>{
  const {sec,browserToken,rp,...p}=r;
  return p;
};

const adminStrip=r=>{
  const {sec,browserToken,...p}=r;
  return p;
};

export async function onRequestGet({env}){
  try{
    return json({
      reviews:(await load(env)).map(strip)
    });
  }catch(e){
    return json({
      error:'KV를 읽지 못했어요. REVIEWS 바인딩을 확인해 주세요.'
    },500);
  }
}

export async function onRequestPost({request,env}){
  let b;

  try{
    b=await request.json();
  }catch{
    return json({error:'잘못된 요청'},400);
  }

  let list;

  try{
    list=await load(env);
  }catch{
    return json({error:'KV를 읽지 못했어요'},500);
  }

  const allowed=new Set([
    'CSS 사용 가능',
    'HTML 사용 가능',
    'CSS 사용 불가',
    'HTML 사용 불가',
    'Ui 좋음',
    'Ui 보통',
    'Ui 나쁨',
    '홈페이지만 있음',
    '어플 있음',
    '홈페이지와 어플 둘 다 있음',
    '출력량 좋음',
    '출력량 보통',
    '출력량 나쁨',
    '프롬포르 글자수 김',
    '프롬포트 글자수 짧음',
    '프롬포트 글자수 보통',
    '단축어 있음',
    '단축어 없음',
    '기억력 좋음',
    '기억력 나쁨',
    '기억력 보통',
    '모델 좋음',
    '모델 보통',
    '모델 나쁨'
  ]);

  const tags=Array.isArray(b.tags)
    ? [...new Set(
        b.tags
          .map(x=>String(x))
          .filter(x=>allowed.has(x))
      )]
    : [];

  const body=String(b.body||'').trim();

  /* 리뷰 작성 */
  if(b.action==='add'){

    const bt=String(b.browserToken||'');

    if(!bt){
      return json({
        error:'브라우저 확인 정보가 없어요'
      },400);
    }

    if(list.some(r=>r.browserToken===bt)){
      return json({
        error:'이 브라우저에서는 이미 리뷰를 작성했어요. 기존 리뷰를 수정해 주세요.'
      },409);
    }

    const rating=Math.round(Number(b.rating));

    if(
      !Number.isInteger(rating) ||
      rating<1 ||
      rating>5
    ){
      return json({
        error:'별점을 선택해 주세요'
      },400);
    }

    if(body.length>30){
      return json({
        error:'후기는 30자까지 쓸 수 있어요'
      },400);
    }

    if(!tags.length){
      return json({
        error:'특징을 하나 이상 선택해 주세요'
      },400);
    }

    const rev={
      id:crypto.randomUUID(),
      pid:String(b.pid||''),
      rating,
      body,
      tags,
      tag:'익명',
      ts:Date.now(),
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

  /* 리뷰 수정 */
  if(b.action==='edit'){

    const r=list.find(x=>x.id===b.id);

    if(!r){
      return json({
        error:'리뷰가 없어요'
      },404);
    }

    if(r.sec!==b.sec){
      return json({
        error:'수정할 권한이 없어요'
      },403);
    }

    const rating=Math.round(Number(b.rating));

    if(
      !Number.isInteger(rating) ||
      rating<1 ||
      rating>5
    ){
      return json({
        error:'별점을 선택해 주세요'
      },400);
    }

    if(body.length>30){
      return json({
        error:'후기는 30자까지 쓸 수 있어요'
      },400);
    }

    if(!tags.length){
      return json({
        error:'특징을 하나 이상 선택해 주세요'
      },400);
    }

    r.rating=rating;
    r.body=body;
    r.tags=tags;
    r.edited=true;
    r.updatedTs=Date.now();

    await save(env,list);

    return json({
      review:strip(r)
    });
  }

  /* 관리자 로그인 */
  if(b.action==='login'){
    return json({
      ok:!!env.ADMIN_PW &&
         b.pw===env.ADMIN_PW
    });
  }

  /* 관리자 신고 목록 */
  if(b.action==='adminList'){

    if(
      !env.ADMIN_PW ||
      b.pw!==env.ADMIN_PW
    ){
      return json({
        error:'권한이 없어요'
      },403);
    }

    return json({
      reviews:list.map(adminStrip)
    });
  }

  /* 관리자 삭제 / 전체삭제 / 신고초기화 */
  if(
    b.action==='delete' ||
    b.action==='clearAll' ||
    b.action==='clearReports'
  ){

    if(
      !env.ADMIN_PW ||
      b.pw!==env.ADMIN_PW
    ){
      return json({
        error:'권한이 없어요'
      },403);
    }

    if(b.action==='delete'){
      list=list.filter(x=>x.id!==b.id);
    }

    if(b.action==='clearAll'){
      list=[];
    }

    if(b.action==='clearReports'){
      const r=list.find(x=>x.id===b.id);

      if(r){
        r.rp=[];
      }
    }

    await save(env,list);

    return json({
      ok:true
    });
  }

  /* 리뷰 신고 */
  if(b.action==='report'){

    const r=list.find(x=>x.id===b.id);

    if(!r){
      return json({
        error:'리뷰가 없어요'
      },404);
    }

    r.rp=(r.rp||[]).concat({
      reason:String(b.reason||'기타'),
      ts:Date.now()
    });

    await save(env,list);

    return json({
      ok:true
    });
  }

  return json({
    error:'알 수 없는 동작'
  },400);
}
