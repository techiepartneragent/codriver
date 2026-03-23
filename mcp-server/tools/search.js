export const searchTool = {
  name: 'search_web',
  description:
    'Search the web using Google in your real Chrome browser. ' +
    'Uses your actual browser profile — logged in, with your real cookies/session. ' +
    'Returns the search results page content.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to look up on Google',
      },
    },
    required: ['query'],
  },

  async execute({ query }, send) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    // Navigate to Google search
    await send('NAVIGATE', { url: searchUrl });
    // Wait a moment for results to load, then get content
    await new Promise((r) => setTimeout(r, 2000));
    const data = await send('GET_CONTENT', {});
    return `Search results for: "${query}"\nURL: ${data.url ?? searchUrl}\n\n${data.text ?? '(no content)'}`;
  },
};
