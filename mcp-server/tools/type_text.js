export const typeTextTool = {
  name: 'type_text',
  description:
    'Type text into an input field or textarea on the current page. ' +
    'Focuses the element first, then sets the value and fires input/change events.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input field (e.g. "input[name=\'q\']", "#search")',
      },
      text: {
        type: 'string',
        description: 'Text to type into the element',
      },
    },
    required: ['selector', 'text'],
  },

  async execute({ selector, text }, send) {
    const data = await send('TYPE_TEXT', { selector, text });
    return `Typed into ${selector}: "${text}"\n${data.message ?? 'Success'}`;
  },
};
