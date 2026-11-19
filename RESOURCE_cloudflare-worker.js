// Copy this code into your Cloudflare Worker script (Cloudflare dashboard → your Worker → Edit code → Deploy).
// The OpenAI key is stored as a Worker secret named OPENAI_API_KEY — never in your website code.

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const apiKey = env.OPENAI_API_KEY;
    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    const userInput = await request.json();

    // LevelUp: when the website sends useWebSearch: true, use a model that can search the web.
    // It returns the same "choices[0].message" shape, plus "annotations" with source links.
    const requestBody = userInput.useWebSearch
      ? {
          model: 'gpt-4o-search-preview',
          web_search_options: {},
          messages: userInput.messages,
          max_completion_tokens: 1000
        }
      : {
          model: 'gpt-4o',
          messages: userInput.messages,
          max_completion_tokens: 1000
        };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), { status: response.status, headers: corsHeaders });
  }
};
