export const getUrlTool = {
  name: 'get_current_url',
  description: 'Get the URL and title of the currently active browser tab.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const data = await send('GET_URL', {});
    return `Current URL: ${data.url ?? '(unknown)'}\nTitle: ${data.title ?? '(unknown)'}`;
  },
};
