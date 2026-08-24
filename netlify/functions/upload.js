export default async (request, context) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response('Server misconfigured', { status: 500 });
  }

  // --- Auth gate: caller must present a valid Supabase access token ---
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return new Response('Unauthorized', { status: 401 });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response('Unauthorized', { status: 401 });

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const filename = url.searchParams.get('file');
    if (!filename) return new Response('Missing file param', { status: 400 });

    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/images/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    return new Response(null, { status: res.ok ? 200 : res.status });
  }

  if (request.method === 'POST') {
    const filename = request.headers.get('x-filename');
    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    if (!filename) return new Response('Missing x-filename header', { status: 400 });

    const body = await request.arrayBuffer();
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/images/${filename}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body,
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return new Response(err, { status: res.status });
    }

    return new Response(JSON.stringify({ url: `/img/${filename}` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/upload' };
