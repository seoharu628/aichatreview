// Cloudflare Pages Functions - /api/reviews
// KV 네임스페이스 바인딩 이름: REVIEWS
// 환경 변수: ADMIN_PW (관리자 비밀번호)

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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
const strip = r => { const { sec, ...pub } = r; return pub; };

export async function onRequestGet({ env }) {
  try {
    const list = await load(env);
    return json({ reviews: list.map(strip) });
  } catch (e) {
    return json({ error: 'KV를 읽지 못했어요. 바인딩 이름이 REVIEWS인지 확인해 주세요.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }

  const pw = env.ADMIN_PW || '';
  if (b.action === 'login') return json({ ok: !!pw && b.pw === pw });

  let list;
  try { list = await load(env); }
  catch { return json({ error: 'KV를 읽지 못했어요' }, 500); }

  if (b.action === 'add') {
    const body = String(b.body || '').trim();
    const rating = Math.round(Number(b.rating));
    const pid = String(b.pid || '');
    if (body.length < 5) return json({ error: '후기를 5자 이상 적어주세요' }, 400);
    if (body.length > 10000) return json({ error: '후기는 1만 자까지 쓸 수 있어요' }, 400);
    if (!(rating >= 1 && rating <= 5)) return json({ error: '별점을 확인해 주세요' }, 400);
    if (!pid) return json({ error: '플랫폼이 없어요' }, 400);

    const rev = {
      id: crypto.randomUUID(),
      pid, rating, body,
      tag: '익명 ' + Math.floor(1000 + Math.random() * 9000),
      ts: Date.now(),
      rp: [],
      sec: crypto.randomUUID()      // 작성자만 아는 삭제용 열쇠
    };
    list.push(rev);
    await save(env, list);
    return json({ review: strip(rev), sec: rev.sec });
  }

  if (b.action === 'edit') {
    const t = list.find(r => r.id === b.id);
    if (!t) return json({ error: '이미 삭제된 리뷰예요' }, 404);
    if (t.sec !== b.sec) return json({ error: '수정할 권한이 없어요' }, 403);

    const body = String(b.body || '').trim();
    const rating = Math.round(Number(b.rating));
    if (body.length < 5) return json({ error: '후기를 5자 이상 적어주세요' }, 400);
    if (body.length > 10000) return json({ error: '후기는 1만 자까지 쓸 수 있어요' }, 400);
    if (!(rating >= 1 && rating <= 5)) return json({ error: '별점을 확인해 주세요' }, 400);

    t.rating = rating;
    t.body = body;
    t.edited = true;
    t.updatedTs = Date.now();
    await save(env, list);
    return json({ review: strip(t) });
  }

  if (b.action === 'report') {
    const t = list.find(r => r.id === b.id);
    if (!t) return json({ error: '이미 삭제된 리뷰예요' }, 404);
    t.rp = (t.rp || []).concat([{ reason: String(b.reason || '기타').slice(0, 20), ts: Date.now() }]);
    await save(env, list);
    return json({ ok: true });
  }

  if (b.action === 'delete') {
    const t = list.find(r => r.id === b.id);
    if (!t) return json({ ok: true });
    const isAdmin = pw && b.pw === pw;
    if (!isAdmin && t.sec !== b.sec) return json({ error: '지울 권한이 없어요' }, 403);
    await save(env, list.filter(r => r.id !== b.id));
    return json({ ok: true });
  }

  if (b.action === 'clearReports') {
    if (!pw || b.pw !== pw) return json({ error: '권한이 없어요' }, 403);
    const t = list.find(r => r.id === b.id);
    if (t) t.rp = [];
    await save(env, list);
    return json({ ok: true });
  }

  return json({ error: '알 수 없는 동작' }, 400);
}
