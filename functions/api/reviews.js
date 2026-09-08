// Cloudflare Pages Functions - /api/reviews
// KV binding name: REVIEWS
// Environment variable: ADMIN_PW

const KEY = 'reviews';

async function load(env) {
  const raw = await env.REVIEWS.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

async function save(env, list) {
  await env.REVIEWS.put(KEY, JSON.stringify(list));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

const strip = r => {
  const { sec, ...pub } = r;
  return pub;
};

export async function onRequestGet({ env }) {
  try {
    const list = await load(env);
    return json({ reviews: list.map(strip) });
  } catch (e) {
    return json({
      error: 'KV를 읽지 못했어요. 바인딩 이름이 REVIEWS인지 확인해 주세요.'
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let b;

  try {
    b = await request.json();
  } catch {
    return json({ error: '잘못된 요청' }, 400);
  }

  const adminPw = env.ADMIN_PW || '';

  // 관리자 로그인
  if (b.action === 'login') {
    return json({ ok: !!adminPw && b.pw === adminPw });
  }

  let list;
  try {
    list = await load(env);
  } catch {
    return json({ error: 'KV를 읽지 못했어요' }, 500);
  }

  // 익명 리뷰 등록
  if (b.action === 'add') {
    const pid = String(b.pid || '').trim();
    const body = String(b.body || '').trim();

    const allowedTags = new Set([
      'CSS 사용 가능','HTML 사용 가능','CSS 사용 불가','HTML 사용 불가',
      'Ui 좋음','Ui 보통','Ui 나쁨',
      '홈페이지만 있음','어플 있음','홈페이지와 어플 둘 다 있음',
      '출력량 좋음','출력량 보통','출력량 나쁨',
      '모델 좋음','모델 보통','모델 나쁨'
    ]);

    const tags = Array.isArray(b.tags)
      ? [...new Set(
          b.tags
            .map(x => String(x).trim())
            .filter(x => allowedTags.has(x))
        )]
      : [];

    const bannedWords = [
      'ㅈ목','친목','친목질','친.목','ㅊ목','디씨','디씨인사이드'
    ];

    if (!pid) return json({ error: '플랫폼이 없어요' }, 400);
    if (body.length > 30) return json({ error: '후기는 30자까지 쓸 수 있어요' }, 400);
    if (!tags.length) return json({ error: '특징을 하나 이상 선택해 주세요' }, 400);

    if (bannedWords.some(word => body.includes(word))) {
      return json({ error: '사용할 수 없는 단어가 포함되어 있어요' }, 400);
    }

    const rev = {
      id: crypto.randomUUID(),
      pid,
      rating: 0,
      body,
      tags,
      tag: '익명',
      ts: Date.now(),
      rp: [],
      sec: crypto.randomUUID()
    };

    list.push(rev);
    await save(env, list);

    return json({
      review: strip(rev)
    });
  }

  // 리뷰 신고
  if (b.action === 'report') {
    const t = list.find(r => r.id === b.id);

    if (!t) {
      return json({ error: '이미 삭제된 리뷰예요' }, 404);
    }

    t.rp = (t.rp || []).concat([{
      reason: String(b.reason || '기타').slice(0, 20),
      ts: Date.now()
    }]);

    await save(env, list);
    return json({ ok: true });
  }

  // 관리자 리뷰 삭제
  if (b.action === 'delete') {
    if (!adminPw || b.pw !== adminPw) {
      return json({ error: '권한이 없어요' }, 403);
    }

    const exists = list.some(r => r.id === b.id);
    if (!exists) return json({ ok: true });

    await save(env, list.filter(r => r.id !== b.id));
    return json({ ok: true });
  }

  // 관리자 전체 리뷰 삭제
  if (b.action === 'clearAll') {
    if (!adminPw || b.pw !== adminPw) {
      return json({ error: '권한이 없어요' }, 403);
    }

    await save(env, []);
    return json({ ok: true });
  }

  // 관리자 신고 기록 삭제
  if (b.action === 'clearReports') {
    if (!adminPw || b.pw !== adminPw) {
      return json({ error: '권한이 없어요' }, 403);
    }

    const t = list.find(r => r.id === b.id);
    if (t) t.rp = [];

    await save(env, list);
    return json({ ok: true });
  }

  return json({ error: '알 수 없는 동작' }, 400);
}
