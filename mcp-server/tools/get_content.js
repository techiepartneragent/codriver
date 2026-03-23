export const getContentTool = {
  name: 'get_page_content',
  description:
    'Get the current page title and visible text content. Useful for reading page information after navigation.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const data = await send('GET_CONTENT', {});
    const title = data.title ?? '(no title)';
    const text = data.text ?? '(no content)';
    const url = data.url ?? '';
    return `URL: ${url}\nTitle: ${title}\n\nContent:\n${text}`;
  },
};
