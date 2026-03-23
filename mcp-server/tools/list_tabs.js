export const listTabsTool = {
  name: 'list_tabs',
  description: 'List all open browser tabs with their id, title, url, and active state.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const tabs = await send('GET_TABS', {});
    return JSON.stringify(tabs, null, 2);
  },
};
