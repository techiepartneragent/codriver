export const switchToTabTool = {
  name: 'switch_to_tab',
  description: 'Switch the browser focus to the specified tab by its id. Use list_tabs to get tab ids.',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'number',
        description: 'The id of the tab to switch to',
      },
    },
    required: ['tabId'],
  },

  async execute(args, send) {
    const data = await send('SWITCH_TAB', { tabId: args.tabId });
    return JSON.stringify(data);
  },
};
