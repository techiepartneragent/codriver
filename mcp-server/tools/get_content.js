export const getContentTool = {
  name: 'get_page_content',
  description:
    'Get the current page title and visible text content. Prioritizes main article content, stripping nav/footer/ads.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const data = await send('GET_CONTENT', {});
    const title = data.title ?? '(no title)';
    const url = data.url ?? '';

    // Prefer clean article text if available, else fall back to full text
    const text = data.articleText || data.text || '(no content)';

    return `URL: ${url}\nTitle: ${title}\n\nContent:\n${text}`;
  },
};
