export const navigateTool = {
  name: 'navigate_to',
  description: 'Navigate the browser to a URL. Opens the URL in the currently active Chrome tab.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full URL to navigate to (e.g. https://example.com)',
      },
    },
    required: ['url'],
  },

  async execute({ url }, send) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const data = await send('NAVIGATE', { url });
    return `Navigated to: ${data.url ?? url}\nTitle: ${data.title ?? '(loading)'}`;
  },
};
