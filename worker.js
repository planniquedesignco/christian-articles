const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS / preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": url.origin,
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    try {
      // ============================
      // API
      // ============================
      if (url.pathname.startsWith("/api/")) {
        return await handleAPI(request, env, url);
      }

      // ============================
      // R2 IMAGE DELIVERY
      // Optional - only works if
      // R2 binding IMAGES is added.
      // ============================
      if (url.pathname.startsWith("/media/") && env.IMAGES) {
        const key = decodeURIComponent(
          url.pathname.slice("/media/".length)
        );

        const object = await env.IMAGES.get(key);

        if (!object) {
          return new Response("Not found", {
            status: 404
          });
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);

        headers.set("etag", object.httpEtag);
        headers.set(
          "cache-control",
          "public, max-age=31536000, immutable"
        );

        return new Response(object.body, {
          headers
        });
      }

      // ============================
      // STATIC FRONTEND
      // ============================
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not found", {
        status: 404
      });

    } catch (err) {
      console.error(err);

      return json(
        {
          error: "Internal server error",
          detail: String(err?.message || err)
        },
        500
      );
    }
  }
};


// ======================================================
// API ROUTER
// ======================================================

async function handleAPI(request, env, url) {
  const { pathname } = url;


  // ====================================================
  // PUBLIC WEBSITE CONTENT
  // No login required
  // ====================================================

  if (
    pathname === "/api/public/content" &&
    request.method === "GET"
  ) {
    return publicContent(env);
  }


  // ====================================================
  // ADMIN LOGIN
  // ====================================================

  if (
    pathname === "/api/admin/login" &&
    request.method === "POST"
  ) {
    const body = await request
      .json()
      .catch(() => ({}));

    const expected = env.ADMIN_PASSWORD || "";

    if (!expected || body.password !== expected) {
      return json(
        {
          error: "Invalid password"
        },
        401
      );
    }

    const token = await makeSession(env);

    return json(
      {
        ok: true
      },
      {
        headers: {
          "set-cookie": sessionCookie(token)
        }
      }
    );
  }


  // ====================================================
  // ADMIN LOGOUT
  // ====================================================

  if (
    pathname === "/api/admin/logout" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true
      },
      {
        headers: {
          "set-cookie":
            "cms_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        }
      }
    );
  }


  // ====================================================
  // EVERYTHING BELOW REQUIRES ADMIN LOGIN
  // ====================================================

  const authed = await requireAuth(request, env);

  if (!authed) {
    return json(
      {
        error: "Unauthorized"
      },
      401
    );
  }


  // ====================================================
  // CHECK LOGIN
  // ====================================================

  if (
    pathname === "/api/admin/me" &&
    request.method === "GET"
  ) {
    return json({
      ok: true
    });
  }


  // ====================================================
  // DASHBOARD
  // ====================================================

  if (
    pathname === "/api/admin/dashboard" &&
    request.method === "GET"
  ) {
    const [
      all,
      published,
      drafts,
      categories
    ] = await Promise.all([
      env.DB
        .prepare(
          "SELECT COUNT(*) c FROM articles"
        )
        .first(),

      env.DB
        .prepare(
          "SELECT COUNT(*) c FROM articles WHERE status='published'"
        )
        .first(),

      env.DB
        .prepare(
          "SELECT COUNT(*) c FROM articles WHERE status='draft'"
        )
        .first(),

      env.DB
        .prepare(
          "SELECT COUNT(*) c FROM categories WHERE is_active=1"
        )
        .first()
    ]);

    const recent = await env.DB
      .prepare(`
        SELECT
          a.id,
          a.title,
          a.status,
          a.updated_at,
          c.name category_name
        FROM articles a
        LEFT JOIN categories c
          ON c.id = a.category_id
        ORDER BY datetime(a.updated_at) DESC
        LIMIT 6
      `)
      .all();

    return json({
      stats: {
        all: Number(all?.c || 0),
        published: Number(published?.c || 0),
        drafts: Number(drafts?.c || 0),
        categories: Number(categories?.c || 0)
      },

      recent: recent.results || []
    });
  }


  // ====================================================
  // SITE SETTINGS - GET
  // ====================================================

  if (
    pathname === "/api/admin/site" &&
    request.method === "GET"
  ) {
    const row = await env.DB
      .prepare(
        "SELECT * FROM site_settings WHERE id=1"
      )
      .first();

    return json(row || {});
  }


  // ====================================================
  // SITE SETTINGS - UPDATE
  // ====================================================

  if (
    pathname === "/api/admin/site" &&
    request.method === "PUT"
  ) {
    const b = await request.json();

    await env.DB
      .prepare(`
        UPDATE site_settings
        SET
          site_name=?,
          tagline=?,
          hero_title=?,
          hero_intro=?,
          hero_image=?,
          author_name=?,
          author_short_bio=?,
          author_full_bio=?,
          author_image=?,
          instagram_url=?,
          facebook_url=?,
          youtube_url=?,
          contact_email=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=1
      `)
      .bind(
        s(b.site_name),
        s(b.tagline),
        s(b.hero_title),
        s(b.hero_intro),
        s(b.hero_image),

        s(b.author_name),
        s(b.author_short_bio),
        s(b.author_full_bio),
        s(b.author_image),

        s(b.instagram_url),
        s(b.facebook_url),
        s(b.youtube_url),
        s(b.contact_email)
      )
      .run();

    return json({
      ok: true
    });
  }


  // ====================================================
  // CATEGORIES - GET ALL
  // ====================================================

  if (
    pathname === "/api/admin/categories" &&
    request.method === "GET"
  ) {
    const rows = await env.DB
      .prepare(`
        SELECT
          c.*,
          COUNT(a.id) article_count
        FROM categories c

        LEFT JOIN articles a
          ON a.category_id = c.id

        GROUP BY c.id

        ORDER BY
          c.sort_order ASC,
          c.name ASC
      `)
      .all();

    return json(
      rows.results || []
    );
  }


  // ====================================================
  // CATEGORY - CREATE
  // ====================================================

  if (
    pathname === "/api/admin/categories" &&
    request.method === "POST"
  ) {
    const b = await request.json();

    const name = s(b.name).trim();

    if (!name) {
      return json(
        {
          error: "Category name is required"
        },
        400
      );
    }

    const slug = slugify(
      b.slug || name
    );

    const result = await env.DB
      .prepare(`
        INSERT INTO categories(
          name,
          slug,
          description,
          sort_order,
          is_active
        )
        VALUES(?,?,?,?,?)
      `)
      .bind(
        name,
        slug,
        s(b.description),
        num(b.sort_order),
        boolInt(b.is_active, 1)
      )
      .run();

    return json({
      ok: true,
      id: result.meta.last_row_id
    });
  }


  // ====================================================
  // CATEGORY ID ROUTE
  // ====================================================

  const catMatch = pathname.match(
    /^\/api\/admin\/categories\/(\d+)$/
  );


  // ====================================================
  // CATEGORY - UPDATE
  // ====================================================

  if (
    catMatch &&
    request.method === "PUT"
  ) {
    const id = Number(
      catMatch[1]
    );

    const b = await request.json();

    const name = s(
      b.name
    ).trim();

    if (!name) {
      return json(
        {
          error: "Category name is required"
        },
        400
      );
    }

    await env.DB
      .prepare(`
        UPDATE categories
        SET
          name=?,
          slug=?,
          description=?,
          sort_order=?,
          is_active=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `)
      .bind(
        name,
        slugify(
          b.slug || name
        ),
        s(b.description),
        num(b.sort_order),
        boolInt(
          b.is_active,
          1
        ),
        id
      )
      .run();

    return json({
      ok: true
    });
  }


  // ====================================================
  // CATEGORY - DELETE
  // ====================================================

  if (
    catMatch &&
    request.method === "DELETE"
  ) {
    const id = Number(
      catMatch[1]
    );

    const used = await env.DB
      .prepare(`
        SELECT COUNT(*) c
        FROM articles
        WHERE category_id=?
      `)
      .bind(id)
      .first();

    if (
      Number(
        used?.c || 0
      ) > 0
    ) {
      return json(
        {
          error:
            "This category is still used by articles. Reassign them first."
        },
        409
      );
    }

    await env.DB
      .prepare(`
        DELETE FROM categories
        WHERE id=?
      `)
      .bind(id)
      .run();

    return json({
      ok: true
    });
  }


  // ====================================================
  // ARTICLES - GET ALL
  // Search + status + category
  // ====================================================

  if (
    pathname === "/api/admin/articles" &&
    request.method === "GET"
  ) {
    const q =
      url.searchParams.get("q") || "";

    const status =
      url.searchParams.get("status") || "";

    const category =
      url.searchParams.get("category") || "";

    let sql = `
      SELECT
        a.*,
        c.name category_name,
        c.slug category_slug

      FROM articles a

      LEFT JOIN categories c
        ON c.id = a.category_id

      WHERE 1=1
    `;

    const params = [];


    // Search
    if (q) {
      sql += `
        AND (
          a.title LIKE ?
          OR a.excerpt LIKE ?
          OR a.highlight LIKE ?
        )
      `;

      const like =
        `%${q}%`;

      params.push(
        like,
        like,
        like
      );
    }


    // Status filter
    if (status) {
      sql += `
        AND a.status=?
      `;

      params.push(
        status
      );
    }


    // Category filter
    if (category) {
      sql += `
        AND a.category_id=?
      `;

      params.push(
        Number(category)
      );
    }


    sql += `
      ORDER BY
        a.is_pinned DESC,
        a.sort_order DESC,
        datetime(
          COALESCE(
            a.published_at,
            a.updated_at
          )
        ) DESC,
        a.id DESC
    `;


    const stmt =
      env.DB.prepare(sql);

    const rows =
      params.length
        ? await stmt
            .bind(...params)
            .all()
        : await stmt.all();


    return json(
      rows.results || []
    );
  }


  // ====================================================
  // ARTICLE - CREATE
  // ====================================================

  if (
    pathname === "/api/admin/articles" &&
    request.method === "POST"
  ) {
    const b =
      await request.json();

    const title =
      s(b.title).trim();


    if (!title) {
      return json(
        {
          error:
            "Article title is required"
        },
        400
      );
    }


    const slug =
      await uniqueSlug(
        env,
        slugify(
          b.slug || title
        ),
        null
      );


    const status =
      b.status === "published"
        ? "published"
        : "draft";


    const publishedAt =
      status === "published"
        ? (
            b.published_at ||
            new Date().toISOString()
          )
        : null;


    const result =
      await env.DB
        .prepare(`
          INSERT INTO articles(
            slug,
            title,
            category_id,
            excerpt,
            highlight,
            body,
            closing,
            cover_image,
            status,
            is_featured,
            is_pinned,
            published_at,
            sort_order,
            updated_at
          )

          VALUES(
            ?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP
          )
        `)
        .bind(
          slug,
          title,

          nullableNum(
            b.category_id
          ),

          s(b.excerpt),
          s(b.highlight),
          s(b.body),
          s(b.closing),
          s(b.cover_image),

          status,

          boolInt(
            b.is_featured
          ),

          boolInt(
            b.is_pinned
          ),

          publishedAt,

          num(
            b.sort_order
          )
        )
        .run();


    return json({
      ok: true,
      id:
        result.meta.last_row_id,
      slug
    });
  }


  // ====================================================
  // ARTICLE ID ROUTE
  // ====================================================

  const articleMatch =
    pathname.match(
      /^\/api\/admin\/articles\/(\d+)$/
    );


  // ====================================================
  // ARTICLE - GET ONE
  // ====================================================

  if (
    articleMatch &&
    request.method === "GET"
  ) {
    const id =
      Number(
        articleMatch[1]
      );


    const row =
      await env.DB
        .prepare(`
          SELECT
            a.*,
            c.name category_name

          FROM articles a

          LEFT JOIN categories c
            ON c.id=a.category_id

          WHERE a.id=?
        `)
        .bind(id)
        .first();


    if (!row) {
      return json(
        {
          error:
            "Article not found"
        },
        404
      );
    }


    return json(row);
  }


  // ====================================================
  // ARTICLE - UPDATE
  // ====================================================

  if (
    articleMatch &&
    request.method === "PUT"
  ) {
    const id =
      Number(
        articleMatch[1]
      );


    const b =
      await request.json();


    const title =
      s(
        b.title
      ).trim();


    if (!title) {
      return json(
        {
          error:
            "Article title is required"
        },
        400
      );
    }


    const slug =
      await uniqueSlug(
        env,
        slugify(
          b.slug || title
        ),
        id
      );


    const status =
      b.status === "published"
        ? "published"
        : "draft";


    let publishedAt =
      b.published_at ||
      null;


    if (
      status === "published" &&
      !publishedAt
    ) {
      publishedAt =
        new Date().toISOString();
    }


    if (
      status === "draft"
    ) {
      publishedAt =
        null;
    }


    await env.DB
      .prepare(`
        UPDATE articles

        SET
          slug=?,
          title=?,
          category_id=?,
          excerpt=?,
          highlight=?,
          body=?,
          closing=?,
          cover_image=?,
          status=?,
          is_featured=?,
          is_pinned=?,
          published_at=?,
          sort_order=?,
          updated_at=CURRENT_TIMESTAMP

        WHERE id=?
      `)
      .bind(
        slug,
        title,

        nullableNum(
          b.category_id
        ),

        s(b.excerpt),
        s(b.highlight),
        s(b.body),
        s(b.closing),
        s(b.cover_image),

        status,

        boolInt(
          b.is_featured
        ),

        boolInt(
          b.is_pinned
        ),

        publishedAt,

        num(
          b.sort_order
        ),

        id
      )
      .run();


    return json({
      ok: true,
      slug
    });
  }


  // ====================================================
  // ARTICLE - DELETE
  // ====================================================

  if (
    articleMatch &&
    request.method === "DELETE"
  ) {
    await env.DB
      .prepare(`
        DELETE FROM articles
        WHERE id=?
      `)
      .bind(
        Number(
          articleMatch[1]
        )
      )
      .run();


    return json({
      ok: true
    });
  }


  // ====================================================
  // ARTICLE QUICK ACTIONS
  // publish
  // draft
  // feature
  // pin
  // pull-up
  // ====================================================

  const actionMatch =
    pathname.match(
      /^\/api\/admin\/articles\/(\d+)\/(publish|draft|feature|pin|pull-up)$/
    );


  if (
    actionMatch &&
    request.method === "POST"
  ) {
    const id =
      Number(
        actionMatch[1]
      );


    const action =
      actionMatch[2];


    // Publish
    if (
      action === "publish"
    ) {
      await env.DB
        .prepare(`
          UPDATE articles

          SET
            status='published',
            published_at=
              COALESCE(
                published_at,
                CURRENT_TIMESTAMP
              ),
            updated_at=
              CURRENT_TIMESTAMP

          WHERE id=?
        `)
        .bind(id)
        .run();
    }


    // Draft
    else if (
      action === "draft"
    ) {
      await env.DB
        .prepare(`
          UPDATE articles

          SET
            status='draft',
            published_at=NULL,
            updated_at=CURRENT_TIMESTAMP

          WHERE id=?
        `)
        .bind(id)
        .run();
    }


    // Featured
    else if (
      action === "feature"
    ) {
      await env.DB
        .prepare(`
          UPDATE articles

          SET
            is_featured=
              CASE
                WHEN is_featured=1
                THEN 0
                ELSE 1
              END,

            updated_at=
              CURRENT_TIMESTAMP

          WHERE id=?
        `)
        .bind(id)
        .run();
    }


    // Pin
    else if (
      action === "pin"
    ) {
      await env.DB
        .prepare(`
          UPDATE articles

          SET
            is_pinned=
              CASE
                WHEN is_pinned=1
                THEN 0
                ELSE 1
              END,

            updated_at=
              CURRENT_TIMESTAMP

          WHERE id=?
        `)
        .bind(id)
        .run();
    }


    // Pull Up
    else if (
      action === "pull-up"
    ) {
      const max =
        await env.DB
          .prepare(`
            SELECT
              COALESCE(
                MAX(sort_order),
                0
              ) m

            FROM articles
          `)
          .first();


      await env.DB
        .prepare(`
          UPDATE articles

          SET
            sort_order=?,
            is_pinned=1,
            updated_at=CURRENT_TIMESTAMP

          WHERE id=?
        `)
        .bind(
          Number(
            max?.m || 0
          ) + 10,

          id
        )
        .run();
    }


    return json({
      ok: true
    });
  }


  // ====================================================
  // IMAGE UPLOAD
  // Requires R2 binding: IMAGES
  // ====================================================

  if (
    pathname === "/api/admin/upload" &&
    request.method === "POST"
  ) {

    if (!env.IMAGES) {
      return json(
        {
          error:
            "Image upload is not enabled yet. Add an R2 binding named IMAGES or use an image URL."
        },
        400
      );
    }


    const form =
      await request.formData();


    const file =
      form.get("file");


    if (
      !(file instanceof File)
    ) {
      return json(
        {
          error:
            "No file uploaded"
        },
        400
      );
    }


    if (
      !file.type.startsWith(
        "image/"
      )
    ) {
      return json(
        {
          error:
            "Only image files are allowed"
        },
        400
      );
    }


    // 5 MB max
    if (
      file.size >
      5 * 1024 * 1024
    ) {
      return json(
        {
          error:
            "Image must be 5 MB or smaller"
        },
        400
      );
    }


    const ext =
      extFromType(
        file.type
      );


    const key =
      `articles/${Date.now()}-${crypto.randomUUID()}.${ext}`;


    await env.IMAGES.put(
      key,
      file.stream(),
      {
        httpMetadata: {
          contentType:
            file.type
        }
      }
    );


    return json({
      ok: true,
      url:
        `/media/${encodeURIComponent(key)}`
    });
  }


  // ====================================================
  // NOT FOUND
  // ====================================================

  return json(
    {
      error:
        "Not found"
    },
    404
  );
}


// ======================================================
// PUBLIC CONTENT
// ======================================================

async function publicContent(env) {

  const [
    site,
    categories,
    articles
  ] = await Promise.all([

    env.DB
      .prepare(`
        SELECT *
        FROM site_settings
        WHERE id=1
      `)
      .first(),


    env.DB
      .prepare(`
        SELECT
          id,
          name,
          slug,
          description,
          sort_order

        FROM categories

        WHERE is_active=1

        ORDER BY
          sort_order ASC,
          name ASC
      `)
      .all(),


    env.DB
      .prepare(`
        SELECT
          a.id,
          a.slug,
          a.title,
          a.excerpt,
          a.highlight,
          a.body,
          a.closing,
          a.cover_image,
          a.is_featured,
          a.is_pinned,
          a.published_at,
          a.sort_order,

          c.id category_id,
          c.name category_name,
          c.slug category_slug

        FROM articles a

        LEFT JOIN categories c
          ON c.id=a.category_id

        WHERE
          a.status='published'

        ORDER BY
          a.is_pinned DESC,
          a.sort_order DESC,
          datetime(
            COALESCE(
              a.published_at,
              a.updated_at
            )
          ) DESC,
          a.id DESC
      `)
      .all()

  ]);


  return json({
    site:
      site || {},

    categories:
      categories.results || [],

    articles:
      (articles.results || [])
        .map(
          a => ({
            ...a,

            body:
              a.body || "",

            is_featured:
              !!a.is_featured,

            is_pinned:
              !!a.is_pinned
          })
        )
  });
}


// ======================================================
// UNIQUE ARTICLE SLUG
// ======================================================

async function uniqueSlug(
  env,
  base,
  excludeId
) {

  let slug =
    base || "article";

  let n = 2;


  while (true) {

    let row;


    if (excludeId) {

      row =
        await env.DB
          .prepare(`
            SELECT id
            FROM articles
            WHERE slug=?
            AND id<>?
          `)
          .bind(
            slug,
            excludeId
          )
          .first();

    } else {

      row =
        await env.DB
          .prepare(`
            SELECT id
            FROM articles
            WHERE slug=?
          `)
          .bind(slug)
          .first();
    }


    if (!row) {
      return slug;
    }


    slug =
      `${base}-${n++}`;
  }
}


// ======================================================
// SLUGIFY
// ======================================================

function slugify(v) {

  return String(v || "")
    .toLowerCase()
    .normalize("NFKD")

    .replace(
      /[\u0300-\u036f]/g,
      ""
    )

    .replace(
      /[^a-z0-9]+/g,
      "-"
    )

    .replace(
      /^-+|-+$/g,
      ""
    )

    .slice(
      0,
      100
    )

    || "item";
}


// ======================================================
// VALUE HELPERS
// ======================================================

function s(v) {
  return String(
    v ?? ""
  );
}


function num(v) {

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : 0;
}


function nullableNum(v) {

  return (
    v === null ||
    v === "" ||
    v === undefined
  )
    ? null
    : num(v);
}


function boolInt(
  v,
  def = 0
) {

  if (
    v === undefined
  ) {
    return def;
  }


  return (
    v === true ||
    v === 1 ||
    v === "1" ||
    v === "true"
  )
    ? 1
    : 0;
}


// ======================================================
// JSON RESPONSE
// ======================================================

function json(
  data,
  statusOrOptions = 200
) {

  const options =
    typeof statusOrOptions === "number"

      ? {
          status:
            statusOrOptions
        }

      : statusOrOptions;


  const headers =
    new Headers(
      JSON_HEADERS
    );


  if (
    options?.headers
  ) {

    for (
      const [k, v]
      of Object.entries(
        options.headers
      )
    ) {

      headers.set(
        k,
        v
      );
    }
  }


  return new Response(
    JSON.stringify(data),
    {
      status:
        options?.status || 200,

      headers
    }
  );
}


// ======================================================
// LOGIN SESSION
// ======================================================

function sessionCookie(token) {

  return (
    `cms_session=${token}; ` +
    `Path=/; ` +
    `HttpOnly; ` +
    `Secure; ` +
    `SameSite=Strict; ` +
    `Max-Age=28800`
  );
}


async function makeSession(env) {

  const secret =
    env.ADMIN_SESSION_SECRET ||
    env.ADMIN_PASSWORD ||
    "change-me";


  const payload =
    b64url(
      JSON.stringify({
        exp:
          Date.now() +
          8 * 60 * 60 * 1000
      })
    );


  const sig =
    await sign(
      secret,
      payload
    );


  return (
    `${payload}.${sig}`
  );
}


// ======================================================
// CHECK ADMIN SESSION
// ======================================================

async function requireAuth(
  request,
  env
) {

  const cookie =
    request.headers.get(
      "cookie"
    ) || "";


  const match =
    cookie.match(
      /(?:^|;\s*)cms_session=([^;]+)/
    );


  if (!match) {
    return false;
  }


  const token =
    match[1];


  const [
    payload,
    sig
  ] =
    token.split(".");


  if (
    !payload ||
    !sig
  ) {
    return false;
  }


  const secret =
    env.ADMIN_SESSION_SECRET ||
    env.ADMIN_PASSWORD ||
    "change-me";


  const expected =
    await sign(
      secret,
      payload
    );


  if (
    !timingSafeEqual(
      sig,
      expected
    )
  ) {
    return false;
  }


  try {

    const data =
      JSON.parse(
        fromB64url(
          payload
        )
      );


    return (
      Number(
        data.exp
      ) >
      Date.now()
    );

  } catch {

    return false;
  }
}


// ======================================================
// HMAC SIGNING
// ======================================================

async function sign(
  secret,
  text
) {

  const key =
    await crypto.subtle.importKey(

      "raw",

      new TextEncoder()
        .encode(secret),

      {
        name:
          "HMAC",

        hash:
          "SHA-256"
      },

      false,

      [
        "sign"
      ]
    );


  const sig =
    await crypto.subtle.sign(

      "HMAC",

      key,

      new TextEncoder()
        .encode(text)
    );


  return b64urlBytes(
    new Uint8Array(sig)
  );
}


// ======================================================
// TIMING SAFE COMPARISON
// ======================================================

function timingSafeEqual(
  a,
  b
) {

  if (
    a.length !== b.length
  ) {
    return false;
  }


  let out = 0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    out |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }


  return (
    out === 0
  );
}


// ======================================================
// BASE64 HELPERS
// ======================================================

function b64url(text) {

  return btoa(
    unescape(
      encodeURIComponent(
        text
      )
    )
  )

    .replace(
      /\+/g,
      "-"
    )

    .replace(
      /\//g,
      "_"
    )

    .replace(
      /=+$/,
      ""
    );
}


function b64urlBytes(bytes) {

  let str = "";


  for (
    const b of bytes
  ) {

    str +=
      String.fromCharCode(b);
  }


  return btoa(str)

    .replace(
      /\+/g,
      "-"
    )

    .replace(
      /\//g,
      "_"
    )

    .replace(
      /=+$/,
      ""
    );
}


function fromB64url(str) {

  str =
    str
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );


  while (
    str.length % 4
  ) {

    str += "=";
  }


  return decodeURIComponent(
    escape(
      atob(str)
    )
  );
}


// ======================================================
// IMAGE FILE EXTENSION
// ======================================================

function extFromType(type) {

  if (
    type === "image/png"
  ) {
    return "png";
  }


  if (
    type === "image/webp"
  ) {
    return "webp";
  }


  if (
    type === "image/gif"
  ) {
    return "gif";
  }


  return "jpg";
}
