import { createClient } from '@supabase/supabase-js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Initialize Supabase client using environment variables configured in Cloudflare
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

    // API Endpoint for Submissions
    if (url.pathname === '/api/submissions') {
      try {
        const { data: subs, error } = await supabase
          .from('submissions')
          .select('*, challenges(deadline)')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(JSON.stringify(subs), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Otherwise, serve static assets / frontend
    return env.ASSETS.fetch(request);
  }
};
