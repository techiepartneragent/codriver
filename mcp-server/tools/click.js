export const clickTool = {
  name: 'click_element',
  description:
    'Click an element on the current page using a CSS selector. ' +
    'Use get_page_content first to identify the right selector.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click (e.g. "#submit-btn", ".nav-link")',
      },
    },
    required: ['selector'],
  },

  async execute({ selector }, send) {
    const data = await send('CLICK', { selector });
    return `Clicked element: ${selector}\n${data.message ?? 'Success'}`;
  },
};
