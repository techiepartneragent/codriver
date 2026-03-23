export const openNewTabTool = {
  name: 'open_new_tab',
  description: 'Open a new browser tab with the given URL.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to open in a new tab',
      },
    },
    required: ['url'],
  },

  async execute(args, send) {
    const data = await send('OPEN_TAB', { url: args.url });
    return JSON.stringify(data);
  },
};
