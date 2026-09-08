// Cloudflare Pages Functions - /api/reviews
// KV 네임스페이스 바인딩 이름: REVIEWS
// 환경 변수: ADMIN_PW (관리자 비밀번호)

const KEY = 'reviews';
const USER_PREFIX = 'user:';
const SESSION_PREFIX = 'session:';

async function token() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function passHash(pass, salt) {
  const d = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(salt + '\0' + pass)
  );
  return [...new Uint8Array(d)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

async function getUser(env, u) {
  const x = await env.REVIEWS.get(USER_PREFIX + u);
  return x ? JSON.parse(x) : null;
}

async function account(env, s) {
  if (!s) return null;

  const x = await env.REVIEWS.get(SESSION_PREFIX + s);
  if (!x) return null;

  const z = JSON.parse(x);

  if (!z || z.exp < Date.now()) return null;

  return getUser(env, z.user);
}

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

    return json({
      reviews: list.map(strip)
    });

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
    return json({
      error: '잘못된 요청'
    }, 400);
  }

  const pw = env.ADMIN_PW || '';


  /* =========================
     회원가입
  ========================= */

  if (b.action === 'signup') {

    const user = String(b.user || '').trim();
    const pass = String(b.pass || '');

    if (!/^[A-Za-z0-9_가-힣]{3,20}$/.test(user)) {
      return json({
        error: '아이디는 3~20자로 입력해 주세요'
      }, 400);
    }

    if (pass.length < 6) {
      return json({
        error: '비밀번호는 6자 이상이어야 해요'
      }, 400);
    }

    if (await getUser(env, user)) {
      return json({
        error: '이미 사용 중인 아이디예요'
      }, 409);
    }

    const salt = await token();
    const hash = await passHash(pass, salt);

    await env.REVIEWS.put(
      USER_PREFIX + user,
      JSON.stringify({
        user,
        salt,
        hash,
        createdTs: Date.now()
      })
    );

    return json({
      ok: true
    });
  }


  /* =========================
     로그인
  ========================= */

  if (b.action === 'accountLogin') {

    const user = String(b.user || '').trim();
    const pass = String(b.pass || '');

    const u = await getUser(env, user);

    if (!u || await passHash(pass, u.salt) !== u.hash) {
      return json({
        error: '아이디 또는 비밀번호가 맞지 않아요'
      }, 401);
    }

    const session = await token();

    await env.REVIEWS.put(
      SESSION_PREFIX + session,
      JSON.stringify({
        user,
        exp: Date.now() + 30 * 86400000
      })
    );

    return json({
      ok: true,
      user,
      session
    });
  }


  /* =========================
     로그아웃
  ========================= */

  if (b.action === 'accountLogout') {

    if (b.session) {
      await env.REVIEWS.delete(
        SESSION_PREFIX + b.session
      );
    }

    return json({
      ok: true
    });
  }


  /* =========================
     관리자 로그인
  ========================= */

  if (b.action === 'login') {
    return json({
      ok: !!pw && b.pw === pw
    });
  }


  /* =========================
     리뷰 데이터 불러오기
  ========================= */

  let list;

  try {
    list = await load(env);
  } catch {
    return json({
      error: 'KV를 읽지 못했어요'
    }, 500);
  }


  /* =========================
     리뷰 등록
  ========================= */

  if (b.action === 'add') {

    const user = await account(env, b.session);

    if (!user) {
      return json({
        error: '회원가입 후 로그인한 사용자만 리뷰를 등록할 수 있어요'
      }, 401);
    }

    const pid = String(b.pid || '');

    if (
      list.some(
        r => r.uid === user.user && r.pid === pid
      )
    ) {
      return json({
        error: '이 계정은 이 플랫폼에 이미 리뷰를 작성했어요'
      }, 409);
    }

    const body = String(b.body || '').trim();

    const bannedWords = [
      'ㅈ목',
      '친목',
      '친목질',
      '친.목',
      'ㅊ목',
      '디씨',
      '디씨인사이드'
    ];

    if (
      bannedWords.some(
        word => body.includes(word)
      )
    ) {
      return json({
        error: '사용할 수 없는 단어가 포함되어 있어요'
      }, 400);
    }

    const rating = Math.round(
      Number(b.rating)
    );

    if (body.length < 5) {
      return json({
        error: '후기를 5자 이상 적어주세요'
      }, 400);
    }

    if (body.length > 10000) {
      return json({
        error: '후기는 1만 자까지 쓸 수 있어요'
      }, 400);
    }

    if (!(rating >= 1 && rating <= 5)) {
      return json({
        error: '별점을 확인해 주세요'
      }, 400);
    }

    if (!pid) {
      return json({
        error: '플랫폼이 없어요'
      }, 400);
    }

    const rev = {
      id: crypto.randomUUID(),
      pid,
      rating,
      body,
      uid: user.user,
      tag: '익명 ' + Math.floor(
        1000 + Math.random() * 9000
      ),
      ts: Date.now(),
      rp: [],
      sec: crypto.randomUUID()
    };

    list.push(rev);

    await save(env, list);

    return json({
      review: strip(rev),
      sec: rev.sec
    });
  }


  /* =========================
     리뷰 수정
  ========================= */

  if (b.action === 'edit') {

    const t = list.find(
      r => r.id === b.id
    );

    if (!t) {
      return json({
        error: '이미 삭제된 리뷰예요'
      }, 404);
    }

    if (t.sec !== b.sec) {
      return json({
        error: '수정할 권한이 없어요'
      }, 403);
    }

    const body = String(
      b.body || ''
    ).trim();

    const bannedWords = [
      'ㅈ목',
      '친목',
      '친.목',
      'ㅊ목',
      '디씨',
      '디씨인사이드'
    ];

    if (
      bannedWords.some(
        word => body.includes(word)
      )
    ) {
      return json({
        error: '사용할 수 없는 단어가 포함되어 있어요'
      }, 400);
    }

    const rating = Math.round(
      Number(b.rating)
    );

    if (body.length < 5) {
      return json({
        error: '후기를 5자 이상 적어주세요'
      }, 400);
    }

    if (body.length > 10000) {
      return json({
        error: '후기는 1만 자까지 쓸 수 있어요'
      }, 400);
    }

    if (!(rating >= 1 && rating <= 5)) {
      return json({
        error: '별점을 확인해 주세요'
      }, 400);
    }

    t.rating = rating;
    t.body = body;
    t.edited = true;
    t.updatedTs = Date.now();

    await save(env, list);

    return json({
      review: strip(t)
    });
  }


  /* =========================
     리뷰 신고
  ========================= */

  if (b.action === 'report') {

    const t = list.find(
      r => r.id === b.id
    );

    if (!t) {
      return json({
        error: '이미 삭제된 리뷰예요'
      }, 404);
    }

    t.rp = (t.rp || []).concat([
      {
        reason: String(
          b.reason || '기타'
        ).slice(0, 20),
        ts: Date.now()
      }
    ]);

    await save(env, list);

    return json({
      ok: true
    });
  }


  /* =========================
     리뷰 삭제
  ========================= */

  if (b.action === 'delete') {

    const t = list.find(
      r => r.id === b.id
    );

    if (!t) {
      return json({
        ok: true
      });
    }

    const isAdmin =
      pw && b.pw === pw;

    if (
      !isAdmin &&
      t.sec !== b.sec
    ) {
      return json({
        error: '지울 권한이 없어요'
      }, 403);
    }

    await save(
      env,
      list.filter(
        r => r.id !== b.id
      )
    );

    return json({
      ok: true
    });
  }


  /* =========================
     신고 기록 삭제
  ========================= */

  if (b.action === 'clearReports') {

    if (!pw || b.pw !== pw) {
      return json({
        error: '권한이 없어요'
      }, 403);
    }

    const t = list.find(
      r => r.id === b.id
    );

    if (t) {
      t.rp = [];
    }

    await save(env, list);

    return json({
      ok: true
    });
  }


  return json({
    error: '알 수 없는 동작'
  }, 400);
}
